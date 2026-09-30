"""add editable display names and online duel totals

Revision ID: 0002_user_profiles
Revises: 0001_create_users
"""
from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "0002_user_profiles"
down_revision: str | None = "0001_create_users"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("users", sa.Column("display_name", sa.String(length=64), nullable=True))
    op.execute("UPDATE users SET display_name = login")
    op.alter_column("users", "display_name", nullable=False)
    for name in ("duels_played", "duels_won", "duels_lost", "duels_drawn"):
        op.add_column("users", sa.Column(name, sa.Integer(), server_default="0", nullable=False))


def downgrade() -> None:
    for name in ("duels_drawn", "duels_lost", "duels_won", "duels_played"):
        op.drop_column("users", name)
    op.drop_column("users", "display_name")
