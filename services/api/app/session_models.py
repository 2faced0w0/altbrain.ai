"""Opaque browser sessions and short-lived OIDC transactions; no provider tokens."""

from sqlalchemy import String, Integer, JSON, Index
from sqlalchemy.orm import Mapped, mapped_column
from .models import Base, now


class LoginTransaction(Base):
    __tablename__ = "oidc_login_transactions"
    state_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    browser_hash: Mapped[str] = mapped_column(String(64))
    verifier: Mapped[str] = mapped_column(String(128))
    nonce: Mapped[str] = mapped_column(String(100))
    return_path: Mapped[str] = mapped_column(String(500))
    expires_at: Mapped[str] = mapped_column(String(40), index=True)


class BrowserSession(Base):
    __tablename__ = "browser_sessions"
    token_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    issuer: Mapped[str] = mapped_column(String(300))
    claims: Mapped[dict] = mapped_column(JSON)
    csrf_token: Mapped[str] = mapped_column(String(100))
    created_at: Mapped[str] = mapped_column(String(40), default=now)
    expires_at: Mapped[str] = mapped_column(String(40), index=True)


class AuthAttempt(Base):
    __tablename__ = "auth_attempt_windows"
    key_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    attempts: Mapped[int] = mapped_column(Integer)
    expires_at: Mapped[str] = mapped_column(String(40))
    __table_args__ = (Index("ix_auth_window_expiry", "expires_at"),)
