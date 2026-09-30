"""Two-seat room API and WebSocket transport for the in-memory duel engine."""

import asyncio
import json
import logging
import secrets
import string
import time
from dataclasses import dataclass, field
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect
from sqlalchemy.orm import Session
from sqlalchemy.exc import SQLAlchemyError

from ..auth import get_current_user, user_from_token
from ..db import SessionLocal
from ..models import User
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

    async def broadcast(self) -> None:
        snapshot = self.match.snapshot(now_ms())
        snapshot["connectedSeats"] = sorted(self.peers)
        await asyncio.gather(*(peer.send(snapshot) for peer in self.peers.values()), return_exceptions=True)
        self.last_broadcast_revision = self.match.revision


class RoomManager:
    def __init__(self) -> None:
        self.rooms: dict[str, Room] = {}
        self.lock = asyncio.Lock()

    async def create(self, user_id: UUID, login: str, display_name: str | None = None) -> Room:
        async with self.lock:
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
                if code not in self.rooms:
                    break
            room = Room(code)
            room.match.add_player(user_id, login, display_name)
            self.rooms[code] = room
            return room

    async def join(self, code: str, user_id: UUID, login: str, display_name: str | None = None) -> tuple[Room, int]:
        room = self.rooms.get(code.upper())
        if room is None or (not room.peers and now_ms() - room.last_activity_ms >= ROOM_IDLE_MS):
            raise HTTPException(404, "Room not found.")
        async with room.lock:
            for seat, player in enumerate(room.match.players):
                if player.user_id == user_id:
                    return room, seat
            if room.match.phase != "waiting" or len(room.match.players) >= 2:
                raise HTTPException(409, "Room is full or already started.")
            seat = room.match.add_player(user_id, login, display_name)
            room.last_activity_ms = now_ms()
            await room.broadcast()
            return room, seat

    async def run(self, room: Room) -> None:
        try:
            while self.rooms.get(room.code) is room:
                await asyncio.sleep(0.05)
                async with room.lock:
                    now = now_ms()
                    changed = room.match.advance(now)
                    for seat, lost_at in tuple(room.disconnected_at_ms.items()):
                        if now - lost_at >= DISCONNECT_GRACE_MS:
                            room.match.forfeit(seat)
                            del room.disconnected_at_ms[seat]
                            changed = True
                    if (room.match.phase == "finished" and not room.stats_recorded
                            and len(room.match.players) == 2 and now >= room.stats_retry_at_ms):
                        try:
                            await asyncio.to_thread(self.record_result, room)
                            room.stats_recorded = True
                        except SQLAlchemyError:
                            logger.exception("Could not record online duel result for room %s", room.code)
                            room.stats_retry_at_ms = now + 5000
                    changed = changed or room.match.revision != room.last_broadcast_revision
                    if changed:
                        await room.broadcast()
                    if not room.peers and now - room.last_activity_ms >= ROOM_IDLE_MS:
                        self.rooms.pop(room.code, None)
                        return
        except asyncio.CancelledError:
            return

    @staticmethod
    def record_result(room: Room) -> None:
        player_ids = (room.match.players[0].user_id, room.match.players[1].user_id)
        with SessionLocal() as db:
            record_online_result(db, player_ids, room.match.winner)


manager = RoomManager()


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
        return True  # Non-browser test clients do not send an Origin header.
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
    room = manager.rooms.get(code.upper())
    if room is None:
        await websocket.close(code=1008)
        return
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
                await peer.send({"type": "pong", "v": 1, "clientTimeMs": message.get("clientTimeMs"),
                                 "serverTimeMs": now_ms()})
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
                peer.last_seq = seq
                try:
                    room.match.cast(seat, message.get("spellId"), now_ms())
                except CastRejected as error:
                    await peer.send({"type": "error", "v": 1, "code": error.code, "seq": seq})
                    continue
                room.last_activity_ms = now_ms()
                await room.broadcast()
    except WebSocketDisconnect:
        pass
    finally:
        async with room.lock:
            if room.peers.get(seat) is peer:
                del room.peers[seat]
                room.disconnected_at_ms[seat] = now_ms()
                room.last_activity_ms = now_ms()
                room.match.revision += 1
                await room.broadcast()
