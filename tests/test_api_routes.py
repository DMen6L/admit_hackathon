from uuid import UUID, uuid4

from fastapi.testclient import TestClient
from sqlalchemy.exc import IntegrityError
from admit_hackathon.api.db import get_db
from admit_hackathon.api.main import app
from admit_hackathon.api.models import User
from admit_hackathon.api.auth import password_hash


def test_root_describes_the_api() -> None:
    response = TestClient(app).get("/")

    assert response.status_code == 200
    assert response.json() == {"service": "Webcam Magic API", "health": "/health"}


class FakeSession:
    def __init__(self) -> None:
        self.user: User | None = None

    def add(self, user: User) -> None:
        self.user = user

    def commit(self) -> None:
        if self.user is not None and self.user.id is None:
            self.user.id = uuid4()

    def rollback(self) -> None:
        pass

    def refresh(self, user: User) -> None:
        if user.id is None:
            user.id = uuid4()

    def scalar(self, _query: object) -> User | None:
        return self.user

    def get(self, _model: type[User], user_id: UUID) -> User | None:
        return self.user if self.user is not None and self.user.id == user_id else None

    def execute(self, _query: object) -> None:
        return None


class DuplicateSession(FakeSession):
    def commit(self) -> None:
        raise IntegrityError("INSERT users", {}, RuntimeError("duplicate login"))


def test_register_endpoint_returns_uuid_and_token() -> None:
    db = FakeSession()
    app.dependency_overrides[get_db] = lambda: db
    try:
        response = TestClient(app).post(
            "/api/auth/register",
            json={"login": "Arcane.Wanderer", "password": "Spellbound1"},
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 201
    body = response.json()
    assert UUID(body["user"]["id"])
    assert body["user"]["login"] == "arcane.wanderer"
    assert body["accessToken"]
    assert body["tokenType"] == "bearer"
    assert db.user is not None
    assert db.user.password_hash != "Spellbound1"


def test_login_and_me_endpoints_use_the_created_user() -> None:
    db = FakeSession()
    db.user = User(id=uuid4(), login="arcane.wanderer", password_hash=password_hash.hash("Spellbound1"))
    app.dependency_overrides[get_db] = lambda: db
    try:
        client = TestClient(app)
        login_response = client.post(
            "/api/auth/login",
            json={"login": "ARCANE.WANDERER", "password": "Spellbound1"},
        )
        token = login_response.json()["accessToken"]
        me_response = client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
    finally:
        app.dependency_overrides.clear()

    assert login_response.status_code == 200
    assert me_response.status_code == 200
    assert me_response.json() == {"id": str(db.user.id), "login": "arcane.wanderer"}


def test_auth_routes_reject_invalid_credentials() -> None:
    db = FakeSession()
    app.dependency_overrides[get_db] = lambda: db
    try:
        response = TestClient(app).post(
            "/api/auth/register",
            json={"login": "x", "password": "short"},
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 422


def test_register_endpoint_reports_duplicate_login() -> None:
    app.dependency_overrides[get_db] = lambda: DuplicateSession()
    try:
        response = TestClient(app).post(
            "/api/auth/register",
            json={"login": "arcane.wanderer", "password": "Spellbound1"},
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 409
