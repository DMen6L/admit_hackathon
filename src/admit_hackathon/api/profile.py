"""Authenticated profile details and server-recorded online duel results."""

from datetime import UTC, datetime
from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy import update
from sqlalchemy.orm import Session

from .auth import get_current_user
from .db import get_db
from .models import User
from .schemas import DisplayNameUpdate, DuelStatsResponse, ProfileResponse

router = APIRouter(prefix="/api/profile", tags=["profile"])


def profile_response(user: User) -> ProfileResponse:
    return ProfileResponse(
        id=user.id,
        login=user.login,
        display_name=user.display_name or user.login,
        created_at=user.created_at,
        online=DuelStatsResponse(
            played=user.duels_played or 0,
            won=user.duels_won or 0,
            lost=user.duels_lost or 0,
            drawn=user.duels_drawn or 0,
        ),
    )


@router.get("", response_model=ProfileResponse)
def get_profile(user: User = Depends(get_current_user)) -> ProfileResponse:
    return profile_response(user)


@router.patch("", response_model=ProfileResponse)
def update_profile(
    changes: DisplayNameUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ProfileResponse:
    user.display_name = changes.display_name
    user.updated_at = datetime.now(UTC)
    db.commit()
    db.refresh(user)
    return profile_response(user)


def record_online_result(db: Session, player_ids: tuple[UUID, UUID], winner: int | None) -> None:
    """Persist one finished room result; caller guards duplicate recording per room."""
    # Atomic increments prevent lost updates if an account finishes two rooms close together.
    for seat, player_id in sorted(enumerate(player_ids), key=lambda item: item[1]):
        values = {"duels_played": User.duels_played + 1}
        if winner is None:
            values["duels_drawn"] = User.duels_drawn + 1
        elif winner == seat:
            values["duels_won"] = User.duels_won + 1
        else:
            values["duels_lost"] = User.duels_lost + 1
        db.execute(update(User).where(User.id == player_id).values(**values))
    db.commit()
