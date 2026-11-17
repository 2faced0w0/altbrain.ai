"""Durable AI attempt reservations, bounded results, and application-run linkage."""

from sqlalchemy import (
    String,
    Integer,
    JSON,
    ForeignKey,
    ForeignKeyConstraint,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column
from .models import Base, uid, now


class AIDailyUse(Base):
    __tablename__ = "ai_daily_usage"
    workspace_id: Mapped[str] = mapped_column(
        ForeignKey("workspaces.id"), primary_key=True
    )
    day: Mapped[str] = mapped_column(String(10), primary_key=True)
    requests: Mapped[int] = mapped_column(Integer, default=0)
    reserved_micro_usd: Mapped[int] = mapped_column(Integer, default=0)


class AIInvocation(Base):
    __tablename__ = "ai_invocations"
    workspace_id: Mapped[str] = mapped_column(
        ForeignKey("workspaces.id"), primary_key=True
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    request_key: Mapped[str] = mapped_column(String(100))
    fingerprint: Mapped[str] = mapped_column(String(64))
    provider: Mapped[str] = mapped_column(String(20))
    model: Mapped[str] = mapped_column(String(100))
    upstream: Mapped[str | None] = mapped_column(String(100), nullable=True)
    operation: Mapped[str] = mapped_column(String(20))
    state: Mapped[str] = mapped_column(String(12))
    error_code: Mapped[str | None] = mapped_column(String(40), nullable=True)
    output: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    input_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    output_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    reserved_micro_usd: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[str] = mapped_column(String(40), default=now)
    finished_at: Mapped[str | None] = mapped_column(String(40), nullable=True)
    __table_args__ = (UniqueConstraint("workspace_id", "request_key"),)


class AIRunLink(Base):
    __tablename__ = "ai_run_invocations"
    workspace_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    run_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    conversation_id: Mapped[str] = mapped_column(String(36))
    invocation_id: Mapped[str] = mapped_column(String(36))
    __table_args__ = (
        ForeignKeyConstraint(
            ["workspace_id", "conversation_id", "run_id"],
            ["ai_runs.workspace_id", "ai_runs.conversation_id", "ai_runs.id"],
        ),
        ForeignKeyConstraint(
            ["workspace_id", "invocation_id"],
            ["ai_invocations.workspace_id", "ai_invocations.id"],
        ),
    )
