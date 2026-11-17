"""Application-owned capture history; proposal state is never task state."""

from sqlalchemy import (
    JSON,
    CheckConstraint,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column
from .models import Base, now, uid


class Conversation(Base):
    __tablename__ = "conversations"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    workspace_id: Mapped[str] = mapped_column(ForeignKey("workspaces.id"))
    title: Mapped[str] = mapped_column(String(120), default="New capture")
    draft: Mapped[str] = mapped_column(Text, default="")
    version: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[str] = mapped_column(String(40), default=now)
    updated_at: Mapped[str] = mapped_column(String(40), default=now)
    __mapper_args__ = {"version_id_col": version}
    __table_args__ = (
        UniqueConstraint("workspace_id", "id"),
        Index("ix_conversation_owner", "workspace_id", "updated_at"),
    )


class Message(Base):
    __tablename__ = "messages"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    workspace_id: Mapped[str] = mapped_column(String(36))
    conversation_id: Mapped[str] = mapped_column(String(36))
    sequence: Mapped[int] = mapped_column(Integer)
    role: Mapped[str] = mapped_column(String(12))
    content: Mapped[str] = mapped_column(Text)
    created_at: Mapped[str] = mapped_column(String(40), default=now)
    __table_args__ = (
        UniqueConstraint("workspace_id", "conversation_id", "id"),
        UniqueConstraint("workspace_id", "conversation_id", "sequence"),
        ForeignKeyConstraint(
            ["workspace_id", "conversation_id"],
            ["conversations.workspace_id", "conversations.id"],
        ),
        CheckConstraint("role IN ('user','assistant')"),
    )


class CaptureRun(Base):
    __tablename__ = "ai_runs"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    workspace_id: Mapped[str] = mapped_column(String(36))
    conversation_id: Mapped[str] = mapped_column(String(36))
    source_message_id: Mapped[str] = mapped_column(String(36))
    source_hash: Mapped[str] = mapped_column(String(64))
    provider: Mapped[str] = mapped_column(String(40), default="deterministic-mock")
    state: Mapped[str] = mapped_column(String(12))
    error_code: Mapped[str | None] = mapped_column(String(40), nullable=True)
    created_at: Mapped[str] = mapped_column(String(40), default=now)
    __table_args__ = (
        UniqueConstraint("workspace_id", "conversation_id", "id"),
        ForeignKeyConstraint(
            ["workspace_id", "conversation_id", "source_message_id"],
            ["messages.workspace_id", "messages.conversation_id", "messages.id"],
        ),
        CheckConstraint("state IN ('completed','failed')"),
        Index("ix_runs_owner", "workspace_id", "conversation_id"),
    )


class Proposal(Base):
    __tablename__ = "ai_proposals"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    workspace_id: Mapped[str] = mapped_column(String(36))
    conversation_id: Mapped[str] = mapped_column(String(36))
    run_id: Mapped[str] = mapped_column(String(36))
    position: Mapped[int] = mapped_column(Integer)
    candidate: Mapped[dict] = mapped_column(JSON)
    draft_task: Mapped[dict] = mapped_column(JSON)
    review_state: Mapped[str] = mapped_column(String(20), default="ready_for_review")
    version: Mapped[int] = mapped_column(Integer, default=1)
    approved_task_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    reviewed_at: Mapped[str | None] = mapped_column(String(40), nullable=True)
    reviewed_by: Mapped[str | None] = mapped_column(
        ForeignKey("users.id"), nullable=True
    )
    committed_result: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[str] = mapped_column(String(40), default=now)
    __mapper_args__ = {"version_id_col": version}
    __table_args__ = (
        ForeignKeyConstraint(
            ["workspace_id", "conversation_id", "run_id"],
            ["ai_runs.workspace_id", "ai_runs.conversation_id", "ai_runs.id"],
        ),
        ForeignKeyConstraint(
            ["workspace_id", "approved_task_id"], ["tasks.workspace_id", "tasks.id"]
        ),
        UniqueConstraint("approved_task_id"),
        CheckConstraint("review_state IN ('ready_for_review','approved','rejected')"),
        Index("ix_proposals_owner", "workspace_id", "run_id"),
    )
