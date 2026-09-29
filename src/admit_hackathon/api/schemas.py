from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class Credentials(BaseModel):
    login: str = Field(min_length=3, max_length=64)
    password: str = Field(min_length=8, max_length=256)


class UserResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    login: str


class AuthResponse(BaseModel):
    model_config = ConfigDict(serialize_by_alias=True)

    access_token: str = Field(serialization_alias="accessToken")
    token_type: str = Field(default="bearer", serialization_alias="tokenType")
    expires_in: int = Field(serialization_alias="expiresIn")
    user: UserResponse
