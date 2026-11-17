"""Production: verified OIDC JWT. Local: one server-selected synthetic identity.

No client-supplied subject, email or workspace grants access.
"""

import os
import secrets
import hashlib
from urllib.parse import urlsplit
from sqlalchemy.orm import Session
from .session_models import BrowserSession
from .models import now
from dataclasses import dataclass

import jwt
from fastapi import HTTPException, Request


@dataclass(frozen=True)
class Settings:
    environment: str = "local"
    local_identity: bool = False
    database_url: str = "sqlite:///./.local/worktracker.db"
    oidc_issuer: str = ""
    oidc_audience: str = ""
    oidc_jwks_url: str = ""

    app_origin: str = "http://127.0.0.1:5173"
    oidc_client_id: str = ""
    oidc_client_secret: str = ""

    @property
    def browser_auth(self):
        return bool(
            self.oidc_client_id
            and self.oidc_client_secret
            and self.oidc_issuer
            and self.oidc_jwks_url
        )

    @property
    def secure_cookie(self):
        return self.environment not in {"local", "test"} or self.app_origin.startswith(
            "https://"
        )

    @classmethod
    def load(cls):
        return cls(
            environment=os.getenv("APP_ENV", "local"),
            local_identity=os.getenv("LOCAL_IDENTITY", "false").lower() == "true",
            database_url=os.getenv("DATABASE_URL", "sqlite:///./.local/worktracker.db"),
            app_origin=os.getenv("WORKROOM_ORIGIN", "http://127.0.0.1:5173"),
            oidc_client_id=os.getenv("OIDC_CLIENT_ID", ""),
            oidc_client_secret=os.getenv("OIDC_CLIENT_SECRET", ""),
            oidc_issuer=os.getenv("OIDC_ISSUER", ""),
            oidc_audience=os.getenv("OIDC_AUDIENCE", ""),
            oidc_jwks_url=os.getenv("OIDC_JWKS_URL", ""),
        )

    def validate(self):
        local = self.environment in {"local", "test"}
        if self.local_identity and not local:
            raise RuntimeError("Local identity is prohibited outside local/test")
        if self.local_identity and self.oidc_client_id:
            raise RuntimeError("Choose one authentication mode")

        def safe_url(value):
            parsed = urlsplit(value)
            return bool(
                parsed.hostname
                and not parsed.username
                and not parsed.password
                and not parsed.query
                and not parsed.fragment
                and (
                    parsed.scheme == "https"
                    or (
                        local
                        and parsed.scheme == "http"
                        and parsed.hostname in {"127.0.0.1", "localhost", "::1"}
                    )
                )
            )

        if bool(self.oidc_client_id) != bool(self.oidc_client_secret):
            raise RuntimeError("Browser OIDC requires both client ID and secret")
        if self.oidc_client_id and (
            not self.browser_auth
            or not all(
                safe_url(v)
                for v in (self.app_origin, self.oidc_issuer, self.oidc_jwks_url)
            )
            or urlsplit(self.app_origin).path not in {"", "/"}
        ):
            raise RuntimeError(
                "Browser OIDC requires trusted HTTPS endpoints (loopback HTTP is local/test only)"
            )
        if not local and (
            not self.browser_auth
            or not self.oidc_audience
            or not self.database_url.startswith("postgresql")
        ):
            raise RuntimeError("Production requires browser OIDC, HTTPS and PostgreSQL")


def subject_key(issuer, subject):
    return hashlib.sha256(issuer.encode()).hexdigest()[:20] + ":" + subject


def cookie_session(request):
    settings = request.app.state.settings
    token = request.cookies.get("workroom_session", "")
    if not settings.browser_auth or not token or len(token) > 100:
        return None
    with Session(request.app.state.engine) as session:
        row = session.get(BrowserSession, hashlib.sha256(token.encode()).hexdigest())
        if not row or row.expires_at <= now() or row.issuer != settings.oidc_issuer:
            return None
        session.expunge(row)
        return row


def session_claims(request):
    row = cookie_session(request)
    if not row:
        raise HTTPException(401, "Sign in to access your private workspace")
    if request.method not in {"GET", "HEAD", "OPTIONS"}:
        if request.headers.get("origin") != request.app.state.settings.app_origin:
            raise HTTPException(403, "Same-origin request required")
        token = request.headers.get("x-csrf-token", "")
        if not token or not secrets.compare_digest(token, row.csrf_token):
            raise HTTPException(403, "Refresh your session before making changes")
    return row.claims


def identity(request: Request) -> dict:
    settings = request.app.state.settings
    authorization = request.headers.get("authorization", "")
    if not authorization:
        return session_claims(request)
    if not authorization.startswith("Bearer "):
        raise HTTPException(401, "Invalid authorization scheme")
    token = authorization.removeprefix("Bearer ")
    if settings.local_identity and request.client.host in {
        "127.0.0.1",
        "::1",
        "testclient",
    }:
        if secrets.compare_digest(token, request.app.state.local_token):
            return {
                "sub": "local:alex",
                "email": "alex@example.test",
                "name": "Alex Morgan",
            }
    if not token or not request.app.state.jwks:
        raise HTTPException(401, "Sign in to access your private workspace")
    try:
        key = request.app.state.jwks.get_signing_key_from_jwt(token)
        claims = jwt.decode(
            token,
            key.key,
            algorithms=["RS256"],
            audience=settings.oidc_audience,
            issuer=settings.oidc_issuer,
            options={"require": ["exp", "iat", "sub", "email"]},
        )
        if claims.get("email_verified") is not True:
            raise ValueError("Unverified email")
        if settings.browser_auth:
            claims["sub"] = subject_key(settings.oidc_issuer, claims["sub"])
        return claims
    except (jwt.PyJWTError, ValueError):
        raise HTTPException(401, "Your session is invalid or expired") from None
