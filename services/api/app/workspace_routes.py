"""Health, local development session, workspace preferences and invitations."""

import hashlib

from fastapi import Depends, HTTPException, Request
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from .auth import identity
from .browser_auth import throttle
from .calendar import rescheduled_due
from .models import Invite, Membership, User, Workspace, now
from .schemas import MeOut, Preferences, Redeem, ResolvedDeadline, WallDeadline


def me_out(settings, context):
    user, workspace = context
    return MeOut(
        name=user.name,
        email=user.email,
        timezone=user.timezone,
        workspace_name=workspace.name,
        local_identity=settings.local_identity,
        local_environment=settings.environment in {"local", "test"},
    )


def install_workspace_routes(app, settings, db, owner):
    @app.get("/api/health")
    def health():
        return {
            "status": "ok",
            "milestone": "M0 + core M1",
            "local_identity": settings.local_identity,
        }

    @app.post("/api/v1/dev/session")
    def local_session(request: Request):
        if not settings.local_identity or request.client.host not in {
            "127.0.0.1",
            "::1",
            "testclient",
        }:
            raise HTTPException(404, "Not found")
        if request.headers.get("x-local-development") != "worktracker":
            raise HTTPException(403, "Local development header required")
        origin = request.headers.get("origin")
        allowed_origins = {"http://127.0.0.1:5173", "http://localhost:5173"}
        if settings.environment == "test":
            allowed_origins.add("http://127.0.0.1:5174")
            allowed_origins.add(settings.app_origin)
        if origin and origin not in allowed_origins:
            raise HTTPException(403, "Local origin required")
        return {
            "access_token": app.state.local_token,
            "identity": "Synthetic local workspace",
        }

    @app.get("/api/v1/me", response_model=MeOut)
    def me(context=Depends(owner)):
        return me_out(settings, context)

    @app.patch("/api/v1/workspace/preferences", response_model=MeOut)
    def preferences(
        body: Preferences, context=Depends(owner), session: Session = Depends(db)
    ):
        user, _ = context
        user.timezone = body.timezone
        session.commit()
        return me_out(settings, context)

    @app.post("/api/v1/workspace/resolve-deadline", response_model=ResolvedDeadline)
    def resolve_deadline(body: WallDeadline, context=Depends(owner)):
        user, _ = context
        return ResolvedDeadline(
            due_at=rescheduled_due(body, None, user.timezone), timezone=user.timezone
        )


def install_invitation_routes(app, db):
    settings = app.state.settings

    @app.post("/api/v1/invitations/redeem", response_model=MeOut)
    def redeem(
        body: Redeem,
        request: Request,
        claims=Depends(identity),
        session: Session = Depends(db),
    ):
        throttle(app, request, "invite:" + claims["sub"], 10)
        digest = hashlib.sha256(body.token.encode()).hexdigest()
        invitation = session.scalar(
            select(Invite).where(
                Invite.token_hash == digest,
                Invite.email == claims["email"].lower(),
                Invite.redeemed_at.is_(None),
                Invite.expires_at > now(),
            )
        )
        if not invitation:
            raise HTTPException(
                403, "Invitation is invalid, expired or already redeemed"
            )
        if session.scalar(select(User).where(User.subject == claims["sub"])):
            raise HTTPException(409, "This account already has a workspace")
        changed = session.execute(
            update(Invite)
            .where(Invite.id == invitation.id, Invite.redeemed_at.is_(None))
            .values(redeemed_at=now())
        )
        if changed.rowcount != 1:
            raise HTTPException(409, "Invitation was already redeemed")
        user = User(
            subject=claims["sub"],
            email=claims["email"].lower(),
            name=claims.get("name", "Workspace owner")[:100],
            timezone=body.timezone,
        )
        session.add(user)
        session.flush()
        workspace = Workspace(owner_user_id=user.id, name="My workspace")
        session.add(workspace)
        session.flush()
        session.add(Membership(workspace_id=workspace.id, user_id=user.id))
        session.commit()
        return me_out(settings, (user, workspace))
