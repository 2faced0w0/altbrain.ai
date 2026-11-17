"""AI quota reservations and durable invocation results. No old tables changed."""

from alembic import op
import sqlalchemy as sa

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "ai_daily_usage",
        sa.Column(
            "workspace_id",
            sa.String(36),
            sa.ForeignKey("workspaces.id"),
            primary_key=True,
        ),
        sa.Column("day", sa.String(10), primary_key=True),
        sa.Column("requests", sa.Integer(), nullable=False),
        sa.Column("reserved_micro_usd", sa.Integer(), nullable=False),
    )
    op.create_table(
        "ai_invocations",
        sa.Column(
            "workspace_id",
            sa.String(36),
            sa.ForeignKey("workspaces.id"),
            primary_key=True,
        ),
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("request_key", sa.String(100), nullable=False),
        sa.Column("fingerprint", sa.String(64), nullable=False),
        sa.Column("provider", sa.String(20), nullable=False),
        sa.Column("model", sa.String(100), nullable=False),
        sa.Column("upstream", sa.String(100)),
        sa.Column("operation", sa.String(20), nullable=False),
        sa.Column("state", sa.String(12), nullable=False),
        sa.Column("error_code", sa.String(40)),
        sa.Column("output", sa.JSON()),
        sa.Column("input_tokens", sa.Integer()),
        sa.Column("output_tokens", sa.Integer()),
        sa.Column("reserved_micro_usd", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.String(40), nullable=False),
        sa.Column("finished_at", sa.String(40)),
        sa.UniqueConstraint("workspace_id", "request_key"),
    )
    op.create_table(
        "ai_run_invocations",
        sa.Column("workspace_id", sa.String(36), primary_key=True),
        sa.Column("run_id", sa.String(36), primary_key=True),
        sa.Column("conversation_id", sa.String(36), nullable=False),
        sa.Column("invocation_id", sa.String(36), nullable=False),
        sa.ForeignKeyConstraint(
            ["workspace_id", "conversation_id", "run_id"],
            ["ai_runs.workspace_id", "ai_runs.conversation_id", "ai_runs.id"],
        ),
        sa.ForeignKeyConstraint(
            ["workspace_id", "invocation_id"],
            ["ai_invocations.workspace_id", "ai_invocations.id"],
        ),
    )


def downgrade():
    op.drop_table("ai_run_invocations")
    op.drop_table("ai_invocations")
    op.drop_table("ai_daily_usage")
