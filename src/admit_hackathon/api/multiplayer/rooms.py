"""Authenticated two-seat rooms with PostgreSQL-backed authoritative state."""

import asyncio
import json
import logging
import secrets
import string
import time
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect
from sqlalchemy import delete, func, select
from sqlalchemy.exc import SQLAlchemyError

from ..auth import get_current_user, user_from_token
from ..db import SessionLocal
from ..models import MultiplayerRoom, MultiplayerRoomEvent, MultiplayerRoomPlayer, User
from ..profile import record_online_result
from ..settings import get_settings
from .engine import CastRejected, Match

router = APIRouter(tags=["multiplayer"])
ROOM_ALPHABET = string.ascii_uppercase + string.digits
ROOM_IDLE_MS = 30 * 60 * 1000
DISCONNECT_GRACE_MS = 15_000
MAX_ROOMS = 256
logger = logging.getLogger(__name__)


def now_ms() -> int:
    return time.time_ns() // 1_000_000


def utc_now() -> datetime:
    return datetime.now(UTC)


def expiry_time() -> datetime:
    return utc_now() + timedelta(milliseconds=ROOM_IDLE_MS)


@dataclass
class Peer:
    socket: WebSocket
    send_lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    last_seq: int = 0

    async def send(self, message: dict) -> None:
        async with self.send_lock:
            await self.socket.send_json(message)


@dataclass
class Room:
    code: str
    match: Match = field(default_factory=Match)
    peers: dict[int, Peer] = field(default_factory=dict)
    disconnected_at_ms: dict[int, int] = field(default_factory=dict)
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    last_activity_ms: int = field(default_factory=now_ms)
    task: asyncio.Task | None = None
    stats_recorded: bool = False
    stats_retry_at_ms: int = 0
    last_broadcast_revision: int = -1
    persistent: bool = False

    async def broadcast(self) -> None:
        snapshot = self.match.snapshot(now_ms())
        snapshot["connectedSeats"] = await asyncio.to_thread(_connected_seats, self.code) if self.persistent else sorted(self.peers)
        await asyncio.gather(*(peer.send(snapshot) for peer in self.peers.values()), return_exceptions=True)
        self.last_broadcast_revision = self.match.revision


def _connected_seats(code: str) -> list[int]:
    with SessionLocal() as db:
        rows = db.scalars(
            select(MultiplayerRoomPlayer.seat)
            .where(MultiplayerRoomPlayer.room_code == code, MultiplayerRoomPlayer.connected_at.is_not(None))
            .order_by(MultiplayerRoomPlayer.seat)
        )
        return list(rows)


class RoomManager:
    """Coordinates local sockets while PostgreSQL owns room state when enabled."""

    def __init__(self, persistent: bool = False) -> None:
        self.rooms: dict[str, Room] = {}
        self.lock = asyncio.Lock()
        self.persistent = persistent

    def _snapshot(self, room: Room) -> dict:
        return room.match.snapshot(now_ms())

    def _persist_new(self, room: Room) -> None:
        snapshot = self._snapshot(room)
        with SessionLocal.begin() as db:
            db.add(MultiplayerRoom(code=room.code, phase=room.match.phase, revision=room.match.revision,
                                   snapshot=snapshot, winner=room.match.winner, expires_at=expiry_time()))
            for seat, player in enumerate(room.match.players):
                db.add(MultiplayerRoomPlayer(room_code=room.code, seat=seat, user_id=player.user_id,
                                             login=player.login, display_name=player.display_name))
            db.add(MultiplayerRoomEvent(room_code=room.code, revision=room.match.revision,
                                        event_type="room_created", payload=snapshot))

    def _persist_match(self, room: Room, event_type: str) -> None:
        snapshot = self._snapshot(room)
        with SessionLocal.begin() as db:
            row = db.get(MultiplayerRoom, room.code)
            if row is None:
                db.add(MultiplayerRoom(code=room.code, phase=room.match.phase, revision=room.match.revision,
                                       snapshot=snapshot, winner=room.match.winner, expires_at=expiry_time()))
                for seat, player in enumerate(room.match.players):
                    db.add(MultiplayerRoomPlayer(room_code=room.code, seat=seat, user_id=player.user_id,
                                                 login=player.login, display_name=player.display_name))
                db.add(MultiplayerRoomEvent(room_code=room.code, revision=room.match.revision,
                                            event_type=event_type, payload=snapshot))
                return
            row.phase = room.match.phase
            row.revision = room.match.revision
            row.snapshot = snapshot
            row.winner = room.match.winner
            row.updated_at = utc_now()
            row.expires_at = expiry_time()
            for seat, player in enumerate(room.match.players):
                if db.get(MultiplayerRoomPlayer, {"room_code": room.code, "seat": seat}) is None:
                    db.add(MultiplayerRoomPlayer(room_code=room.code, seat=seat, user_id=player.user_id,
                                                 login=player.login, display_name=player.display_name))
            db.add(MultiplayerRoomEvent(room_code=room.code, revision=room.match.revision,
                                        event_type=event_type, payload=snapshot))

    def _persist_join(self, room: Room, user_id: UUID, login: str, display_name: str | None) -> tuple[Match, int]:
        with SessionLocal.begin() as db:
            row = db.execute(select(MultiplayerRoom).where(MultiplayerRoom.code == room.code)
                             .with_for_update()).scalar_one()
            if row.expires_at <= utc_now():
                raise HTTPException(404, "Room not found.")
            match = Match.from_snapshot(dict(row.snapshot))
            for seat, player in enumerate(match.players):
                if player.user_id == user_id:
                    return match, seat
            if match.phase != "waiting" or len(match.players) >= 2:
                raise HTTPException(409, "Room is full or already started.")
            seat = match.add_player(user_id, login, display_name)
            snapshot = match.snapshot(now_ms())
            row.phase, row.revision, row.snapshot, row.winner = match.phase, match.revision, snapshot, match.winner
            row.updated_at, row.expires_at = utc_now(), expiry_time()
            db.add(MultiplayerRoomPlayer(room_code=room.code, seat=seat, user_id=user_id,
                                         login=login, display_name=display_name or login))
            db.add(MultiplayerRoomEvent(room_code=room.code, revision=match.revision,
                                        event_type="joined", payload=snapshot))
            return match, seat

    def _load(self, code: str) -> Room | None:
        with SessionLocal() as db:
            row = db.get(MultiplayerRoom, code.upper())
            if row is None or row.expires_at <= utc_now():
                return None
            room = Room(code=row.code, match=Match.from_snapshot(dict(row.snapshot)),
                        stats_recorded=row.stats_recorded, last_activity_ms=now_ms(), persistent=True)
            for player in db.scalars(select(MultiplayerRoomPlayer).where(MultiplayerRoomPlayer.room_code == row.code)):
                if player.disconnected_at is not None:
                    room.disconnected_at_ms[player.seat] = int(player.disconnected_at.timestamp() * 1000)
            return room

    def _refresh(self, room: Room) -> bool:
        if not self.persistent:
            return False
        loaded = self._load(room.code)
        if loaded is None or loaded.match.revision <= room.match.revision:
            return False
        room.match = loaded.match
        room.stats_recorded = loaded.stats_recorded
        room.last_activity_ms = now_ms()
        return True

    def _persist_connection(self, room: Room, seat: int, connected: bool, start: bool = False) -> Match:
        with SessionLocal.begin() as db:
            row = db.execute(select(MultiplayerRoom).where(MultiplayerRoom.code == room.code)
                             .with_for_update()).scalar_one()
            match = Match.from_snapshot(dict(row.snapshot))
            if connected and start:
                match.start()
            else:
                match.revision += 1
            player = db.get(MultiplayerRoomPlayer, {"room_code": room.code, "seat": seat})
            if player is None:
                raise HTTPException(404, "Room seat not found.")
            timestamp = utc_now()
            player.connected_at = timestamp if connected else None
            player.disconnected_at = None if connected else timestamp
            snapshot = match.snapshot(now_ms())
            row.phase, row.revision, row.snapshot, row.winner = match.phase, match.revision, snapshot, match.winner
            row.updated_at, row.expires_at = timestamp, expiry_time()
            db.add(MultiplayerRoomEvent(room_code=room.code, revision=match.revision,
                                        event_type="connected" if connected else "disconnected", payload=snapshot))
            return match

    def _persist_cast(self, room: Room, seat: int, spell_id: str, timestamp_ms: int) -> Match:
        with SessionLocal.begin() as db:
            row = db.execute(select(MultiplayerRoom).where(MultiplayerRoom.code == room.code)
                             .with_for_update()).scalar_one()
            match = Match.from_snapshot(dict(row.snapshot))
            match.cast(seat, spell_id, timestamp_ms)
            snapshot = match.snapshot(timestamp_ms)
            row.phase, row.revision, row.snapshot, row.winner = match.phase, match.revision, snapshot, match.winner
            row.updated_at, row.expires_at = utc_now(), expiry_time()
            db.add(MultiplayerRoomEvent(room_code=room.code, revision=match.revision, event_type="cast",
                                        payload={"spellId": spell_id, "snapshot": snapshot}))
            return match

    def _persist_advance(self, room: Room, timestamp_ms: int) -> tuple[Match, bool]:
        with SessionLocal.begin() as db:
            row = db.execute(select(MultiplayerRoom).where(MultiplayerRoom.code == room.code)
                             .with_for_update()).scalar_one()
            match = Match.from_snapshot(dict(row.snapshot))
            changed = match.advance(timestamp_ms)
            if changed:
                snapshot = match.snapshot(timestamp_ms)
                row.phase, row.revision, row.snapshot, row.winner = match.phase, match.revision, snapshot, match.winner
                row.updated_at, row.expires_at = utc_now(), expiry_time()
                db.add(MultiplayerRoomEvent(room_code=room.code, revision=match.revision,
                                            event_type="advance", payload=snapshot))
            return match, changed

    def _persist_forfeit(self, room: Room, seat: int, timestamp_ms: int) -> Match:
        with SessionLocal.begin() as db:
            row = db.execute(select(MultiplayerRoom).where(MultiplayerRoom.code == room.code)
                             .with_for_update()).scalar_one()
            match = Match.from_snapshot(dict(row.snapshot))
            match.forfeit(seat)
            snapshot = match.snapshot(timestamp_ms)
            row.phase, row.revision, row.snapshot, row.winner = match.phase, match.revision, snapshot, match.winner
            row.updated_at = utc_now()
            db.add(MultiplayerRoomEvent(room_code=room.code, revision=match.revision,
                                        event_type="forfeit", payload=snapshot))
            return match

    def _record_result_once(self, room: Room) -> bool:
        with SessionLocal.begin() as db:
            row = db.execute(select(MultiplayerRoom).where(MultiplayerRoom.code == room.code)
                             .with_for_update()).scalar_one_or_none()
            if row is None or row.stats_recorded or len(room.match.players) != 2:
                return bool(row and row.stats_recorded)
            player_ids = (room.match.players[0].user_id, room.match.players[1].user_id)
            record_online_result(db, player_ids, room.match.winner, commit=False)
            row.stats_recorded = True
            return True

    async def load(self, code: str) -> Room | None:
        normalized = code.upper()
        room = self.rooms.get(normalized)
        if room is not None:
            return room
        if not self.persistent:
            return None
        room = await asyncio.to_thread(self._load, normalized)
        if room is not None:
            self.rooms[normalized] = room
        return room

    async def create(self, user_id: UUID, login: str, display_name: str | None = None) -> Room:
        async with self.lock:
            if self.persistent:
                await asyncio.to_thread(self._remove_expired)
                if await asyncio.to_thread(self._room_count) >= MAX_ROOMS:
                    raise HTTPException(503, "Room capacity reached. Try again shortly.")
            else:
                current = now_ms()
                for code, old in tuple(self.rooms.items()):
                    if not old.peers and current - old.last_activity_ms >= ROOM_IDLE_MS:
                        self.rooms.pop(code)
                        if old.task is not None:
                            old.task.cancel()
                if len(self.rooms) >= MAX_ROOMS:
                    raise HTTPException(503, "Room capacity reached. Try again shortly.")
            while True:
                code = "".join(secrets.choice(ROOM_ALPHABET) for _ in range(6))
                # Six random characters make a collision negligible; the database primary key
                # remains the final guard without adding a round-trip for every candidate.
                if code not in self.rooms:
                    break
            room = Room(code, persistent=self.persistent)
            room.match.add_player(user_id, login, display_name)
            if self.persistent:
                await asyncio.to_thread(self._persist_new, room)
            self.rooms[code] = room
            return room

    async def join(self, code: str, user_id: UUID, login: str, display_name: str | None = None) -> tuple[Room, int]:
        room = await self.load(code)
        if room is None:
            raise HTTPException(404, "Room not found.")
        async with room.lock:
            if self.persistent:
                room.match, seat = await asyncio.to_thread(self._persist_join, room, user_id, login, display_name)
            else:
                for seat, player in enumerate(room.match.players):
                    if player.user_id == user_id:
                        return room, seat
                if room.match.phase != "waiting" or len(room.match.players) >= 2:
                    raise HTTPException(409, "Room is full or already started.")
                seat = room.match.add_player(user_id, login, display_name)
            room.last_activity_ms = now_ms()
            await room.broadcast()
            return room, seat

    async def cast(self, room: Room, seat: int, spell_id: str, timestamp_ms: int) -> None:
        if self.persistent:
            room.match = await asyncio.to_thread(self._persist_cast, room, seat, spell_id, timestamp_ms)
        else:
            room.match.cast(seat, spell_id, timestamp_ms)
        room.last_activity_ms = now_ms()

    def _room_count(self) -> int:
        with SessionLocal() as db:
            return int(db.scalar(select(func.count()).select_from(MultiplayerRoom)) or 0)

    def _remove_expired(self) -> None:
        with SessionLocal.begin() as db:
            db.execute(delete(MultiplayerRoom).where(MultiplayerRoom.expires_at <= utc_now()))

    async def run(self, room: Room) -> None:
        try:
            while self.rooms.get(room.code) is room:
                await asyncio.sleep(0.05)
                async with room.lock:
                    changed = False
                    if self.persistent:
                        changed = await asyncio.to_thread(self._refresh, room)
                        room.match, advance_changed = await asyncio.to_thread(self._persist_advance, room, now_ms())
                        changed = changed or advance_changed
                    else:
                        changed = room.match.advance(now_ms())
                    for seat, lost_at in tuple(room.disconnected_at_ms.items()):
                        if now_ms() - lost_at >= DISCONNECT_GRACE_MS:
                            if self.persistent:
                                room.match = await asyncio.to_thread(self._persist_forfeit, room, seat, now_ms())
                            else:
                                room.match.forfeit(seat)
                            del room.disconnected_at_ms[seat]
                            changed = True
                    if room.match.phase == "finished" and not room.stats_recorded and len(room.match.players) == 2 and now_ms() >= room.stats_retry_at_ms:
                        try:
                            if self.persistent:
                                room.stats_recorded = await asyncio.to_thread(self._record_result_once, room)
                            else:
                                await asyncio.to_thread(self.record_result, room)
                                room.stats_recorded = True
                            changed = True
                        except SQLAlchemyError:
                            logger.exception("Could not record online duel result for room %s", room.code)
                            room.stats_retry_at_ms = now_ms() + 5000
                    changed = changed or room.match.revision != room.last_broadcast_revision
                    if changed:
                        await room.broadcast()
                    if not room.peers and now_ms() - room.last_activity_ms >= ROOM_IDLE_MS:
                        self.rooms.pop(room.code, None)
                        if self.persistent:
                            await asyncio.to_thread(self._remove_room, room.code)
                        return
        except asyncio.CancelledError:
            return

    def _remove_room(self, code: str) -> None:
        with SessionLocal.begin() as db:
            db.execute(delete(MultiplayerRoom).where(MultiplayerRoom.code == code))

    @staticmethod
    def record_result(room: Room) -> None:
        player_ids = (room.match.players[0].user_id, room.match.players[1].user_id)
        with SessionLocal() as db:
            record_online_result(db, player_ids, room.match.winner)


manager = RoomManager(persistent=True)


@router.post("/api/rooms", status_code=201)
async def create_room(user: User = Depends(get_current_user)) -> dict:
    room = await manager.create(user.id, user.login, user.display_name or user.login)
    return {"code": room.code, "seat": 0, "phase": room.match.phase}


@router.post("/api/rooms/{code}/join")
async def join_room(code: str, user: User = Depends(get_current_user)) -> dict:
    room, seat = await manager.join(code, user.id, user.login, user.display_name or user.login)
    return {"code": room.code, "seat": seat, "phase": room.match.phase}


def origin_allowed(origin: str | None) -> bool:
    if origin is None:
        return True
    if origin in get_settings().cors_origin_list:
        return True
    from urllib.parse import urlparse
    parsed = urlparse(origin)
    return parsed.scheme in {"http", "https"} and parsed.hostname in {"localhost", "127.0.0.1"}


@router.websocket("/ws/rooms/{code}")
async def room_socket(websocket: WebSocket, code: str) -> None:
    if not origin_allowed(websocket.headers.get("origin")):
        await websocket.close(code=1008)
        return
    room = await manager.load(code)
    if room is None:
        await websocket.close(code=1008)
        return
    if manager.persistent:
        await asyncio.to_thread(manager._refresh, room)
    await websocket.accept()
    try:
        raw = await asyncio.wait_for(websocket.receive_text(), timeout=5)
        if len(raw) > 2048:
            raise ValueError("Authentication message too large")
        auth = json.loads(raw)
        if not isinstance(auth, dict) or auth.get("type") != "authenticate" or not isinstance(auth.get("token"), str):
            raise ValueError("Expected authentication")
        with SessionLocal() as db:
            user = user_from_token(auth["token"], db)
        seat = next((index for index, player in enumerate(room.match.players) if player.user_id == user.id), None)
        if seat is None:
            raise ValueError("Not a room member")
    except (asyncio.TimeoutError, ValueError, HTTPException, WebSocketDisconnect, json.JSONDecodeError):
        await websocket.close(code=1008)
        return

    peer = Peer(websocket)
    async with room.lock:
        if seat in room.peers:
            await websocket.close(code=1008)
            return
        room.peers[seat] = peer
        room.disconnected_at_ms.pop(seat, None)
        room.last_activity_ms = now_ms()
        if manager.persistent:
            room.match = await asyncio.to_thread(manager._persist_connection, room, seat, True, len(room.peers) == 2)
        else:
            room.match.revision += 1
            if len(room.peers) == 2:
                room.match.start()
        if room.task is None or room.task.done():
            room.task = asyncio.create_task(manager.run(room))
        await room.broadcast()

    try:
        while True:
            raw = await websocket.receive_text()
            if len(raw) > 2048:
                await peer.send({"type": "error", "v": 1, "code": "invalid_message"})
                continue
            try:
                message = json.loads(raw)
            except json.JSONDecodeError:
                message = None
            if not isinstance(message, dict) or message.get("v") != 1:
                await peer.send({"type": "error", "v": 1, "code": "invalid_message"})
                continue
            if message.get("type") == "ping":
                await peer.send({"type": "pong", "v": 1, "clientTimeMs": message.get("clientTimeMs"), "serverTimeMs": now_ms()})
                continue
            if (message.get("type") != "cast" or not isinstance(message.get("seq"), int)
                    or isinstance(message.get("seq"), bool) or not isinstance(message.get("spellId"), str)):
                await peer.send({"type": "error", "v": 1, "code": "invalid_message"})
                continue
            seq = message["seq"]
            async with room.lock:
                if seq <= peer.last_seq or seq > 2_147_483_647:
                    await peer.send({"type": "error", "v": 1, "code": "duplicate", "seq": seq})
                    continue
                try:
                    await manager.cast(room, seat, message["spellId"], now_ms())
                except CastRejected as error:
                    await peer.send({"type": "error", "v": 1, "code": error.code, "seq": seq})
                    continue
                peer.last_seq = seq
                await room.broadcast()
    except WebSocketDisconnect:
        pass
    finally:
        async with room.lock:
            if room.peers.get(seat) is peer:
                del room.peers[seat]
                room.disconnected_at_ms[seat] = now_ms()
                room.last_activity_ms = now_ms()
                if manager.persistent:
                    room.match = await asyncio.to_thread(manager._persist_connection, room, seat, False)
                else:
                    room.match.revision += 1
                await room.broadcast()
