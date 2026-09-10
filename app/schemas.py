from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class ArtifactOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    kind: str
    name: str
    mime_type: str
    created_at: datetime


class TaskOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    kind: str
    queue: str
    status: str
    progress: float
    attempts: int
    next_run_at: datetime
    last_error: str | None


class JobOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    batch_id: str
    original_name: str
    duration_seconds: float | None
    size_bytes: int
    status: str
    stage: str
    progress: float
    priority: int
    queue_position: int
    scheduled_for: datetime
    is_paused: bool
    cancel_requested: bool
    error: str | None
    created_at: datetime
    updated_at: datetime
    started_at: datetime | None
    completed_at: datetime | None
    tasks: list[TaskOut] = Field(default_factory=list)
    artifacts: list[ArtifactOut] = Field(default_factory=list)


class JobPatch(BaseModel):
    priority: int | None = None
    scheduled_for: datetime | None = None


class ReorderRequest(BaseModel):
    job_ids: list[str] = Field(min_length=1)


class SettingsPatch(BaseModel):
    values: dict[str, Any]


class TokenCreate(BaseModel):
    provider: str = "gemini"
    label: str
    token: str = Field(min_length=8)
    priority: int = 0
    daily_token_limit: int | None = Field(default=None, gt=0)
    daily_request_limit: int | None = Field(default=None, gt=0)


class TokenPatch(BaseModel):
    label: str | None = None
    enabled: bool | None = None
    priority: int | None = None
    daily_token_limit: int | None = Field(default=None, gt=0)
    daily_request_limit: int | None = Field(default=None, gt=0)
    clear_daily_token_limit: bool = False
    clear_daily_request_limit: bool = False


class TokenOut(BaseModel):
    id: str
    provider: str
    label: str
    masked_token: str
    enabled: bool
    priority: int
    cooldown_until: datetime | None
    usage_date: str | None
    prompt_tokens_today: int
    response_tokens_today: int
    total_tokens_today: int
    requests_today: int
    prompt_tokens_total: int
    response_tokens_total: int
    total_tokens_total: int
    requests_total: int
    failures_total: int
    daily_token_limit: int | None
    daily_request_limit: int | None
    remaining_tokens_today: int | None
    remaining_requests_today: int | None
    last_used_at: datetime | None
    last_error: str | None


class EventOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    job_id: str | None
    level: str
    message: str
    created_at: datetime
