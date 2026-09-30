import re
from datetime import UTC, datetime, timedelta
from uuid import UUID

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pwdlib import PasswordHash
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .db import get_db
from .models import User
from .schemas import AuthResponse, Credentials, UserResponse
from .settings import get_settings

password_hash = PasswordHash.recommended()
bearer_scheme = HTTPBearer(auto_error=False)
LOGIN_PATTERN = re.compile(r"^[a-z0-9][a-z0-9_.-]{2,63}$")
INVALID_CREDENTIALS = "The login or password is incorrect."


def normalize_login(login: str) -> str:
    normalized = login.strip().lower()
    if not LOGIN_PATTERN.fullmatch(normalized):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Login must contain 3-64 lowercase letters, numbers, dots, dashes, or underscores.",
        )
    return normalized


def create_access_token(user: User) -> tuple[str, int]:
    settings = get_settings()
    expires_in = settings.jwt_expire_minutes * 60
    now = datetime.now(UTC)
    payload = {
        "sub": str(user.id),
        "iat": now,
        "exp": now + timedelta(seconds=expires_in),
        "type": "access",
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm), expires_in


def auth_response(user: User) -> AuthResponse:
    token, expires_in = create_access_token(user)
    return AuthResponse(
        access_token=token,
        token_type="bearer",
        expires_in=expires_in,
        user=UserResponse(id=user.id, login=user.login, display_name=user.display_name or user.login),
    )


def register_user(credentials: Credentials, db: Session) -> AuthResponse:
    login = normalize_login(credentials.login)
    user = User(login=login, display_name=login, password_hash=password_hash.hash(credentials.password))
    db.add(user)
    try:
        db.commit()
    except IntegrityError as error:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="That login is already in use.") from error
    db.refresh(user)
    return auth_response(user)


def login_user(credentials: Credentials, db: Session) -> AuthResponse:
    login = normalize_login(credentials.login)
    user = db.scalar(select(User).where(User.login == login))
    if user is None or not password_hash.verify(credentials.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=INVALID_CREDENTIALS)
    return auth_response(user)


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> User:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required.")
    return user_from_token(credentials.credentials, db)


def user_from_token(token: str, db: Session) -> User:
    """Use the same JWT and account check for HTTP requests and room sockets."""
    settings = get_settings()
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
        if payload.get("type") != "access":
            raise jwt.InvalidTokenError("Unexpected token type")
        user_id = UUID(str(payload["sub"]))
    except (jwt.InvalidTokenError, KeyError, ValueError) as error:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid authentication token.") from error
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid authentication token.")
    return user
