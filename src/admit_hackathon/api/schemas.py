from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator


class Credentials(BaseModel):
    login: str = Field(min_length=3, max_length=64)
    password: str = Field(min_length=8, max_length=256)


class UserResponse(BaseModel):
    model_config = ConfigDict(serialize_by_alias=True)

    id: UUID
    login: str
    display_name: str = Field(serialization_alias="displayName")


class DisplayNameUpdate(BaseModel):
    display_name: str = Field(min_length=2, max_length=64, alias="displayName")

    @field_validator("display_name")
    @classmethod
    def clean_display_name(cls, value: str) -> str:
        normalized = " ".join(value.split())
        if not 2 <= len(normalized) <= 32 or any(ord(char) < 32 or ord(char) == 127 for char in normalized):
            raise ValueError("Display name must be 2–32 visible characters.")
        return normalized


class DuelStatsResponse(BaseModel):
    model_config = ConfigDict(serialize_by_alias=True)

    played: int
    won: int
    lost: int
    drawn: int


class ProfileResponse(BaseModel):
    model_config = ConfigDict(serialize_by_alias=True)

    id: UUID
    login: str
    display_name: str = Field(serialization_alias="displayName")
    created_at: datetime = Field(serialization_alias="createdAt")
    online: DuelStatsResponse


class AuthResponse(BaseModel):
    model_config = ConfigDict(serialize_by_alias=True)

    access_token: str = Field(serialization_alias="accessToken")
    token_type: str = Field(default="bearer", serialization_alias="tokenType")
    expires_in: int = Field(serialization_alias="expiresIn")
    user: UserResponse
