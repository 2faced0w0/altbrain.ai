import hashlib
import json
import secrets
from contextlib import asynccontextmanager
from datetime import timezone
from pathlib import Path
from uuid import uuid4

import jwt
from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from sqlalchemy import create_engine, event, func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from sqlalchemy.orm.exc import StaleDataError

from .auth import Settings, identity
from .calendar import rescheduled_due
from .models import (
    Deliverable,
    Invite,
    Membership,
    Mutation,
    Note,
    Step,
    Task,
    TaskEvent,
    User,
    Workspace,
    now,
)
from .schemas import (
    WallDeadline,
    ResolvedDeadline,
    EventOut,
    MeOut,
    Preferences,
    Redeem,
    Status,
    TaskCreate,
    TaskOut,
    TaskPage,
    TaskPatch,
    TaskResult,
    VersionBody,
    TaskWork,
    StepOut,
    DeliverableOut,
    NoteOut,
    StepWrite,
    DeliverableWrite,
    NoteWrite,
    Reschedule,
)


DOCS_PATHS = frozenset({"/docs", "/redoc", "/docs/oauth2-redirect"})


def create_app(settings: Settings | None = None, engine=None) -> FastAPI:
    settings = settings or Settings.load()
    settings.validate()
    if engine is None:
        if settings.database_url.startswith("sqlite"):
            Path(".local").mkdir(exist_ok=True)
        engine = create_engine(
            settings.database_url,
            connect_args={"check_same_thread": False}
            if settings.database_url.startswith("sqlite")
            else {"connect_timeout": 5},
            pool_pre_ping=True,
        )
    if engine.dialect.name == "sqlite":

        @event.listens_for(engine, "connect")
        def sqlite_foreign_keys(connection, _):
            connection.execute("PRAGMA foreign_keys=ON")

    @asynccontextmanager
    async def lifespan(app):
        # Schema is installed explicitly with Alembic; never create tables on startup.
        yield

    app = FastAPI(title="AI Work Tracker", version="0.1.0", lifespan=lifespan)
    app.state.settings = settings
    app.state.engine = engine
    app.state.local_token = secrets.token_urlsafe(48)
    app.state.jwks = (
        jwt.PyJWKClient(settings.oidc_jwks_url) if settings.oidc_jwks_url else None
    )

    @app.middleware("http")
    async def request_context(request, call_next):
        request.state.correlation_id = str(uuid4())
        response = await call_next(request)
        response.headers["X-Request-ID"] = request.state.correlation_id
        response.headers["Cache-Control"] = "no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers.setdefault("Referrer-Policy", "no-referrer")
        # The interactive API docs load their own scripts, so they keep their own policy.
        if request.url.path not in DOCS_PATHS:
            response.headers.setdefault(
                "Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'"
            )
        return response

    @app.exception_handler(HTTPException)
    async def known_error(request, exc):
        codes = {
            401: "unauthorized",
            403: "forbidden",
            404: "not_found",
            409: "version_conflict",
            422: "validation_error",
        }
        return JSONResponse(
            status_code=exc.status_code,
            content={
                "error": {
                    "code": codes.get(exc.status_code, "request_failed"),
                    "message": str(exc.detail),
                    "retryable": False,
                    "correlation_id": request.state.correlation_id,
                }
            },
        )

    @app.exception_handler(RequestValidationError)
    async def invalid_request(request, exc):
        # Do not echo request input (could contain sensitive content).
        return await known_error(
            request,
            HTTPException(422, "Check the fields, lengths and timezone-aware dates"),
        )

    @app.exception_handler(StaleDataError)
    async def stale(request, exc):
        return await known_error(
            request,
            HTTPException(
                409, "This task changed in another session. Refresh and try again."
            ),
        )

    @app.exception_handler(IntegrityError)
    async def duplicate(request, exc):
        return await known_error(
            request,
            HTTPException(
                409,
                "A concurrent request has already committed. Retry with the same request key.",
            ),
        )

    def db():
        with Session(engine) as session:
            yield session

    def owner(claims=Depends(identity), session: Session = Depends(db)):
        user = session.scalar(
            select(User).where(User.subject == claims["sub"], User.active.is_(True))
        )
        if not user:
            raise HTTPException(403, "A valid beta invitation is required")
        workspace = session.scalar(
            select(Workspace)
            .join(Membership, Membership.workspace_id == Workspace.id)
            .where(
                Membership.user_id == user.id,
                Membership.role == "owner",
                Workspace.owner_user_id == user.id,
            )
        )
        if not workspace:
            raise HTTPException(403, "A private workspace membership is required")
        return user, workspace

    def scoped_task(session, workspace, task_id):
        task = session.scalar(
            select(Task).where(Task.id == task_id, Task.workspace_id == workspace.id)
        )
        if not task:
            raise HTTPException(404, "Task not found")
        return task

    def fingerprint(operation, payload):
        return hashlib.sha256(
            json.dumps([operation, payload], sort_keys=True).encode()
        ).hexdigest()

    def receipt(session, workspace, key, digest):
        old = session.get(Mutation, (workspace.id, key))
        if old:
            if old.fingerprint != digest:
                raise HTTPException(
                    409, "This request key was already used for a different action"
                )
            return old.response
        return None

    def commit(session, user, workspace, task, key, digest, kind, changes):
        session.flush()  # SQLAlchemy version column makes concurrent updates compare-and-swap.
        activity = TaskEvent(
            workspace_id=workspace.id,
            task_id=task.id,
            actor_id=user.id,
            event_type=kind,
            changes=changes,
        )
        session.add(activity)
        session.flush()
        result = TaskResult(
            task=TaskOut.model_validate(task), event=EventOut.model_validate(activity)
        ).model_dump(mode="json")
        session.add(
            Mutation(
                workspace_id=workspace.id, key=key, fingerprint=digest, response=result
            )
        )
        session.commit()  # task, append-only event and replay receipt commit together.
        return result

    def check_version(task, expected):
        if task.version != expected:
            raise HTTPException(
                409, "This task changed in another session. Refresh and try again."
            )

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
        user, workspace = context
        return MeOut(
            name=user.name,
            email=user.email,
            timezone=user.timezone,
            workspace_name=workspace.name,
            local_identity=settings.local_identity,
            local_environment=settings.environment in {"local", "test"},
        )

    @app.patch("/api/v1/workspace/preferences", response_model=MeOut)
    def preferences(
        body: Preferences, context=Depends(owner), session: Session = Depends(db)
    ):
        user, _ = context
        user.timezone = body.timezone
        session.commit()
        return me(context)

    @app.post("/api/v1/workspace/resolve-deadline", response_model=ResolvedDeadline)
    def resolve_deadline(body: WallDeadline, context=Depends(owner)):
        user, _ = context
        return ResolvedDeadline(
            due_at=rescheduled_due(body, None, user.timezone), timezone=user.timezone
        )

    from .browser_auth import install_browser_auth, throttle

    install_browser_auth(app, db)

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
        return me((user, workspace))

    @app.get("/api/v1/tasks", response_model=TaskPage)
    def tasks(
        status: Status | None = None,
        archived: bool = False,
        q: str = Query(default="", max_length=200),
        offset: int = Query(default=0, ge=0),
        limit: int = Query(default=200, ge=1, le=500),
        context=Depends(owner),
        session: Session = Depends(db),
    ):
        _, workspace = context
        query = select(Task).where(Task.workspace_id == workspace.id)
        query = query.where(
            Task.archived_at.is_not(None) if archived else Task.archived_at.is_(None)
        )
        if status:
            query = query.where(Task.status == status)
        if q:
            query = query.where(Task.title.icontains(q, autoescape=True))
        total = session.scalar(select(func.count()).select_from(query.subquery()))
        return {
            "items": session.scalars(
                query.order_by(Task.updated_at.desc(), Task.id)
                .offset(offset)
                .limit(limit)
            ).all(),
            "total": total,
        }

    @app.get("/api/v1/tasks/{task_id}", response_model=TaskOut)
    def detail(task_id: str, context=Depends(owner), session: Session = Depends(db)):
        return scoped_task(session, context[1], task_id)

    @app.get("/api/v1/tasks/{task_id}/events", response_model=list[EventOut])
    def events(task_id: str, context=Depends(owner), session: Session = Depends(db)):
        scoped_task(session, context[1], task_id)
        return session.scalars(
            select(TaskEvent)
            .where(
                TaskEvent.workspace_id == context[1].id, TaskEvent.task_id == task_id
            )
            .order_by(TaskEvent.occurred_at.desc(), TaskEvent.id)
        ).all()

    @app.post("/api/v1/tasks", response_model=TaskResult, status_code=201)
    def create_task(
        body: TaskCreate,
        idempotency_key: str = Header(min_length=8, max_length=100),
        context=Depends(owner),
        session: Session = Depends(db),
    ):
        user, workspace = context
        values = body.model_dump(mode="json")
        if body.due_at:
            values["due_at"] = body.due_at.astimezone(timezone.utc).isoformat()
        digest = fingerprint("create", values)
        replay = receipt(session, workspace, idempotency_key, digest)
        if replay:
            return replay
        task = Task(workspace_id=workspace.id, **values)
        if body.status == "completed":
            task.completed_at = now()
        session.add(task)
        return commit(
            session,
            user,
            workspace,
            task,
            idempotency_key,
            digest,
            "task_created",
            {k: {"before": None, "after": v} for k, v in values.items()},
        )

    @app.patch("/api/v1/tasks/{task_id}", response_model=TaskResult)
    def edit_task(
        task_id: str,
        body: TaskPatch,
        idempotency_key: str = Header(min_length=8, max_length=100),
        context=Depends(owner),
        session: Session = Depends(db),
    ):
        user, workspace = context
        task = scoped_task(session, workspace, task_id)
        digest = fingerprint(
            "edit:" + task_id, body.model_dump(mode="json", exclude_unset=True)
        )
        replay = receipt(session, workspace, idempotency_key, digest)
        if replay:
            return replay
        check_version(task, body.expected_version)
        changes = {}
        values = body.changes.model_dump(mode="json", exclude_unset=True)
        if body.changes.due_at:
            values["due_at"] = body.changes.due_at.astimezone(timezone.utc).isoformat()
        for key, value in values.items():
            if getattr(task, key) != value:
                changes[key] = {"before": getattr(task, key), "after": value}
                setattr(task, key, value)
        if not changes:
            raise HTTPException(422, "No changes to save")
        if "status" in changes:
            task.completed_at = now() if task.status == "completed" else None
        task.updated_at = now()
        return commit(
            session,
            user,
            workspace,
            task,
            idempotency_key,
            digest,
            "task_updated",
            changes,
        )

    def archive_change(task_id, body, key, context, session, archive):
        user, workspace = context
        task = scoped_task(session, workspace, task_id)
        digest = fingerprint(
            ("archive:" if archive else "restore:") + task_id, body.model_dump()
        )
        replay = receipt(session, workspace, key, digest)
        if replay:
            return replay
        check_version(task, body.expected_version)
        previous = task.archived_at
        if (previous is not None) == archive:
            raise HTTPException(422, "Task is already in that archive state")
        task.archived_at = now() if archive else None
        task.updated_at = now()
        return commit(
            session,
            user,
            workspace,
            task,
            key,
            digest,
            "task_archived" if archive else "task_restored",
            {"archived_at": {"before": previous, "after": task.archived_at}},
        )

    @app.post("/api/v1/tasks/{task_id}/archive", response_model=TaskResult)
    def archive(
        task_id: str,
        body: VersionBody,
        idempotency_key: str = Header(min_length=8, max_length=100),
        context=Depends(owner),
        session: Session = Depends(db),
    ):
        return archive_change(task_id, body, idempotency_key, context, session, True)

    @app.post("/api/v1/tasks/{task_id}/restore", response_model=TaskResult)
    def restore(
        task_id: str,
        body: VersionBody,
        idempotency_key: str = Header(min_length=8, max_length=100),
        context=Depends(owner),
        session: Session = Depends(db),
    ):
        return archive_change(task_id, body, idempotency_key, context, session, False)

    @app.get("/api/v1/tasks/{task_id}/work", response_model=TaskWork)
    def work(task_id: str, context=Depends(owner), session: Session = Depends(db)):
        scoped_task(session, context[1], task_id)

        def rows(model, order):
            return session.scalars(
                select(model)
                .where(model.workspace_id == context[1].id, model.task_id == task_id)
                .order_by(*order, model.id)
            ).all()

        return TaskWork(
            steps=[StepOut.model_validate(row) for row in rows(Step, [Step.position])],
            deliverables=[
                DeliverableOut.model_validate(row)
                for row in rows(Deliverable, [Deliverable.created_at])
            ],
            notes=[
                NoteOut.model_validate(row)
                for row in rows(Note, [Note.created_at.desc()])
            ],
        )

    def child_write(task_id, item_id, model, out_schema, body, key, context, session):
        user, workspace = context
        task = scoped_task(session, workspace, task_id)
        item = None
        if item_id:
            item = session.scalar(
                select(model).where(
                    model.id == item_id,
                    model.workspace_id == workspace.id,
                    model.task_id == task.id,
                )
            )
            if not item:
                raise HTTPException(404, "Task item not found")
        digest = fingerprint(
            f"{model.__tablename__}:{task_id}:{item_id}", body.model_dump(mode="json")
        )
        replay = receipt(session, workspace, key, digest)
        if replay:
            return replay
        check_version(task, body.expected_version)
        before = (
            out_schema.model_validate(item).model_dump(mode="json") if item else None
        )
        values = body.model_dump(exclude={"expected_version"})
        if model is Step:
            if values["position"] is None:
                values["position"] = (
                    item.position
                    if item
                    else (
                        session.scalar(
                            select(func.max(Step.position)).where(
                                Step.workspace_id == workspace.id,
                                Step.task_id == task_id,
                            )
                        )
                        or 0
                    )
                    + 1
                )
            values["checked_at"] = (
                (item.checked_at if item and item.checked else now())
                if values["checked"]
                else None
            )
        if item is None:
            item = model(workspace_id=workspace.id, task_id=task.id, **values)
            if model is Note:
                item.author_id = user.id
            session.add(item)
        else:
            for name, value in values.items():
                setattr(item, name, value)
        session.flush()
        after = out_schema.model_validate(item).model_dump(mode="json")
        if before == after:
            raise HTTPException(422, "No changes to save")
        if model is Step:
            steps = session.scalars(
                select(Step).where(
                    Step.workspace_id == workspace.id, Step.task_id == task.id
                )
            ).all()
            task.step_progress = round(
                sum(step.checked for step in steps) / len(steps) * 100
            )
        task.updated_at = now()
        kind = {Step: "step", Deliverable: "deliverable", Note: "note"}[model]
        return commit(
            session,
            user,
            workspace,
            task,
            key,
            digest,
            kind + ("_updated" if before else "_added"),
            {kind: {"before": before, "after": after}},
        )

    @app.post("/api/v1/tasks/{task_id}/steps", response_model=TaskResult)
    def add_step(
        task_id: str,
        body: StepWrite,
        idempotency_key: str = Header(min_length=8, max_length=100),
        context=Depends(owner),
        session: Session = Depends(db),
    ):
        return child_write(
            task_id, None, Step, StepOut, body, idempotency_key, context, session
        )

    @app.patch("/api/v1/tasks/{task_id}/steps/{item_id}", response_model=TaskResult)
    def edit_step(
        task_id: str,
        item_id: str,
        body: StepWrite,
        idempotency_key: str = Header(min_length=8, max_length=100),
        context=Depends(owner),
        session: Session = Depends(db),
    ):
        return child_write(
            task_id, item_id, Step, StepOut, body, idempotency_key, context, session
        )

    @app.post("/api/v1/tasks/{task_id}/deliverables", response_model=TaskResult)
    def add_deliverable(
        task_id: str,
        body: DeliverableWrite,
        idempotency_key: str = Header(min_length=8, max_length=100),
        context=Depends(owner),
        session: Session = Depends(db),
    ):
        return child_write(
            task_id,
            None,
            Deliverable,
            DeliverableOut,
            body,
            idempotency_key,
            context,
            session,
        )

    @app.patch(
        "/api/v1/tasks/{task_id}/deliverables/{item_id}", response_model=TaskResult
    )
    def edit_deliverable(
        task_id: str,
        item_id: str,
        body: DeliverableWrite,
        idempotency_key: str = Header(min_length=8, max_length=100),
        context=Depends(owner),
        session: Session = Depends(db),
    ):
        return child_write(
            task_id,
            item_id,
            Deliverable,
            DeliverableOut,
            body,
            idempotency_key,
            context,
            session,
        )

    @app.post("/api/v1/tasks/{task_id}/notes", response_model=TaskResult)
    def add_note(
        task_id: str,
        body: NoteWrite,
        idempotency_key: str = Header(min_length=8, max_length=100),
        context=Depends(owner),
        session: Session = Depends(db),
    ):
        return child_write(
            task_id, None, Note, NoteOut, body, idempotency_key, context, session
        )

    @app.post("/api/v1/tasks/{task_id}/reschedule", response_model=TaskResult)
    def reschedule(
        task_id: str,
        body: Reschedule,
        idempotency_key: str = Header(min_length=8, max_length=100),
        context=Depends(owner),
        session: Session = Depends(db),
    ):
        user, workspace = context
        task = scoped_task(session, workspace, task_id)
        digest = fingerprint(
            "reschedule:" + task_id,
            {**body.model_dump(mode="json"), "timezone": user.timezone},
        )
        replay = receipt(session, workspace, idempotency_key, digest)
        if replay:
            return replay
        check_version(task, body.expected_version)
        due = rescheduled_due(body, task.due_at, user.timezone)
        if due == task.due_at:
            raise HTTPException(422, "This task is already scheduled for that time")
        before = task.due_at
        task.due_at = due
        task.updated_at = now()
        return commit(
            session,
            user,
            workspace,
            task,
            idempotency_key,
            digest,
            "task_rescheduled",
            {
                "due_at": {"before": before, "after": due},
                "timezone": {"before": user.timezone, "after": user.timezone},
            },
        )

    from .capture import install_capture

    install_capture(app, owner, db, fingerprint, receipt, scoped_task)
    return app


app = create_app()
