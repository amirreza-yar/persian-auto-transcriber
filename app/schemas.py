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
    source_mime_type: str | None
    source_format: str | None
    source_codec: str | None
    sample_rate: int | None
    channels: int | None
    bit_rate: int | None
    source_available: bool
    description: str | None
    tags: list[str] = Field(default_factory=list)
    status: str
    stage: str
    progress: float
    priority: int
    queue_position: int
    scheduled_for: datetime
    is_paused: bool
    cancel_requested: bool
    error: str | None
    transcription_config: dict[str, Any] | None = None
    cleaning_config: dict[str, Any] | None = None
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


class JobHistoryPage(BaseModel):
    total: int
    offset: int
    limit: int
    items: list[JobOut]


class BatchPatch(BaseModel):
    name: str | None = None
    description: str | None = None


class BatchOut(BaseModel):
    id: str
    name: str | None
    description: str | None
    status: str
    progress: float
    total_jobs: int
    completed_jobs: int
    failed_jobs: int
    running_jobs: int
    queued_jobs: int
    created_at: datetime
    updated_at: datetime
    jobs: list[JobOut] = Field(default_factory=list)


class AudioFileOut(BaseModel):
    id: str
    job_id: str
    batch_id: str
    name: str
    duration_seconds: float | None
    size_bytes: int
    mime_type: str | None
    format: str | None
    codec: str | None
    sample_rate: int | None
    channels: int | None
    bit_rate: int | None
    source_available: bool
    description: str | None
    tags: list[str]
    job_status: str
    created_at: datetime


class AudioFilePatch(BaseModel):
    description: str | None = None
    tags: list[str] | None = None


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
    batch_id: str | None
    event_type: str
    level: str
    message: str
    data: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime


class WorkerStateOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    queue: str
    status: str
    current_job_id: str | None
    model_name: str | None
    detail: str | None
    started_at: datetime
    heartbeat_at: datetime
    updated_at: datetime
    stale: bool = False


class CircuitBreakerOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    name: str
    state: str
    consecutive_failures: int
    opened_until: datetime | None
    last_error: str | None
    last_failure_at: datetime | None
    last_success_at: datetime | None
    updated_at: datetime
