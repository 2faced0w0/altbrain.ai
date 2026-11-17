"""Browser sessions, PKCE transactions and bounded auth attempt counters."""

from alembic import op
import sqlalchemy as sa

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "oidc_login_transactions",
        sa.Column("state_hash", sa.String(64), primary_key=True),
        sa.Column("browser_hash", sa.String(64), nullable=False),
        sa.Column("verifier", sa.String(128), nullable=False),
        sa.Column("nonce", sa.String(100), nullable=False),
        sa.Column("return_path", sa.String(500), nullable=False),
        sa.Column("expires_at", sa.String(40), nullable=False),
    )
    op.create_index(
        "ix_oidc_login_transactions_expires_at",
        "oidc_login_transactions",
        ["expires_at"],
    )
    op.create_table(
        "browser_sessions",
        sa.Column("token_hash", sa.String(64), primary_key=True),
        sa.Column("issuer", sa.String(300), nullable=False),
        sa.Column("claims", sa.JSON(), nullable=False),
        sa.Column("csrf_token", sa.String(100), nullable=False),
        sa.Column("created_at", sa.String(40), nullable=False),
        sa.Column("expires_at", sa.String(40), nullable=False),
    )
    op.create_index(
        "ix_browser_sessions_expires_at", "browser_sessions", ["expires_at"]
    )
    op.create_table(
        "auth_attempt_windows",
        sa.Column("key_hash", sa.String(64), primary_key=True),
        sa.Column("attempts", sa.Integer(), nullable=False),
        sa.Column("expires_at", sa.String(40), nullable=False),
    )
    op.create_index("ix_auth_window_expiry", "auth_attempt_windows", ["expires_at"])


def downgrade():
    op.drop_table("auth_attempt_windows")
    op.drop_table("browser_sessions")
    op.drop_table("oidc_login_transactions")
