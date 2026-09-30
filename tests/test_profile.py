import asyncio
from datetime import UTC, datetime
from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from admit_hackathon.api.auth import get_current_user
from admit_hackathon.api.db import Base, get_db
from admit_hackathon.api.main import app
from admit_hackathon.api.models import User
from admit_hackathon.api.profile import record_online_result
from admit_hackathon.api.multiplayer.rooms import Room, RoomManager


def test_profile_can_change_display_name_without_changing_login() -> None:
    user = User(
        id=uuid4(), login="spell.caster", display_name="Spell Caster", password_hash="unused",
        created_at=datetime(2026, 1, 2, tzinfo=UTC), duels_played=3, duels_won=2, duels_lost=1, duels_drawn=0,
    )

    class FakeSession:
        def commit(self) -> None:
            pass

        def refresh(self, _user: User) -> None:
            pass

    app.dependency_overrides[get_current_user] = lambda: user
    app.dependency_overrides[get_db] = FakeSession
    try:
        client = TestClient(app)
        initial = client.get("/api/profile")
        updated = client.patch("/api/profile", json={"displayName": "  Moon   Warden  "})
        invalid = client.patch("/api/profile", json={"displayName": "x"})
    finally:
        app.dependency_overrides.clear()

    assert initial.status_code == 200
    assert initial.json()["online"] == {"played": 3, "won": 2, "lost": 1, "drawn": 0}
    assert updated.status_code == 200
    assert updated.json()["displayName"] == "Moon Warden"
    assert updated.json()["login"] == "spell.caster"
    assert user.display_name == "Moon Warden"
    assert invalid.status_code == 422


def test_online_results_increment_both_accounts_atomically() -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    first = User(login="first", display_name="First", password_hash="unused")
    second = User(login="second", display_name="Second", password_hash="unused")
    with Session(engine) as db:
        db.add_all([first, second])
        db.commit()
        first_id, second_id = first.id, second.id
        record_online_result(db, (first_id, second_id), winner=0)
        record_online_result(db, (first_id, second_id), winner=None)
        db.refresh(first)
        db.refresh(second)
        assert (first.duels_played, first.duels_won, first.duels_lost, first.duels_drawn) == (2, 1, 0, 1)
        assert (second.duels_played, second.duels_won, second.duels_lost, second.duels_drawn) == (2, 0, 1, 1)


def test_finished_room_records_result_only_once() -> None:
    async def run_room() -> None:
        manager = RoomManager()
        room = Room("ABC123")
        room.match.add_player(uuid4(), "first")
        room.match.add_player(uuid4(), "second")
        room.match.start()
        room.match.forfeit(1)
        manager.rooms[room.code] = room
        saved: list[int | None] = []
        manager.record_result = lambda current: saved.append(current.match.winner)  # type: ignore[method-assign]
        task = asyncio.create_task(manager.run(room))
        await asyncio.sleep(0.17)
        task.cancel()
        await task
        assert saved == [0]
        assert room.stats_recorded is True

    asyncio.run(run_room())
