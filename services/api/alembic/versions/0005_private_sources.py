"""Private text source originals and run links; existing tables unchanged."""

from alembic import op
import sqlalchemy as sa

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "source_assets",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("workspace_id", sa.String(36), nullable=False),
        sa.Column("conversation_id", sa.String(36), nullable=False),
        sa.Column("filename", sa.String(180), nullable=False),
        sa.Column("media_type", sa.String(40), nullable=False),
        sa.Column("byte_size", sa.Integer(), nullable=False),
        sa.Column("content_hash", sa.String(64), nullable=False),
        sa.Column("original", sa.LargeBinary(), nullable=False),
        sa.Column("state", sa.String(12), nullable=False),
        sa.Column("error_code", sa.String(40)),
        sa.Column("extracted_text", sa.Text(), nullable=False),
        sa.Column("text_hash", sa.String(64)),
        sa.Column("extractor", sa.String(40), nullable=False),
        sa.Column("created_at", sa.String(40), nullable=False),
        sa.UniqueConstraint("workspace_id", "conversation_id", "id"),
        sa.UniqueConstraint(
            "workspace_id", "conversation_id", "content_hash", "filename"
        ),
        sa.ForeignKeyConstraint(
            ["workspace_id", "conversation_id"],
            ["conversations.workspace_id", "conversations.id"],
        ),
        sa.CheckConstraint("state IN ('ready','failed')"),
        sa.CheckConstraint("byte_size > 0 AND byte_size <= 262144"),
    )
    op.create_index(
        "ix_source_owner", "source_assets", ["workspace_id", "conversation_id"]
    )
    op.create_table(
        "source_run_links",
        sa.Column("workspace_id", sa.String(36), primary_key=True),
        sa.Column("conversation_id", sa.String(36), nullable=False),
        sa.Column("run_id", sa.String(36), primary_key=True),
        sa.Column("asset_id", sa.String(36), nullable=False),
        sa.ForeignKeyConstraint(
            ["workspace_id", "conversation_id", "run_id"],
            ["ai_runs.workspace_id", "ai_runs.conversation_id", "ai_runs.id"],
        ),
        sa.ForeignKeyConstraint(
            ["workspace_id", "conversation_id", "asset_id"],
            [
                "source_assets.workspace_id",
                "source_assets.conversation_id",
                "source_assets.id",
            ],
        ),
    )


def downgrade():
    op.drop_table("source_run_links")
    op.drop_table("source_assets")
