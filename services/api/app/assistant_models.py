"""Immutable conversation scope and version-bound proposals for existing tasks."""

from sqlalchemy import (
    JSON,
    CheckConstraint,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    String,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column
from .models import Base, now, uid


class TaskConversation(Base):
    __tablename__ = "task_conversation_context"
    workspace_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    conversation_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    task_id: Mapped[str] = mapped_column(String(36))
    __table_args__ = (
        UniqueConstraint("workspace_id", "conversation_id", "task_id"),
        ForeignKeyConstraint(
            ["workspace_id", "conversation_id"],
            ["conversations.workspace_id", "conversations.id"],
        ),
        ForeignKeyConstraint(
            ["workspace_id", "task_id"], ["tasks.workspace_id", "tasks.id"]
        ),
        UniqueConstraint("workspace_id", "task_id"),
    )


class TaskUpdateProposal(Base):
    __tablename__ = "task_update_proposals"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    workspace_id: Mapped[str] = mapped_column(String(36))
    conversation_id: Mapped[str] = mapped_column(String(36))
    run_id: Mapped[str] = mapped_column(String(36))
    task_id: Mapped[str] = mapped_column(String(36))
    base_version: Mapped[int] = mapped_column(Integer)
    before_state: Mapped[dict] = mapped_column(JSON)
    proposed_changes: Mapped[dict] = mapped_column(JSON)
    evidence: Mapped[str] = mapped_column(String(1000))
    questions: Mapped[list] = mapped_column(JSON)
    version: Mapped[int] = mapped_column(Integer, default=1)
    review_state: Mapped[str] = mapped_column(String(20), default="ready_for_review")
    approved_changes: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    reviewed_at: Mapped[str | None] = mapped_column(String(40), nullable=True)
    reviewed_by: Mapped[str | None] = mapped_column(
        ForeignKey("users.id"), nullable=True
    )
    committed_result: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[str] = mapped_column(String(40), default=now)
    __mapper_args__ = {"version_id_col": version}
    __table_args__ = (
        ForeignKeyConstraint(
            ["workspace_id", "conversation_id", "task_id"],
            [
                "task_conversation_context.workspace_id",
                "task_conversation_context.conversation_id",
                "task_conversation_context.task_id",
            ],
        ),
        ForeignKeyConstraint(
            ["workspace_id", "conversation_id", "run_id"],
            ["ai_runs.workspace_id", "ai_runs.conversation_id", "ai_runs.id"],
        ),
        ForeignKeyConstraint(
            ["workspace_id", "task_id"], ["tasks.workspace_id", "tasks.id"]
        ),
        CheckConstraint("review_state IN ('ready_for_review','approved','rejected')"),
        Index("ix_task_update_owner", "workspace_id", "run_id"),
    )
