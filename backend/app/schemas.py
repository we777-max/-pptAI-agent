from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from .slide_ir import DeckIR


class ProjectCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)


class ProjectRead(ProjectCreate):
    model_config = ConfigDict(from_attributes=True)
    id: str
    status: str
    created_at: datetime | None = None


class DeckCreate(BaseModel):
    project_id: str
    title: str = Field(min_length=1, max_length=200)
    ir: DeckIR


class DeckRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    project_id: str
    title: str
    status: str
    ir: DeckIR
    pptx_path: str | None = None
    created_at: datetime | None = None


class DeckUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    ir: DeckIR | None = None


class AgentSessionCreate(BaseModel):
    project_id: str
    deck_id: str


class AgentSessionRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    project_id: str
    deck_id: str
    status: str
    created_at: datetime | None = None


class AgentAttachment(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    size: int = Field(default=0, ge=0)
    content_type: str = Field(default="application/octet-stream", max_length=160)


class AgentMessageCreate(BaseModel):
    content: str = Field(default="", max_length=12000)
    attachments: list[AgentAttachment] = Field(default_factory=list, max_length=10)


class AgentMessageRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    session_id: str
    role: str
    content: str
    attachments: list[dict] = Field(default_factory=list)
    created_at: datetime | None = None


class AgentRunRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    session_id: str
    deck_id: str
    status: str
    current_step: str | None = None
    error: str | None = None
    created_at: datetime | None = None


class AgentEventRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    run_id: str
    sequence: int
    event_type: str
    payload: dict
    created_at: datetime | None = None


class JobRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    deck_id: str
    status: str
    current_step: str | None = None
    error: str | None = None
    output_path: str | None = None
    created_at: datetime | None = None

