from fastapi import APIRouter, Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from sqlalchemy.orm import Session

from .auth import get_current_user, login_user, register_user
from .db import get_db
from .schemas import AuthResponse, Credentials, UserResponse
from .settings import get_settings

settings = get_settings()
app = FastAPI(title="Webcam Magic API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    # Vite uses different ports for dev and preview. Keep local browser
    # development working without requiring a backend rebuild for each port.
    allow_origin_regex=r"https?://(localhost|127\.0\.0\.1)(:\d+)?$",
    allow_credentials=True,
    allow_methods=["GET", "POST"],
    allow_headers=["Authorization", "Content-Type"],
)

auth_router = APIRouter(prefix="/api/auth", tags=["auth"])


@auth_router.post("/register", response_model=AuthResponse, status_code=201)
def register(credentials: Credentials, db: Session = Depends(get_db)) -> AuthResponse:
    return register_user(credentials, db)


@auth_router.post("/login", response_model=AuthResponse)
def login(credentials: Credentials, db: Session = Depends(get_db)) -> AuthResponse:
    return login_user(credentials, db)


@auth_router.get("/me", response_model=UserResponse)
def me(user=Depends(get_current_user)) -> UserResponse:
    return UserResponse.model_validate(user)


app.include_router(auth_router)


@app.get("/")
def root() -> dict[str, str]:
    return {"service": "Webcam Magic API", "health": "/health"}


@app.get("/health")
def health(db: Session = Depends(get_db)) -> dict[str, str]:
    db.execute(text("SELECT 1"))
    return {"status": "ok"}
