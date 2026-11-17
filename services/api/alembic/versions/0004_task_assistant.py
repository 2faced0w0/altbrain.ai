"""Task-scoped conversations and reviewed updates. Existing tables are unchanged."""

from alembic import op
import sqlalchemy as sa

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "task_conversation_context",
        sa.Column("workspace_id", sa.String(36), primary_key=True),
        sa.Column("conversation_id", sa.String(36), primary_key=True),
        sa.Column("task_id", sa.String(36), nullable=False),
        sa.ForeignKeyConstraint(
            ["workspace_id", "conversation_id"],
            ["conversations.workspace_id", "conversations.id"],
        ),
        sa.ForeignKeyConstraint(
            ["workspace_id", "task_id"], ["tasks.workspace_id", "tasks.id"]
        ),
        sa.UniqueConstraint("workspace_id", "task_id"),
        sa.UniqueConstraint("workspace_id", "conversation_id", "task_id"),
    )
    op.create_table(
        "task_update_proposals",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("workspace_id", sa.String(36), nullable=False),
        sa.Column("conversation_id", sa.String(36), nullable=False),
        sa.Column("run_id", sa.String(36), nullable=False),
        sa.Column("task_id", sa.String(36), nullable=False),
        sa.Column("base_version", sa.Integer(), nullable=False),
        sa.Column("before_state", sa.JSON(), nullable=False),
        sa.Column("proposed_changes", sa.JSON(), nullable=False),
        sa.Column("evidence", sa.String(1000), nullable=False),
        sa.Column("questions", sa.JSON(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("review_state", sa.String(20), nullable=False),
        sa.Column("approved_changes", sa.JSON()),
        sa.Column("reviewed_at", sa.String(40)),
        sa.Column("reviewed_by", sa.String(36), sa.ForeignKey("users.id")),
        sa.Column("committed_result", sa.JSON()),
        sa.Column("created_at", sa.String(40), nullable=False),
        sa.ForeignKeyConstraint(
            ["workspace_id", "conversation_id", "task_id"],
            [
                "task_conversation_context.workspace_id",
                "task_conversation_context.conversation_id",
                "task_conversation_context.task_id",
            ],
        ),
        sa.ForeignKeyConstraint(
            ["workspace_id", "conversation_id", "run_id"],
            ["ai_runs.workspace_id", "ai_runs.conversation_id", "ai_runs.id"],
        ),
        sa.ForeignKeyConstraint(
            ["workspace_id", "task_id"], ["tasks.workspace_id", "tasks.id"]
        ),
        sa.CheckConstraint(
            "review_state IN ('ready_for_review','approved','rejected')"
        ),
    )
    op.create_index(
        "ix_task_update_owner", "task_update_proposals", ["workspace_id", "run_id"]
    )


def downgrade():
    op.drop_table("task_update_proposals")
    op.drop_table("task_conversation_context")
