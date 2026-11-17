from datetime import date, datetime, time
from typing import Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import BaseModel, ConfigDict, Field, field_validator

Status = Literal[
    "inbox",
    "planned",
    "in_progress",
    "waiting",
    "blocked",
    "in_review",
    "completed",
    "cancelled",
]
Priority = Literal["low", "medium", "high", "urgent"]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class TaskCreate(StrictModel):
    title: str = Field(min_length=1, max_length=200)
    description: str = Field(default="", max_length=10000)
    category: str = Field(default="General", min_length=1, max_length=60)
    status: Status = "inbox"
    priority: Priority = "medium"
    due_at: datetime | None = None
    blocker_reason: str = Field(default="", max_length=2000)
    progress_mode: Literal["steps", "manual"] = "steps"
    manual_progress: int = Field(default=0, ge=0, le=100)

    @field_validator("due_at")
    @classmethod
    def aware_date(cls, v):
        if v is not None and v.tzinfo is None:
            raise ValueError("Include a timezone offset")
        return v


class TaskChanges(StrictModel):
    blocker_reason: str | None = Field(default=None, max_length=2000)
    progress_mode: Literal["steps", "manual"] | None = None
    manual_progress: int | None = Field(default=None, ge=0, le=100)
    title: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=10000)
    category: str | None = Field(default=None, min_length=1, max_length=60)
    status: Status | None = None
    priority: Priority | None = None
    due_at: datetime | None = None
    _aware_date = field_validator("due_at")(TaskCreate.aware_date.__func__)

    @field_validator(
        "title",
        "description",
        "category",
        "status",
        "priority",
        "blocker_reason",
        "progress_mode",
        "manual_progress",
    )
    @classmethod
    def not_null(cls, v):
        if v is None:
            raise ValueError("This field cannot be null")
        return v


class TaskPatch(StrictModel):
    expected_version: int = Field(ge=1)
    changes: TaskChanges


class VersionBody(StrictModel):
    expected_version: int = Field(ge=1)


class TaskOut(TaskCreate):
    model_config = ConfigDict(from_attributes=True)
    id: str
    version: int
    created_at: str
    updated_at: str
    completed_at: str | None
    archived_at: str | None
    step_progress: int


class EventOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    task_id: str
    event_type: str
    occurred_at: str
    changes: dict


class TaskResult(BaseModel):
    task: TaskOut
    event: EventOut


class TaskPage(BaseModel):
    items: list[TaskOut]
    total: int


class MeOut(BaseModel):
    name: str
    email: str
    timezone: str
    workspace_name: str
    local_identity: bool
    local_environment: bool = False


class Preferences(StrictModel):
    timezone: str

    @field_validator("timezone")
    @classmethod
    def valid_zone(cls, value):
        try:
            ZoneInfo(value)
        except ZoneInfoNotFoundError:
            raise ValueError("Unknown IANA timezone") from None
        return value


class Redeem(StrictModel):
    token: str = Field(min_length=16, max_length=200)
    timezone: str = "Asia/Kolkata"
    _valid_zone = field_validator("timezone")(Preferences.valid_zone.__func__)


class StepWrite(VersionBody):
    text: str = Field(min_length=1, max_length=500)
    checked: bool = False
    position: int | None = Field(default=None, ge=0, le=10000)


class DeliverableWrite(VersionBody):
    description: str = Field(min_length=1, max_length=1000)
    state: Literal["pending", "ready"] = "pending"


class NoteWrite(VersionBody):
    content: str = Field(min_length=1, max_length=10000)


class StepOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    text: str
    position: int
    checked: bool
    checked_at: str | None
    created_at: str


class DeliverableOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    description: str
    state: Literal["pending", "ready"]
    created_at: str


class NoteOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    content: str
    created_at: str


class TaskWork(BaseModel):
    steps: list[StepOut]
    deliverables: list[DeliverableOut]
    notes: list[NoteOut]


class WallDeadline(StrictModel):
    local_date: date
    local_time: time | None = None
    fold: Literal[0, 1] | None = None

    @field_validator("local_time")
    @classmethod
    def wall_time(cls, value):
        if value is not None and value.tzinfo is not None:
            raise ValueError("Use workspace local time without an offset")
        return value


class Reschedule(WallDeadline, VersionBody):
    pass


class ResolvedDeadline(BaseModel):
    due_at: str
    timezone: str
