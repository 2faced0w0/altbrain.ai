"""Tenant-owned foundation. Events have no update/delete API."""

from datetime import datetime, timezone
from uuid import uuid4

from sqlalchemy import (
    JSON,
    Boolean,
    CheckConstraint,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


def uid() -> str:
    return str(uuid4())


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    subject: Mapped[str] = mapped_column(String(300), unique=True)
    email: Mapped[str] = mapped_column(String(320), unique=True)
    name: Mapped[str] = mapped_column(String(100))
    timezone: Mapped[str] = mapped_column(String(80), default="Asia/Kolkata")
    active: Mapped[bool] = mapped_column(Boolean, default=True)


class Workspace(Base):
    __tablename__ = "workspaces"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    owner_user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), unique=True)
    name: Mapped[str] = mapped_column(String(100))


class Membership(Base):
    __tablename__ = "workspace_memberships"
    workspace_id: Mapped[str] = mapped_column(
        ForeignKey("workspaces.id"), primary_key=True
    )
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), primary_key=True)
    role: Mapped[str] = mapped_column(String(20), default="owner")
    __table_args__ = (CheckConstraint("role = 'owner'"), UniqueConstraint("user_id"))


class Invite(Base):
    __tablename__ = "beta_invites"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    email: Mapped[str] = mapped_column(String(320))
    expires_at: Mapped[str] = mapped_column(String(40))
    redeemed_at: Mapped[str | None] = mapped_column(String(40), nullable=True)


class Task(Base):
    __tablename__ = "tasks"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    workspace_id: Mapped[str] = mapped_column(ForeignKey("workspaces.id"), index=True)
    title: Mapped[str] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(Text, default="")
    category: Mapped[str] = mapped_column(String(60), default="General")
    status: Mapped[str] = mapped_column(String(20), default="inbox")
    priority: Mapped[str] = mapped_column(String(10), default="medium")
    due_at: Mapped[str | None] = mapped_column(String(40), nullable=True)
    completed_at: Mapped[str | None] = mapped_column(String(40), nullable=True)
    archived_at: Mapped[str | None] = mapped_column(String(40), nullable=True)
    created_at: Mapped[str] = mapped_column(String(40), default=now)
    updated_at: Mapped[str] = mapped_column(String(40), default=now)
    version: Mapped[int] = mapped_column(Integer, default=1)
    blocker_reason: Mapped[str] = mapped_column(Text, default="")
    progress_mode: Mapped[str] = mapped_column(String(10), default="steps")
    manual_progress: Mapped[int] = mapped_column(Integer, default=0)
    step_progress: Mapped[int] = mapped_column(Integer, default=0)
    __mapper_args__ = {"version_id_col": version}
    __table_args__ = (
        UniqueConstraint("workspace_id", "id"),
        CheckConstraint(
            "status IN ('inbox','planned','in_progress','waiting','blocked','in_review','completed','cancelled')"
        ),
        CheckConstraint("priority IN ('low','medium','high','urgent')"),
        CheckConstraint("progress_mode IN ('steps','manual')"),
        CheckConstraint("manual_progress BETWEEN 0 AND 100"),
        CheckConstraint("step_progress BETWEEN 0 AND 100"),
        Index("ix_task_board", "workspace_id", "status", "due_at"),
    )


class TaskEvent(Base):
    __tablename__ = "task_events"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    workspace_id: Mapped[str] = mapped_column(String(36))
    task_id: Mapped[str] = mapped_column(String(36))
    actor_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    event_type: Mapped[str] = mapped_column(String(40))
    occurred_at: Mapped[str] = mapped_column(String(40), default=now)
    changes: Mapped[dict] = mapped_column(JSON)
    __table_args__ = (
        ForeignKeyConstraint(
            ["workspace_id", "task_id"], ["tasks.workspace_id", "tasks.id"]
        ),
        Index("ix_event_history", "workspace_id", "occurred_at", "task_id"),
    )


class Mutation(Base):
    __tablename__ = "mutation_receipts"
    workspace_id: Mapped[str] = mapped_column(
        ForeignKey("workspaces.id"), primary_key=True
    )
    key: Mapped[str] = mapped_column(String(100), primary_key=True)
    fingerprint: Mapped[str] = mapped_column(String(64))
    response: Mapped[dict] = mapped_column(JSON)


class TaskChild:
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    workspace_id: Mapped[str] = mapped_column(String(36))
    task_id: Mapped[str] = mapped_column(String(36))
    created_at: Mapped[str] = mapped_column(String(40), default=now)


class Step(TaskChild, Base):
    __tablename__ = "task_steps"
    text: Mapped[str] = mapped_column(String(500))
    position: Mapped[int] = mapped_column(Integer)
    checked: Mapped[bool] = mapped_column(Boolean, default=False)
    checked_at: Mapped[str | None] = mapped_column(String(40), nullable=True)
    __table_args__ = (
        ForeignKeyConstraint(
            ["workspace_id", "task_id"], ["tasks.workspace_id", "tasks.id"]
        ),
        Index("ix_steps_owner", "workspace_id", "task_id"),
    )


class Deliverable(TaskChild, Base):
    __tablename__ = "deliverables"
    description: Mapped[str] = mapped_column(String(1000))
    state: Mapped[str] = mapped_column(String(12), default="pending")
    __table_args__ = (
        ForeignKeyConstraint(
            ["workspace_id", "task_id"], ["tasks.workspace_id", "tasks.id"]
        ),
        CheckConstraint("state IN ('pending','ready')"),
        Index("ix_deliverables_owner", "workspace_id", "task_id"),
    )


class Note(TaskChild, Base):
    __tablename__ = "task_notes"
    content: Mapped[str] = mapped_column(Text)
    author_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    __table_args__ = (
        ForeignKeyConstraint(
            ["workspace_id", "task_id"], ["tasks.workspace_id", "tasks.id"]
        ),
        Index("ix_notes_owner", "workspace_id", "task_id"),
    )
