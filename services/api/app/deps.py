"""Shared request dependencies and the idempotent task-mutation helpers."""

import hashlib
import json

from fastapi import Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from .auth import identity
from .models import Membership, Mutation, Task, TaskEvent, User, Workspace
from .schemas import EventOut, TaskOut, TaskResult


def make_db(engine):
    def db():
        with Session(engine) as session:
            yield session

    return db


def make_owner(db):
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

    return owner


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
