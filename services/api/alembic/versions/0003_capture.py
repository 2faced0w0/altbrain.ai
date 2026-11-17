"""Durable conversations, source messages, mock capture runs and reviewed proposals."""

from alembic import op
import sqlalchemy as sa

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "conversations",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "workspace_id",
            sa.String(36),
            sa.ForeignKey("workspaces.id"),
            nullable=False,
        ),
        sa.Column("title", sa.String(120), nullable=False),
        sa.Column("draft", sa.Text(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.String(40), nullable=False),
        sa.Column("updated_at", sa.String(40), nullable=False),
        sa.UniqueConstraint("workspace_id", "id"),
    )
    op.create_index(
        "ix_conversation_owner", "conversations", ["workspace_id", "updated_at"]
    )
    op.create_table(
        "messages",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("workspace_id", sa.String(36), nullable=False),
        sa.Column("conversation_id", sa.String(36), nullable=False),
        sa.Column("sequence", sa.Integer(), nullable=False),
        sa.Column("role", sa.String(12), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("created_at", sa.String(40), nullable=False),
        sa.UniqueConstraint("workspace_id", "conversation_id", "id"),
        sa.UniqueConstraint("workspace_id", "conversation_id", "sequence"),
        sa.ForeignKeyConstraint(
            ["workspace_id", "conversation_id"],
            ["conversations.workspace_id", "conversations.id"],
        ),
        sa.CheckConstraint("role IN ('user','assistant')"),
    )
    op.create_table(
        "ai_runs",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("workspace_id", sa.String(36), nullable=False),
        sa.Column("conversation_id", sa.String(36), nullable=False),
        sa.Column("source_message_id", sa.String(36), nullable=False),
        sa.Column("source_hash", sa.String(64), nullable=False),
        sa.Column("provider", sa.String(40), nullable=False),
        sa.Column("state", sa.String(12), nullable=False),
        sa.Column("error_code", sa.String(40)),
        sa.Column("created_at", sa.String(40), nullable=False),
        sa.UniqueConstraint("workspace_id", "conversation_id", "id"),
        sa.ForeignKeyConstraint(
            ["workspace_id", "conversation_id", "source_message_id"],
            ["messages.workspace_id", "messages.conversation_id", "messages.id"],
        ),
        sa.CheckConstraint("state IN ('completed','failed')"),
    )
    op.create_index("ix_runs_owner", "ai_runs", ["workspace_id", "conversation_id"])
    op.create_table(
        "ai_proposals",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("workspace_id", sa.String(36), nullable=False),
        sa.Column("conversation_id", sa.String(36), nullable=False),
        sa.Column("run_id", sa.String(36), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("candidate", sa.JSON(), nullable=False),
        sa.Column("draft_task", sa.JSON(), nullable=False),
        sa.Column("review_state", sa.String(20), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("approved_task_id", sa.String(36), unique=True),
        sa.Column("reviewed_at", sa.String(40)),
        sa.Column("reviewed_by", sa.String(36), sa.ForeignKey("users.id")),
        sa.Column("committed_result", sa.JSON()),
        sa.Column("created_at", sa.String(40), nullable=False),
        sa.ForeignKeyConstraint(
            ["workspace_id", "conversation_id", "run_id"],
            ["ai_runs.workspace_id", "ai_runs.conversation_id", "ai_runs.id"],
        ),
        sa.ForeignKeyConstraint(
            ["workspace_id", "approved_task_id"], ["tasks.workspace_id", "tasks.id"]
        ),
        sa.CheckConstraint(
            "review_state IN ('ready_for_review','approved','rejected')"
        ),
    )
    op.create_index("ix_proposals_owner", "ai_proposals", ["workspace_id", "run_id"])


def downgrade():
    for table in ("ai_proposals", "ai_runs", "messages", "conversations"):
        op.drop_table(table)
