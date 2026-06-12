from pydantic import BaseModel, EmailStr, Field


class CreateAgentRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    full_name: str | None = Field(default=None, max_length=120)
    tenant_name: str = Field(min_length=2, max_length=120)
    tenant_slug: str = Field(min_length=2, max_length=120, pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$")


class CreateAgentResponse(BaseModel):
    tenant_id: str
    tenant_name: str
    tenant_slug: str
    setup_status: str
    user_email: str
    user_full_name: str | None


class UpdateAgentRequest(BaseModel):
    is_active: bool


class ResetAgentPasswordRequest(BaseModel):
    password: str = Field(min_length=8, max_length=128)


class AgentActionResponse(BaseModel):
    tenant_id: str
    agent_email: str
    agent_is_active: bool
    detail: str
