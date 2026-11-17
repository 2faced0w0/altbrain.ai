"""Task list, detail, events, create, edit, archive/restore, work and reschedule."""

from datetime import timezone

from fastapi import Depends, Header, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .calendar import rescheduled_due
from .deps import check_version, commit, fingerprint, receipt, scoped_task
from .models import Deliverable, Note, Step, Task, TaskEvent, now
from .schemas import (
    DeliverableOut,
    EventOut,
    NoteOut,
    Reschedule,
    Status,
    StepOut,
    TaskCreate,
    TaskOut,
    TaskPage,
    TaskPatch,
    TaskResult,
    TaskWork,
    VersionBody,
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


def install_task_routes(app, db, owner):
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


def install_reschedule_route(app, db, owner):
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
