"""Task steps, deliverables, notes, blockers and explicit progress."""

from alembic import op
import sqlalchemy as sa

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade():
    # Additive migration: all existing tasks and history are preserved.
    with op.batch_alter_table("tasks") as batch:
        batch.add_column(
            sa.Column("blocker_reason", sa.Text(), nullable=False, server_default="")
        )
        batch.add_column(
            sa.Column(
                "progress_mode", sa.String(10), nullable=False, server_default="steps"
            )
        )
        batch.add_column(
            sa.Column(
                "manual_progress", sa.Integer(), nullable=False, server_default="0"
            )
        )
        batch.add_column(
            sa.Column("step_progress", sa.Integer(), nullable=False, server_default="0")
        )
    for name, extra in [
        (
            "task_steps",
            [
                sa.Column("text", sa.String(500), nullable=False),
                sa.Column("position", sa.Integer(), nullable=False),
                sa.Column("checked", sa.Boolean(), nullable=False),
                sa.Column("checked_at", sa.String(40)),
            ],
        ),
        (
            "deliverables",
            [
                sa.Column("description", sa.String(1000), nullable=False),
                sa.Column("state", sa.String(12), nullable=False),
                sa.CheckConstraint("state IN ('pending','ready')"),
            ],
        ),
        (
            "task_notes",
            [
                sa.Column("content", sa.Text(), nullable=False),
                sa.Column(
                    "author_id",
                    sa.String(36),
                    sa.ForeignKey("users.id"),
                    nullable=False,
                ),
            ],
        ),
    ]:
        op.create_table(
            name,
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("workspace_id", sa.String(36), nullable=False),
            sa.Column("task_id", sa.String(36), nullable=False),
            sa.Column("created_at", sa.String(40), nullable=False),
            *extra,
            sa.ForeignKeyConstraint(
                ["workspace_id", "task_id"], ["tasks.workspace_id", "tasks.id"]
            ),
        )
        index = {
            "task_steps": "ix_steps_owner",
            "deliverables": "ix_deliverables_owner",
            "task_notes": "ix_notes_owner",
        }[name]
        op.create_index(index, name, ["workspace_id", "task_id"])
    # PostgreSQL supports adding checks without rebuilding an existing table.
    if op.get_bind().dialect.name == "postgresql":
        op.create_check_constraint(
            "ck_progress_mode", "tasks", "progress_mode IN ('steps','manual')"
        )
        op.create_check_constraint(
            "ck_manual_progress", "tasks", "manual_progress BETWEEN 0 AND 100"
        )
        op.create_check_constraint(
            "ck_step_progress", "tasks", "step_progress BETWEEN 0 AND 100"
        )


def downgrade():
    for name in ("task_notes", "deliverables", "task_steps"):
        op.drop_table(name)
    if op.get_bind().dialect.name == "postgresql":
        for name in ("ck_progress_mode", "ck_manual_progress", "ck_step_progress"):
            op.drop_constraint(name, "tasks", type_="check")
    with op.batch_alter_table("tasks") as batch:
        for column in (
            "step_progress",
            "manual_progress",
            "progress_mode",
            "blocker_reason",
        ):
            batch.drop_column(column)
