from uuid import uuid4

from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect
import pytest

from admit_hackathon.api.auth import create_access_token, get_current_user
from admit_hackathon.api.main import app
from admit_hackathon.api.models import User
from admit_hackathon.api.multiplayer import rooms


def test_two_authenticated_users_join_and_exchange_authoritative_state(monkeypatch) -> None:
    first = User(id=uuid4(), login="first", password_hash="unused")
    second = User(id=uuid4(), login="second", password_hash="unused")
    users = {first.id: first, second.id: second}

    class FakeSession:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def get(self, _model, user_id):
            return users.get(user_id)

    monkeypatch.setattr(rooms, "SessionLocal", FakeSession)
    monkeypatch.setattr(rooms, "manager", rooms.RoomManager())
    clock = [1_700_000_000_000]
    monkeypatch.setattr(rooms, "now_ms", lambda: clock[0])
    active_user = first
    app.dependency_overrides[get_current_user] = lambda: active_user
    try:
        with TestClient(app) as client:
            created = client.post("/api/rooms")
            assert created.status_code == 201
            code = created.json()["code"]
            assert len(code) == 6
            active_user = second
            joined = client.post(f"/api/rooms/{code}/join")
            assert joined.status_code == 200
            assert joined.json()["seat"] == 1
            with client.websocket_connect(f"/ws/rooms/{code}") as denied:
                denied.send_json({"type": "authenticate", "token": "bad-token"})
                with pytest.raises(WebSocketDisconnect):
                    denied.receive_json()
            with client.websocket_connect(f"/ws/rooms/{code}") as one:
                one.send_json({"type": "authenticate", "token": create_access_token(first)[0]})
                assert one.receive_json()["phase"] == "waiting"
                with client.websocket_connect(f"/ws/rooms/{code}") as two:
                    two.send_json({"type": "authenticate", "token": create_access_token(second)[0]})
                    assert one.receive_json()["phase"] == "active"
                    initial = two.receive_json()
                    assert initial["phase"] == "active"
                    assert [player["login"] for player in initial["players"]] == ["first", "second"]
                    one.send_json({"type": "cast", "v": 1, "seq": 1, "spellId": "rune.triangle"})
                    warning = one.receive_json()
                    assert warning["attacks"][0]["seat"] == 0
                    assert warning["attacks"][0]["releaseAtMs"] - warning["attacks"][0]["startedAtMs"] == 3000
                    assert two.receive_json()["revision"] == warning["revision"]
                    one.send_json({"type": "cast", "v": 1, "seq": 1, "spellId": "rune.triangle"})
                    assert one.receive_json()["code"] == "duplicate"
                    two.send_json({"type": "cast", "v": 1, "seq": 1, "spellId": "rune.circle"})
                    assert two.receive_json()["players"][1]["shieldUntilMs"] > 0
                    assert one.receive_json()["type"] == "state"
                    clock[0] += 3900
                    impact_one = one.receive_json()
                    impact_two = two.receive_json()
                    assert impact_one["revision"] == impact_two["revision"]
                    assert impact_one["impacts"][0]["blocked"] is True
                    assert impact_one["players"][1]["health"] == 100
                disconnected = one.receive_json()
                assert disconnected["connectedSeats"] == [0]
                assert disconnected["revision"] > impact_one["revision"]
                with client.websocket_connect(f"/ws/rooms/{code}") as rejoined:
                    rejoined.send_json({"type": "authenticate", "token": create_access_token(second)[0]})
                    assert one.receive_json()["connectedSeats"] == [0, 1]
                    assert rejoined.receive_json()["phase"] == "active"
    finally:
        app.dependency_overrides.clear()
