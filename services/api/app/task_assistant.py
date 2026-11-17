"""Task assistance is read-only until a version-bound update is approved."""

import hashlib
from datetime import timezone
from fastapi import Depends, Header, HTTPException
from pydantic import ValidationError
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .assistant_models import TaskConversation, TaskUpdateProposal
from .capture_models import CaptureRun, Conversation, Message
from .capture_schemas import (
    CaptureWrite,
    ConversationOut,
    TaskAssistantOutput,
    TaskRunResult,
    TaskUpdateDecision,
    TaskUpdateOut,
    TaskUpdateResult,
    RunOut,
)
from .mock_provider import MockFailure
from .models import Note, Step, TaskEvent, now, uid
from .ai_runtime import link_invocation, run_metadata
from .schemas import EventOut, TaskOut, TaskResult
from .task_mock import DeterministicTaskAssistant


def install_task_assistant(
    app,
    owner,
    db,
    fingerprint,
    receipt,
    scoped_task,
    conversation,
    version,
    finish,
    conversation_out,
):
    app.state.task_assistant_provider = DeterministicTaskAssistant()

    def scoped_proposal(session, workspace, proposal_id):
        row = session.scalar(
            select(TaskUpdateProposal).where(
                TaskUpdateProposal.workspace_id == workspace.id,
                TaskUpdateProposal.id == proposal_id,
            )
        )
        if not row:
            raise HTTPException(404, "Task update proposal not found")
        return row

    @app.post("/api/v1/tasks/{task_id}/assistant", response_model=ConversationOut)
    def open_assistant(
        task_id: str,
        idempotency_key: str = Header(min_length=8, max_length=100),
        context=Depends(owner),
        session: Session = Depends(db),
    ):
        workspace = context[1]
        task = scoped_task(session, workspace, task_id)
        digest = fingerprint("task:assistant:" + task.id, {})
        old = receipt(session, workspace, idempotency_key, digest)
        if old:
            return old
        link = session.scalar(
            select(TaskConversation).where(
                TaskConversation.workspace_id == workspace.id,
                TaskConversation.task_id == task.id,
            )
        )
        if link:
            row = conversation(session, workspace, link.conversation_id)
        else:
            row = Conversation(
                workspace_id=workspace.id, title=("Task: " + task.title)[:120]
            )
            session.add(row)
            session.flush()
            session.add(
                TaskConversation(
                    workspace_id=workspace.id, conversation_id=row.id, task_id=task.id
                )
            )
            session.flush()
        return finish(
            session, workspace, idempotency_key, digest, conversation_out(session, row)
        )

    @app.post(
        "/api/v1/conversations/{conversation_id}/task-runs",
        response_model=TaskRunResult,
    )
    def task_run(
        conversation_id: str,
        body: CaptureWrite,
        idempotency_key: str = Header(min_length=8, max_length=100),
        context=Depends(owner),
        session: Session = Depends(db),
    ):
        workspace = context[1]
        row = conversation(session, workspace, conversation_id)
        link = session.get(TaskConversation, (workspace.id, row.id))
        if not link:
            raise HTTPException(
                422, "Choose a task with Ask assistant before sending task requests"
            )
        if body.asset_id:
            raise HTTPException(422, "Files belong in capture conversations")
        task = scoped_task(session, workspace, link.task_id)
        digest = fingerprint("task:run:" + row.id, body.model_dump(exclude_none=True))
        old = receipt(session, workspace, idempotency_key, digest)
        if old:
            return old
        version(row, body.expected_version)
        runtime = app.state.ai_registry.choose(body.provider)
        runtime.check_consent(body.live_consent)
        snapshot = TaskOut.model_validate(task).model_dump(mode="json")
        steps = session.scalars(
            select(Step)
            .where(Step.workspace_id == workspace.id, Step.task_id == task.id)
            .order_by(Step.position, Step.id)
            .limit(20)
        ).all()
        notes = session.scalars(
            select(Note)
            .where(Note.workspace_id == workspace.id, Note.task_id == task.id)
            .order_by(Note.created_at.desc(), Note.id)
            .limit(5)
        ).all()
        recent = list(
            reversed(
                session.scalars(
                    select(Message)
                    .where(
                        Message.workspace_id == workspace.id,
                        Message.conversation_id == row.id,
                    )
                    .order_by(Message.sequence.desc())
                    .limit(6)
                ).all()
            )
        )
        packet = {
            "task": {**snapshot, "description": snapshot["description"][:4000]},
            "steps": [
                {"id": step.id, "text": step.text, "checked": step.checked}
                for step in steps
            ],
            "notes": [{"id": note.id, "content": note.content[:600]} for note in notes],
            "recent_messages": [
                {
                    "id": message.id,
                    "role": message.role,
                    "content": message.content[:1000],
                }
                for message in recent
            ],
        }
        sequence = (
            session.scalar(
                select(func.max(Message.sequence)).where(
                    Message.workspace_id == workspace.id,
                    Message.conversation_id == row.id,
                )
            )
            or 0
        ) + 1
        source = Message(
            id=uid(),
            workspace_id=workspace.id,
            conversation_id=row.id,
            sequence=sequence,
            role="user",
            content=body.content,
        )
        run = CaptureRun(
            workspace_id=workspace.id,
            conversation_id=row.id,
            source_message_id=source.id,
            source_hash=hashlib.sha256(body.content.encode()).hexdigest(),
            provider=runtime.label("task"),
            state="completed",
        )
        output = None
        invocation_id = None

        def validate_output(value):
            output = TaskAssistantOutput.model_validate(value)
            if output.kind == "guidance" and output.changes.model_dump(
                exclude_unset=True
            ):
                raise ValueError("Guidance cannot carry mutations")
            if output.kind == "update" and (
                not output.evidence or output.evidence not in body.content
            ):
                raise ValueError("Ungrounded task update")
            return output

        try:
            output, invocation_id = runtime.invoke(
                workspace.id,
                idempotency_key,
                "task",
                {"request": body.content, "context": packet},
                validate_output,
                lambda: app.state.task_assistant_provider.respond(body.content, packet),
            )
        except HTTPException:
            raise
        except MockFailure as error:
            invocation_id = getattr(error, "invocation_id", None)
            run.state = "failed"
            run.error_code = (
                error.code
                if error.code
                in {
                    "rate_limited",
                    "quota_exhausted",
                    "invalid_credentials",
                    "interrupted",
                    "budget_exceeded",
                    "provider_not_configured",
                    "context_limit",
                    "timeout",
                    "invalid_output",
                    "output_truncated",
                    "provider_refused",
                }
                else "provider_unavailable"
            )
        except TimeoutError:
            run.state, run.error_code = "failed", "timeout"
        except (ValidationError, ValueError):
            run.state, run.error_code = "failed", "invalid_output"
        except Exception:
            run.state, run.error_code = "failed", "provider_unavailable"
        session.add(source)
        session.flush()
        session.add(run)
        session.flush()
        link_invocation(session, run, invocation_id)
        session.flush()
        updates = []
        if run.state == "completed" and output.kind == "update":
            proposal = TaskUpdateProposal(
                workspace_id=workspace.id,
                conversation_id=row.id,
                run_id=run.id,
                task_id=task.id,
                base_version=task.version,
                before_state=snapshot,
                proposed_changes=output.changes.model_dump(
                    mode="json", exclude_unset=True
                ),
                evidence=output.evidence,
                questions=output.questions,
            )
            session.add(proposal)
            updates.append(proposal)
        reply = (
            "Task assistance failed. Your request and draft are saved; no task changes were made."
            if run.state == "failed"
            else output.reply
        )
        session.add(
            Message(
                workspace_id=workspace.id,
                conversation_id=row.id,
                sequence=sequence + 1,
                role="assistant",
                content=reply,
            )
        )
        row.draft = body.content if run.state == "failed" else ""
        row.updated_at = now()
        session.flush()
        return finish(
            session,
            workspace,
            idempotency_key,
            digest,
            TaskRunResult(
                conversation=conversation_out(session, row),
                run=run_metadata(session, run, RunOut.model_validate(run)),
                updates=[TaskUpdateOut.model_validate(item) for item in updates],
            ),
        )

    @app.post(
        "/api/v1/ai/task-updates/{proposal_id}/decision",
        response_model=TaskUpdateResult,
    )
    def decide_update(
        proposal_id: str,
        body: TaskUpdateDecision,
        idempotency_key: str = Header(min_length=8, max_length=100),
        context=Depends(owner),
        session: Session = Depends(db),
    ):
        user, workspace = context
        row = scoped_proposal(session, workspace, proposal_id)
        task = scoped_task(session, workspace, row.task_id)
        digest = fingerprint(
            "task:update:decision:" + row.id,
            body.model_dump(mode="json", exclude_unset=True),
        )
        old = receipt(session, workspace, idempotency_key, digest)
        if old:
            return old
        requested = (
            body.changes.model_dump(mode="json", exclude_unset=True)
            if body.changes is not None
            else None
        )
        if row.review_state != "ready_for_review":
            if (
                body.decision == "approve"
                and row.review_state == "approved"
                and requested == row.approved_changes
            ):
                return TaskUpdateResult(
                    proposal=TaskUpdateOut.model_validate(row),
                    commit=row.committed_result,
                )
            if body.decision == "reject" and row.review_state == "rejected":
                return TaskUpdateResult(proposal=TaskUpdateOut.model_validate(row))
            raise HTTPException(409, "This update proposal has already been reviewed")
        version(row, body.expected_version)
        result = None
        if body.decision == "approve":
            if task.version != row.base_version or task.archived_at:
                raise HTTPException(
                    409,
                    "The selected task changed after this proposal was prepared. Reload task context and send a new request; this proposal cannot be rebased silently.",
                )
            if not requested:
                raise HTTPException(
                    422, "Choose at least one actual task change before approval"
                )
            values = dict(requested)
            if body.changes.due_at:
                values["due_at"] = body.changes.due_at.astimezone(
                    timezone.utc
                ).isoformat()
            changes = {}
            for key, value in values.items():
                before = getattr(task, key)
                if before != value:
                    changes[key] = {"before": before, "after": value}
                    setattr(task, key, value)
            if not changes:
                raise HTTPException(
                    422,
                    "The chosen fields already match the task; no changes were saved",
                )
            if "status" in changes:
                task.completed_at = now() if task.status == "completed" else None
            task.updated_at = now()
            session.flush()  # task compare-and-swap; losing races roll back all effects
            run = session.scalar(
                select(CaptureRun).where(
                    CaptureRun.workspace_id == workspace.id, CaptureRun.id == row.run_id
                )
            )
            changes["source"] = {
                "before": None,
                "after": {
                    "conversation_id": row.conversation_id,
                    "message_id": run.source_message_id,
                    "proposal_id": row.id,
                    "provider": run.provider,
                    "kind": "task_assistance",
                    "evidence": row.evidence,
                },
            }
            activity = TaskEvent(
                workspace_id=workspace.id,
                task_id=task.id,
                actor_id=user.id,
                event_type="task_updated_from_proposal",
                changes=changes,
            )
            session.add(activity)
            session.flush()
            result = TaskResult(
                task=TaskOut.model_validate(task),
                event=EventOut.model_validate(activity),
            )
            row.review_state = "approved"
            row.approved_changes = requested
            row.committed_result = result.model_dump(mode="json")
        else:
            row.review_state = "rejected"
        row.reviewed_at, row.reviewed_by = now(), user.id
        session.flush()
        return finish(
            session,
            workspace,
            idempotency_key,
            digest,
            TaskUpdateResult(proposal=TaskUpdateOut.model_validate(row), commit=result),
        )
