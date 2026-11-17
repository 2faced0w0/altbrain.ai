"""Checklist steps, deliverables and notes written through one idempotent path."""

from fastapi import Depends, Header, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .deps import check_version, commit, fingerprint, receipt, scoped_task
from .models import Deliverable, Note, Step, now
from .schemas import (
    DeliverableOut,
    DeliverableWrite,
    NoteOut,
    NoteWrite,
    StepOut,
    StepWrite,
    TaskResult,
)


def step_values(session, workspace, task_id, item, values):
    """Fill the position and checked_at fields a step write derives."""
    position = values["position"]
    if position is None:
        position = (
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
    checked_at = (
        (item.checked_at if item and item.checked else now())
        if values["checked"]
        else None
    )
    return {**values, "position": position, "checked_at": checked_at}


def refresh_step_progress(session, workspace, task):
    steps = session.scalars(
        select(Step).where(Step.workspace_id == workspace.id, Step.task_id == task.id)
    ).all()
    task.step_progress = round(sum(step.checked for step in steps) / len(steps) * 100)


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
    before = out_schema.model_validate(item).model_dump(mode="json") if item else None
    values = body.model_dump(exclude={"expected_version"})
    if model is Step:
        values = step_values(session, workspace, task_id, item, values)
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
        refresh_step_progress(session, workspace, task)
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


def install_task_item_routes(app, db, owner):
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
