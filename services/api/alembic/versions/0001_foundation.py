"""Identity, private workspace, tasks, immutable events and mutation receipts."""

from alembic import op
import sqlalchemy as sa

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "users",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("subject", sa.String(300), nullable=False, unique=True),
        sa.Column("email", sa.String(320), nullable=False, unique=True),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("timezone", sa.String(80), nullable=False),
        sa.Column("active", sa.Boolean(), nullable=False),
    )
    op.create_table(
        "workspaces",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "owner_user_id",
            sa.String(36),
            sa.ForeignKey("users.id"),
            nullable=False,
            unique=True,
        ),
        sa.Column("name", sa.String(100), nullable=False),
    )
    op.create_table(
        "workspace_memberships",
        sa.Column(
            "workspace_id",
            sa.String(36),
            sa.ForeignKey("workspaces.id"),
            primary_key=True,
        ),
        sa.Column(
            "user_id", sa.String(36), sa.ForeignKey("users.id"), primary_key=True
        ),
        sa.Column("role", sa.String(20), nullable=False),
        sa.CheckConstraint("role = 'owner'"),
        sa.UniqueConstraint("user_id"),
    )
    op.create_table(
        "beta_invites",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("token_hash", sa.String(64), nullable=False, unique=True),
        sa.Column("email", sa.String(320), nullable=False),
        sa.Column("expires_at", sa.String(40), nullable=False),
        sa.Column("redeemed_at", sa.String(40)),
    )
    op.create_table(
        "tasks",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "workspace_id",
            sa.String(36),
            sa.ForeignKey("workspaces.id"),
            nullable=False,
        ),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("category", sa.String(60), nullable=False),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("priority", sa.String(10), nullable=False),
        sa.Column("due_at", sa.String(40)),
        sa.Column("completed_at", sa.String(40)),
        sa.Column("archived_at", sa.String(40)),
        sa.Column("created_at", sa.String(40), nullable=False),
        sa.Column("updated_at", sa.String(40), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.UniqueConstraint("workspace_id", "id"),
        sa.CheckConstraint(
            "status IN ('inbox','planned','in_progress','waiting','blocked','in_review','completed','cancelled')"
        ),
        sa.CheckConstraint("priority IN ('low','medium','high','urgent')"),
    )
    op.create_index("ix_tasks_workspace_id", "tasks", ["workspace_id"])
    op.create_index("ix_task_board", "tasks", ["workspace_id", "status", "due_at"])
    op.create_table(
        "task_events",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("workspace_id", sa.String(36), nullable=False),
        sa.Column("task_id", sa.String(36), nullable=False),
        sa.Column("actor_id", sa.String(36), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("event_type", sa.String(40), nullable=False),
        sa.Column("occurred_at", sa.String(40), nullable=False),
        sa.Column("changes", sa.JSON(), nullable=False),
        sa.ForeignKeyConstraint(
            ["workspace_id", "task_id"], ["tasks.workspace_id", "tasks.id"]
        ),
    )
    op.create_index(
        "ix_event_history", "task_events", ["workspace_id", "occurred_at", "task_id"]
    )
    op.create_table(
        "mutation_receipts",
        sa.Column(
            "workspace_id",
            sa.String(36),
            sa.ForeignKey("workspaces.id"),
            primary_key=True,
        ),
        sa.Column("key", sa.String(100), primary_key=True),
        sa.Column("fingerprint", sa.String(64), nullable=False),
        sa.Column("response", sa.JSON(), nullable=False),
    )
    if op.get_bind().dialect.name == "sqlite":
        for action in ("UPDATE", "DELETE"):
            op.execute(
                f"CREATE TRIGGER immutable_events_{action.lower()} BEFORE {action} ON task_events BEGIN SELECT RAISE(ABORT, 'Task history is append-only'); END"
            )
    elif op.get_bind().dialect.name == "postgresql":
        op.execute(
            "CREATE FUNCTION reject_event_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Task history is append-only'; END $$"
        )
        op.execute(
            "CREATE TRIGGER immutable_events BEFORE UPDATE OR DELETE ON task_events FOR EACH ROW EXECUTE FUNCTION reject_event_mutation()"
        )


def downgrade():
    op.drop_table("mutation_receipts")
    op.drop_table("task_events")
    if op.get_bind().dialect.name == "postgresql":
        op.execute("DROP FUNCTION reject_event_mutation()")
    for table in (
        "tasks",
        "beta_invites",
        "workspace_memberships",
        "workspaces",
        "users",
    ):
        op.drop_table(table)
