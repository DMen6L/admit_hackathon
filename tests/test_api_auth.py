from uuid import UUID, uuid4

import jwt
import pytest
from fastapi import HTTPException

from admit_hackathon.api.auth import create_access_token, normalize_login, password_hash
from admit_hackathon.api.models import User
from admit_hackathon.api.settings import get_settings


def test_normalize_login_is_case_insensitive() -> None:
    assert normalize_login("  Arcane.Wanderer ") == "arcane.wanderer"


@pytest.mark.parametrize("login", ["ab", "has space", "UPPER", "bad/login", ""])
def test_normalize_login_rejects_invalid_values(login: str) -> None:
    with pytest.raises(HTTPException):
        normalize_login(login)


def test_password_hash_does_not_match_plaintext() -> None:
    plaintext = "Spellbound1"
    hashed = password_hash.hash(plaintext)

    assert hashed != plaintext
    assert password_hash.verify(plaintext, hashed)
    assert not password_hash.verify("wrong-password", hashed)


def test_access_token_contains_uuid_subject() -> None:
    user = User(id=uuid4(), login="arcane.wanderer", password_hash="unused")
    token, expires_in = create_access_token(user)
    payload = jwt.decode(token, get_settings().jwt_secret, algorithms=[get_settings().jwt_algorithm])

    assert UUID(payload["sub"]) == user.id
    assert payload["type"] == "access"
    assert expires_in == get_settings().jwt_expire_minutes * 60
