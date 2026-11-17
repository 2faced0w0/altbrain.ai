"""Keycloak OIDC code+PKCE browser boundary; bearer tokens never enter the SPA."""

import base64
import hashlib
import logging
import secrets
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode, urlsplit
import httpx
import jwt
from fastapi import Depends, HTTPException, Query, Request
from fastapi.responses import RedirectResponse, JSONResponse
from pydantic import BaseModel
from sqlalchemy import select, update, delete
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from .auth import cookie_session, subject_key, session_claims
from .models import User, Workspace, Membership, now
from .session_models import LoginTransaction, BrowserSession, AuthAttempt


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def expires(seconds):
    return (datetime.now(timezone.utc) + timedelta(seconds=seconds)).isoformat()


class AuthState(BaseModel):
    mode: str
    authenticated: bool = False
    has_workspace: bool = False
    email: str | None = None
    name: str | None = None
    csrf_token: str | None = None
    expires_at: str | None = None
    login_url: str | None = None
    local_mail_url: str | None = None


class LogoutResult(BaseModel):
    redirect_url: str


class RedactAuthQuery(logging.Filter):
    def filter(self, record):
        if isinstance(record.args, tuple):
            # Match by value so a changed uvicorn argument layout cannot leak codes.
            record.args = tuple(
                value.split("?", 1)[0]
                if isinstance(value, str) and value.startswith("/api/v1/auth/")
                else value
                for value in record.args
            )
        return True


def throttle(app, request, bucket, limit=10):
    # Counters commit independently so rejected requests still consume the budget.
    key = digest(
        bucket
        if bucket.startswith("invite:")
        else bucket + ":" + (request.client.host if request.client else "unknown")
    )
    with Session(app.state.engine) as session:
        session.execute(delete(AuthAttempt).where(AuthAttempt.expires_at < now()))
        count = session.execute(
            update(AuthAttempt)
            .where(AuthAttempt.key_hash == key)
            .values(attempts=AuthAttempt.attempts + 1)
            .returning(AuthAttempt.attempts)
        ).scalar_one_or_none()
        if count is None:
            session.add(AuthAttempt(key_hash=key, attempts=1, expires_at=expires(600)))
            count = 1
        try:
            session.commit()
        except IntegrityError:
            session.rollback()
            raise HTTPException(
                429, "Too many sign-in attempts. Wait ten minutes and try again."
            ) from None
    if count > limit:
        raise HTTPException(
            429, "Too many sign-in attempts. Wait ten minutes and try again."
        )


def valid_return_path(path):
    if not path.startswith("/app/") or "\\" in path:
        return False
    parts = urlsplit(path)
    return not parts.scheme and not parts.netloc and all(ord(c) >= 32 for c in path)


def pkce_challenge(verifier):
    return (
        base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest())
        .rstrip(b"=")
        .decode()
    )


def authorization_url(settings, endpoint, callback, state, nonce, challenge):
    return (
        endpoint
        + "auth?"
        + urlencode(
            {
                "client_id": settings.oidc_client_id,
                "response_type": "code",
                "scope": "openid email profile",
                "redirect_uri": callback,
                "state": state,
                "nonce": nonce,
                "code_challenge": challenge,
                "code_challenge_method": "S256",
            }
        )
    )


def logout_url(settings, endpoint):
    return (
        endpoint
        + "logout?"
        + urlencode(
            {
                "client_id": settings.oidc_client_id,
                "post_logout_redirect_uri": settings.app_origin
                + "/app/today?logged_out=1",
            }
        )
    )


def session_state(settings, session, request):
    mode = (
        "local"
        if settings.local_identity
        else "oidc"
        if settings.browser_auth
        else "unavailable"
    )
    result = AuthState(
        mode=mode,
        login_url="/api/v1/auth/login" if mode == "oidc" else None,
        local_mail_url="http://127.0.0.1:8025"
        if mode == "oidc" and settings.environment == "local"
        else None,
    )
    row = cookie_session(request)
    if not row:
        return result
    user = session.scalar(select(User).where(User.subject == row.claims["sub"]))
    if user and not user.active:
        return result
    membership = (
        session.scalar(
            select(Membership)
            .join(Workspace, Workspace.id == Membership.workspace_id)
            .where(
                Membership.user_id == user.id,
                Workspace.owner_user_id == user.id,
                Membership.role == "owner",
            )
        )
        if user
        else None
    )
    return result.model_copy(
        update={
            "authenticated": True,
            "has_workspace": bool(membership),
            "email": row.claims["email"],
            "name": row.claims.get("name", "Workspace owner"),
            "csrf_token": row.csrf_token,
            "expires_at": row.expires_at,
        }
    )


def store_login_transaction(session, old_browser, return_path):
    """Replace this browser's pending sign-in; return (state, browser, verifier, nonce)."""
    state, browser, verifier, nonce = [secrets.token_urlsafe(40) for _ in range(4)]
    session.execute(
        delete(LoginTransaction).where(LoginTransaction.expires_at <= now())
    )
    session.execute(delete(BrowserSession).where(BrowserSession.expires_at <= now()))
    if old_browser:
        session.execute(
            delete(LoginTransaction).where(
                LoginTransaction.browser_hash == digest(old_browser)
            )
        )
    session.add(
        LoginTransaction(
            state_hash=digest(state),
            browser_hash=digest(browser),
            verifier=verifier,
            nonce=nonce,
            return_path=return_path,
            expires_at=expires(600),
        )
    )
    session.commit()
    return state, browser, verifier, nonce


def consume_login_transaction(session, state, browser):
    """Validate and one-use delete the pending sign-in; None when it is not valid."""
    row = session.get(LoginTransaction, digest(state)) if state else None
    if (
        not row
        or row.expires_at <= now()
        or not browser
        or not secrets.compare_digest(row.browser_hash, digest(browser))
    ):
        return None
    result = (row.verifier, row.nonce, row.return_path)
    consumed = session.execute(
        delete(LoginTransaction).where(
            LoginTransaction.state_hash == row.state_hash,
            LoginTransaction.expires_at > now(),
        )
    )
    session.commit()
    return result if consumed.rowcount == 1 else None


def exchange_code(settings, endpoint, transport, callback, code, verifier):
    with httpx.Client(
        timeout=10, follow_redirects=False, transport=transport
    ) as client:
        token_response = client.post(
            endpoint + "token",
            auth=(settings.oidc_client_id, settings.oidc_client_secret),
            data={
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": callback,
                "code_verifier": verifier,
            },
        )
    token_response.raise_for_status()
    payload = token_response.json()
    if not isinstance(payload, dict):
        raise ValueError()
    id_token = payload.get("id_token", "")
    if not isinstance(id_token, str) or len(id_token) > 20000:
        raise ValueError()
    return id_token


def verify_id_token(jwks, settings, id_token, nonce):
    """Return (verified claims, canonical identity); raise on any invalid token."""
    key = jwks.get_signing_key_from_jwt(id_token)
    claims = jwt.decode(
        id_token,
        key.key,
        algorithms=["RS256"],
        audience=settings.oidc_client_id,
        issuer=settings.oidc_issuer,
        options={"require": ["exp", "iat", "sub", "email", "nonce"]},
    )
    if (
        claims.get("nonce") != nonce
        or claims.get("email_verified") is not True
        or not isinstance(claims.get("sub"), str)
        or len(claims["sub"]) > 250
        or not isinstance(claims.get("email"), str)
        or len(claims["email"]) > 320
        or "@" not in claims["email"]
    ):
        raise ValueError()
    audience = claims.get("aud")
    if (
        isinstance(audience, list) and len(audience) > 1 or "azp" in claims
    ) and claims.get("azp") != settings.oidc_client_id:
        raise ValueError()
    canonical = {
        "sub": subject_key(settings.oidc_issuer, claims["sub"]),
        "email": claims["email"].lower(),
        "email_verified": True,
        "name": str(claims.get("name") or "Workspace owner")[:100],
    }
    return claims, canonical


def create_browser_session(session, settings, old_token, claims, canonical):
    """Rotate the opaque session; return (cookie token, expiry datetime)."""
    token = secrets.token_urlsafe(40)
    if old_token:
        session.execute(
            delete(BrowserSession).where(BrowserSession.token_hash == digest(old_token))
        )
    expiry = min(
        datetime.fromtimestamp(claims["exp"], timezone.utc),
        datetime.now(timezone.utc) + timedelta(hours=1),
    )
    session.add(
        BrowserSession(
            token_hash=digest(token),
            issuer=settings.oidc_issuer,
            claims=canonical,
            csrf_token=secrets.token_urlsafe(32),
            expires_at=expiry.isoformat(),
        )
    )
    session.commit()
    return token, expiry


def install_browser_auth(app, db):
    settings = app.state.settings
    app.state.oidc_jwks = (
        jwt.PyJWKClient(settings.oidc_jwks_url, timeout=5)
        if settings.browser_auth
        else None
    )
    app.state.oidc_transport = None
    logger = logging.getLogger("uvicorn.access")
    if not any(isinstance(item, RedactAuthQuery) for item in logger.filters):
        logger.addFilter(RedactAuthQuery())
    endpoint = settings.oidc_issuer.rstrip("/") + "/protocol/openid-connect/"
    callback = settings.app_origin + "/api/v1/auth/callback"

    def clear_login(response):
        response.delete_cookie(
            "workroom_login",
            path="/api/v1/auth",
            secure=settings.secure_cookie,
            httponly=True,
            samesite="lax",
        )
        return response

    def failed(code):
        return clear_login(
            RedirectResponse(
                settings.app_origin + "/app/today?auth_error=" + code, status_code=303
            )
        )

    @app.get("/api/v1/auth/session", response_model=AuthState)
    def status(request: Request, session: Session = Depends(db)):
        return session_state(settings, session, request)

    @app.get("/api/v1/auth/login")
    def login(
        request: Request,
        return_path: str = Query("/app/today", max_length=500),
        session: Session = Depends(db),
    ):
        if not settings.browser_auth:
            raise HTTPException(503, "Browser sign-in is not configured")
        if not valid_return_path(return_path):
            raise HTTPException(422, "Choose a workspace return path")
        throttle(app, request, "login", 30)
        state, browser, verifier, nonce = store_login_transaction(
            session, request.cookies.get("workroom_login", ""), return_path
        )
        response = RedirectResponse(
            authorization_url(
                settings, endpoint, callback, state, nonce, pkce_challenge(verifier)
            ),
            status_code=303,
        )
        response.set_cookie(
            "workroom_login",
            browser,
            max_age=600,
            path="/api/v1/auth",
            secure=settings.secure_cookie,
            httponly=True,
            samesite="lax",
        )
        response.headers["Referrer-Policy"] = "no-referrer"
        return response

    @app.get("/api/v1/auth/callback")
    def oidc_callback(
        request: Request,
        code: str = Query("", max_length=4096),
        state: str = Query("", max_length=100),
        error: str = Query("", max_length=100),
        session: Session = Depends(db),
    ):
        if not settings.browser_auth:
            return failed("unavailable")
        pending = consume_login_transaction(
            session, state, request.cookies.get("workroom_login", "")
        )
        if not pending:
            return failed("invalid_state")
        verifier, nonce, return_path = pending
        if error or not code:
            return failed("cancelled")
        try:
            id_token = exchange_code(
                settings, endpoint, app.state.oidc_transport, callback, code, verifier
            )
            claims, canonical = verify_id_token(
                app.state.oidc_jwks, settings, id_token, nonce
            )
            existing = session.scalar(
                select(User).where(User.subject == canonical["sub"])
            )
            if existing and not existing.active:
                return failed("account_disabled")
            token, expiry = create_browser_session(
                session,
                settings,
                request.cookies.get("workroom_session", ""),
                claims,
                canonical,
            )
        except (httpx.HTTPError, jwt.PyJWTError, ValueError, TypeError, KeyError):
            session.rollback()
            return failed("sign_in_failed")
        response = clear_login(
            RedirectResponse(settings.app_origin + return_path, status_code=303)
        )
        response.set_cookie(
            "workroom_session",
            token,
            max_age=max(1, int((expiry - datetime.now(timezone.utc)).total_seconds())),
            path="/api",
            secure=settings.secure_cookie,
            httponly=True,
            samesite="lax",
        )
        response.headers["Referrer-Policy"] = "no-referrer"
        return response

    @app.post("/api/v1/auth/logout", response_model=LogoutResult)
    def logout(request: Request, session: Session = Depends(db)):
        session_claims(request)
        token = request.cookies.get("workroom_session", "")
        session.execute(
            delete(BrowserSession).where(BrowserSession.token_hash == digest(token))
        )
        session.commit()
        response = JSONResponse({"redirect_url": logout_url(settings, endpoint)})
        response.delete_cookie(
            "workroom_session",
            path="/api",
            secure=settings.secure_cookie,
            httponly=True,
            samesite="lax",
        )
        return response
