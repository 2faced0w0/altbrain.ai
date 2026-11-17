"""Private bounded source originals and immutable run provenance."""

from sqlalchemy import (
    String,
    Integer,
    Text,
    LargeBinary,
    ForeignKeyConstraint,
    UniqueConstraint,
    Index,
    CheckConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, deferred
from .models import Base, now, uid


class SourceAsset(Base):
    __tablename__ = "source_assets"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    workspace_id: Mapped[str] = mapped_column(String(36))
    conversation_id: Mapped[str] = mapped_column(String(36))
    filename: Mapped[str] = mapped_column(String(180))
    media_type: Mapped[str] = mapped_column(String(40))
    byte_size: Mapped[int] = mapped_column(Integer)
    content_hash: Mapped[str] = mapped_column(String(64))
    original: Mapped[bytes] = deferred(mapped_column(LargeBinary))
    state: Mapped[str] = mapped_column(String(12))
    error_code: Mapped[str | None] = mapped_column(String(40), nullable=True)
    extracted_text: Mapped[str] = deferred(mapped_column(Text))
    text_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    extractor: Mapped[str] = mapped_column(String(40), default="safe-text-v1")
    created_at: Mapped[str] = mapped_column(String(40), default=now)
    __table_args__ = (
        UniqueConstraint("workspace_id", "conversation_id", "id"),
        UniqueConstraint("workspace_id", "conversation_id", "content_hash", "filename"),
        ForeignKeyConstraint(
            ["workspace_id", "conversation_id"],
            ["conversations.workspace_id", "conversations.id"],
        ),
        CheckConstraint("state IN ('ready','failed')"),
        CheckConstraint("byte_size > 0 AND byte_size <= 262144"),
        Index("ix_source_owner", "workspace_id", "conversation_id"),
    )


class SourceRun(Base):
    __tablename__ = "source_run_links"
    workspace_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    conversation_id: Mapped[str] = mapped_column(String(36))
    run_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    asset_id: Mapped[str] = mapped_column(String(36))
    __table_args__ = (
        ForeignKeyConstraint(
            ["workspace_id", "conversation_id", "run_id"],
            ["ai_runs.workspace_id", "ai_runs.conversation_id", "ai_runs.id"],
        ),
        ForeignKeyConstraint(
            ["workspace_id", "conversation_id", "asset_id"],
            [
                "source_assets.workspace_id",
                "source_assets.conversation_id",
                "source_assets.id",
            ],
        ),
    )
