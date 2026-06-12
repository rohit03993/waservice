from uuid import UUID

from pydantic import BaseModel, EmailStr, Field, field_validator

from app.utils.phone_e164 import to_e164_india_default


def normalize_e164_phone(v: str) -> str:
    return to_e164_india_default(v)

class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    full_name: str | None = Field(default=None, max_length=120)
    tenant_name: str = Field(min_length=2, max_length=120)
    tenant_slug: str = Field(min_length=2, max_length=120, pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
    phone_e164: str | None = None

    @field_validator("phone_e164", mode="before")
    @classmethod
    def empty_phone_to_none(cls, v: object) -> object:
        if v == "":
            return None
        return v

    @field_validator("phone_e164")
    @classmethod
    def validate_phone(cls, v: str | None) -> str | None:
        if v is None:
            return None
        return normalize_e164_phone(v)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)


class PhoneOtpRequestBody(BaseModel):
    phone_e164: str = Field(min_length=8, max_length=20)

    @field_validator("phone_e164")
    @classmethod
    def validate_phone(cls, v: str) -> str:
        return normalize_e164_phone(v)


class PhoneOtpVerifyBody(BaseModel):
    phone_e164: str = Field(min_length=8, max_length=20)
    code: str = Field(min_length=6, max_length=6, pattern=r"^\d{6}$")

    @field_validator("phone_e164")
    @classmethod
    def validate_phone(cls, v: str) -> str:
        return normalize_e164_phone(v)


class PhoneOtpRequestResponse(BaseModel):
    detail: str = "If this number is on an account, you will receive a text with a code."


class PhoneBindVerifyResponse(BaseModel):
    detail: str = "Phone number saved"
    phone_e164: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class UserProfile(BaseModel):
    id: UUID
    email: EmailStr
    full_name: str | None
    is_active: bool
    phone_e164: str | None = None


class MembershipInfo(BaseModel):
    tenant_id: UUID
    tenant_name: str
    tenant_slug: str
    role: str
    setup_status: str = "pending_meta"


class MeResponse(BaseModel):
    user: UserProfile
    memberships: list[MembershipInfo]
    is_super_admin: bool = False
    allow_open_registration: bool = True


class AuthPublicConfigResponse(BaseModel):
    allow_open_registration: bool
