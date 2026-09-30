"""persist multiplayer rooms, seats, and ordered events

Revision ID: 0003_multiplayer_rooms
Revises: 0002_user_profiles
"""
from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "0003_multiplayer_rooms"
down_revision: str | None = "0002_user_profiles"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "multiplayer_rooms",
        sa.Column("code", sa.String(length=6), nullable=False),
        sa.Column("phase", sa.String(length=16), nullable=False),
        sa.Column("revision", sa.Integer(), server_default="0", nullable=False),
        sa.Column("snapshot", sa.JSON(), nullable=False),
        sa.Column("winner", sa.Integer(), nullable=True),
        sa.Column("stats_recorded", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("code"),
    )
    op.create_index("ix_multiplayer_rooms_expires_at", "multiplayer_rooms", ["expires_at"])
    op.create_table(
        "multiplayer_room_players",
        sa.Column("room_code", sa.String(length=6), nullable=False),
        sa.Column("seat", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("login", sa.String(length=64), nullable=False),
        sa.Column("display_name", sa.String(length=64), nullable=False),
        sa.Column("connected_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("disconnected_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["room_code"], ["multiplayer_rooms.code"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("room_code", "seat"),
    )
    op.create_index("ix_multiplayer_room_players_user_id", "multiplayer_room_players", ["user_id"])
    op.create_table(
        "multiplayer_room_events",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("room_code", sa.String(length=6), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("event_type", sa.String(length=32), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.ForeignKeyConstraint(["room_code"], ["multiplayer_rooms.code"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("room_code", "revision", name="uq_multiplayer_room_events_revision"),
    )
    op.create_index("ix_multiplayer_room_events_room_code", "multiplayer_room_events", ["room_code"])


def downgrade() -> None:
    op.drop_index("ix_multiplayer_room_events_room_code", table_name="multiplayer_room_events")
    op.drop_table("multiplayer_room_events")
    op.drop_index("ix_multiplayer_room_players_user_id", table_name="multiplayer_room_players")
    op.drop_table("multiplayer_room_players")
    op.drop_index("ix_multiplayer_rooms_expires_at", table_name="multiplayer_rooms")
    op.drop_table("multiplayer_rooms")
