from typing import Annotated, Literal
from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    field_serializer,
    model_validator,
)
from .source_schemas import SourceOut
from .schemas import (
    StrictModel,
    TaskChanges,
    TaskCreate,
    TaskOut,
    TaskResult,
    VersionBody,
)


class Candidate(StrictModel):
    title: str = Field(min_length=1, max_length=200)
    description: str = Field(default="", max_length=10000)
    evidence: str = Field(min_length=1, max_length=1000)
    questions: list[Annotated[str, Field(max_length=500)]] = Field(
        default_factory=list, max_length=8
    )


class Extraction(StrictModel):
    candidates: list[Candidate] = Field(max_length=20)


class ConversationCreate(StrictModel):
    title: str = Field(default="New capture", min_length=1, max_length=120)


class DraftWrite(VersionBody):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=False)
    draft: str = Field(max_length=20000)


class CaptureWrite(VersionBody):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=False)
    content: str = Field(default="", max_length=20000)
    asset_id: str | None = Field(default=None, min_length=1, max_length=36)
    provider: (
        Literal["mock", "openai", "gemini", "mistral", "grok", "openrouter", "deepseek"]
        | None
    ) = None
    live_consent: bool | None = None

    @model_validator(mode="after")
    def one_source(self):
        if self.asset_id and self.content:
            raise ValueError("Choose one source")
        if not self.asset_id and not self.content.strip():
            raise ValueError("Choose a nonempty source")
        return self


class ConversationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    title: str
    draft: str
    version: int
    created_at: str
    updated_at: str
    task_id: str | None = None


class MessageOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    sequence: int
    role: Literal["user", "assistant"]
    content: str
    created_at: str


class ProposalOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    run_id: str
    position: int
    candidate: Candidate
    draft_task: TaskCreate
    review_state: Literal["ready_for_review", "approved", "rejected"]
    version: int
    approved_task_id: str | None
    reviewed_at: str | None


class RunOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    conversation_id: str
    source_message_id: str
    source_asset_id: str | None = None
    provider: str
    model: str | None = None
    upstream: str | None = None
    input_tokens: int | None = None
    output_tokens: int | None = None
    reserved_micro_usd: int | None = None
    state: Literal["completed", "failed"]
    error_code: str | None
    created_at: str


class TaskUpdateOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    run_id: str
    task_id: str
    base_version: int
    before_state: dict
    proposed_changes: TaskChanges
    evidence: str
    questions: list[str]
    version: int
    review_state: Literal["ready_for_review", "approved", "rejected"]
    approved_changes: TaskChanges | None
    reviewed_at: str | None

    @field_serializer("proposed_changes", "approved_changes")
    def explicit_changes(self, value):
        return (
            value.model_dump(mode="json", exclude_unset=True)
            if value is not None
            else None
        )


class ConversationPage(BaseModel):
    conversation: ConversationOut
    messages: list[MessageOut]
    runs: list[RunOut]
    proposals: list[ProposalOut]
    has_older: bool
    sources: list[SourceOut] = Field(default_factory=list)
    task: TaskOut | None = None
    updates: list[TaskUpdateOut] = Field(default_factory=list)


class CaptureResult(BaseModel):
    conversation: ConversationOut
    run: RunOut
    proposals: list[ProposalOut]


class Decision(VersionBody):
    decision: Literal["approve", "reject"]
    task: TaskCreate | None = None


class ProposalEdit(VersionBody):
    task: TaskCreate


class DecisionResult(BaseModel):
    proposal: ProposalOut
    commit: TaskResult | None = None


class TaskSource(BaseModel):
    asset: SourceOut | None = None
    conversation_id: str
    message_id: str
    proposal_id: str
    provider: str
    evidence: str


class TaskAssistantOutput(StrictModel):
    kind: Literal["guidance", "update"]
    reply: str = Field(min_length=1, max_length=5000)
    changes: TaskChanges = Field(default_factory=TaskChanges)
    questions: list[Annotated[str, Field(max_length=500)]] = Field(
        default_factory=list, max_length=8
    )
    evidence: str = Field(default="", max_length=1000)


class TaskRunResult(BaseModel):
    conversation: ConversationOut
    run: RunOut
    updates: list[TaskUpdateOut]


class TaskUpdateDecision(VersionBody):
    decision: Literal["approve", "reject"]
    changes: TaskChanges | None = None


class TaskUpdateResult(BaseModel):
    proposal: TaskUpdateOut
    commit: TaskResult | None = None
