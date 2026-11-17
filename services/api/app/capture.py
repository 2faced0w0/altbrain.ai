"""Mock-first capture routes. No provider calls or task effects before review."""

import hashlib
from datetime import timezone

from fastapi import Depends, Header, HTTPException, Query
from pydantic import ValidationError
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .source_models import SourceAsset, SourceRun
from .source_schemas import SourceOut
from .sources import scoped_asset, install_sources
from .capture_models import CaptureRun, Conversation, Message, Proposal
from .assistant_models import TaskConversation, TaskUpdateProposal
from .capture_schemas import (
    CaptureResult,
    CaptureWrite,
    ConversationCreate,
    ConversationOut,
    ConversationPage,
    Decision,
    DecisionResult,
    DraftWrite,
    Extraction,
    MessageOut,
    ProposalEdit,
    ProposalOut,
    RunOut,
    TaskSource,
    TaskUpdateOut,
)
from .mock_provider import DeterministicProvider, MockFailure
from .models import Mutation, Task, TaskEvent, now, uid
from .ai_registry import install_ai_status
from .ai_runtime import link_invocation, run_metadata
from .schemas import EventOut, TaskCreate, TaskOut, TaskResult


def install_capture(app, owner, db, fingerprint, receipt, scoped_task):
    app.state.capture_provider = DeterministicProvider()
    install_ai_status(app, owner, db)

    def conversation(session, workspace, conversation_id):
        row = session.scalar(
            select(Conversation).where(
                Conversation.workspace_id == workspace.id,
                Conversation.id == conversation_id,
            )
        )
        if not row:
            raise HTTPException(404, "Conversation not found")
        return row

    def proposal(session, workspace, proposal_id):
        row = session.scalar(
            select(Proposal).where(
                Proposal.workspace_id == workspace.id, Proposal.id == proposal_id
            )
        )
        if not row:
            raise HTTPException(404, "Proposal not found")
        return row

    def version(row, expected):
        if row.version != expected:
            raise HTTPException(
                409,
                "This conversation or proposal changed in another session. Reload the latest version; your input is kept.",
            )

    def finish(session, workspace, key, digest, response):
        payload = response.model_dump(mode="json")
        session.add(
            Mutation(
                workspace_id=workspace.id, key=key, fingerprint=digest, response=payload
            )
        )
        session.commit()
        return payload

    def conversation_out(session, row):
        link = session.get(TaskConversation, (row.workspace_id, row.id))
        return ConversationOut.model_validate(row).model_copy(
            update={"task_id": link.task_id if link else None}
        )

    def run_out(session, row):
        link = session.get(SourceRun, (row.workspace_id, row.id))
        return run_metadata(session, row, RunOut.model_validate(row)).model_copy(
            update={"source_asset_id": link.asset_id if link else None}
        )

    @app.get("/api/v1/conversations", response_model=list[ConversationOut])
    def conversations(
        offset: int = Query(0, ge=0),
        limit: int = Query(50, ge=1, le=100),
        context=Depends(owner),
        session: Session = Depends(db),
    ):
        rows = session.scalars(
            select(Conversation)
            .where(Conversation.workspace_id == context[1].id)
            .order_by(Conversation.updated_at.desc(), Conversation.id)
            .offset(offset)
            .limit(limit)
        ).all()
        return [conversation_out(session, row) for row in rows]

    @app.post("/api/v1/conversations", response_model=ConversationOut, status_code=201)
    def create(
        body: ConversationCreate,
        idempotency_key: str = Header(min_length=8, max_length=100),
        context=Depends(owner),
        session: Session = Depends(db),
    ):
        workspace = context[1]
        digest = fingerprint("conversation:create", body.model_dump())
        old = receipt(session, workspace, idempotency_key, digest)
        if old:
            return old
        row = Conversation(workspace_id=workspace.id, title=body.title)
        session.add(row)
        session.flush()
        return finish(
            session,
            workspace,
            idempotency_key,
            digest,
            ConversationOut.model_validate(row),
        )

    @app.get("/api/v1/conversations/{conversation_id}", response_model=ConversationPage)
    def detail(
        conversation_id: str,
        before_sequence: int | None = Query(None, ge=1),
        context=Depends(owner),
        session: Session = Depends(db),
    ):
        workspace = context[1]
        row = conversation(session, workspace, conversation_id)
        query = select(Message).where(
            Message.workspace_id == workspace.id, Message.conversation_id == row.id
        )
        if before_sequence:
            query = query.where(Message.sequence < before_sequence)
        messages = list(
            reversed(
                session.scalars(query.order_by(Message.sequence.desc()).limit(50)).all()
            )
        )
        source_ids = [message.id for message in messages if message.role == "user"]
        runs = session.scalars(
            select(CaptureRun)
            .where(
                CaptureRun.workspace_id == workspace.id,
                CaptureRun.conversation_id == row.id,
                CaptureRun.source_message_id.in_(source_ids),
            )
            .order_by(CaptureRun.created_at, CaptureRun.id)
        ).all()
        proposals = session.scalars(
            select(Proposal)
            .where(
                Proposal.workspace_id == workspace.id,
                Proposal.conversation_id == row.id,
                Proposal.run_id.in_([run.id for run in runs]),
            )
            .order_by(Proposal.created_at, Proposal.position, Proposal.id)
        ).all()
        return ConversationPage(
            conversation=conversation_out(session, row),
            messages=[MessageOut.model_validate(message) for message in messages],
            runs=[run_out(session, run) for run in runs],
            sources=[
                SourceOut.model_validate(item)
                for item in session.scalars(
                    select(SourceAsset)
                    .where(
                        SourceAsset.workspace_id == workspace.id,
                        SourceAsset.conversation_id == row.id,
                    )
                    .order_by(SourceAsset.created_at, SourceAsset.id)
                ).all()
            ],
            proposals=[ProposalOut.model_validate(item) for item in proposals],
            has_older=bool(messages and messages[0].sequence > 1),
            task=TaskOut.model_validate(scoped_task(session, workspace, link.task_id))
            if (link := session.get(TaskConversation, (workspace.id, row.id)))
            else None,
            updates=[
                TaskUpdateOut.model_validate(item)
                for item in session.scalars(
                    select(TaskUpdateProposal)
                    .where(
                        TaskUpdateProposal.workspace_id == workspace.id,
                        TaskUpdateProposal.conversation_id == row.id,
                        TaskUpdateProposal.run_id.in_([run.id for run in runs]),
                    )
                    .order_by(TaskUpdateProposal.created_at, TaskUpdateProposal.id)
                ).all()
            ],
        )

    @app.patch(
        "/api/v1/conversations/{conversation_id}/draft", response_model=ConversationOut
    )
    def draft(
        conversation_id: str,
        body: DraftWrite,
        idempotency_key: str = Header(min_length=8, max_length=100),
        context=Depends(owner),
        session: Session = Depends(db),
    ):
        workspace = context[1]
        row = conversation(session, workspace, conversation_id)
        digest = fingerprint("draft:" + row.id, body.model_dump())
        old = receipt(session, workspace, idempotency_key, digest)
        if old:
            return old
        version(row, body.expected_version)
        row.draft = body.draft
        row.updated_at = now()
        session.flush()
        return finish(
            session,
            workspace,
            idempotency_key,
            digest,
            conversation_out(session, row),
        )

    @app.post(
        "/api/v1/conversations/{conversation_id}/runs", response_model=CaptureResult
    )
    def capture(
        conversation_id: str,
        body: CaptureWrite,
        idempotency_key: str = Header(min_length=8, max_length=100),
        context=Depends(owner),
        session: Session = Depends(db),
    ):
        workspace = context[1]
        row = conversation(session, workspace, conversation_id)
        if session.get(TaskConversation, (workspace.id, row.id)):
            raise HTTPException(
                422,
                "This conversation is scoped to a task; use task assistance instead of task creation",
            )
        digest = fingerprint("capture:" + row.id, body.model_dump(exclude_none=True))
        old = receipt(session, workspace, idempotency_key, digest)
        if old:
            return old
        version(row, body.expected_version)
        asset = (
            scoped_asset(session, workspace, body.asset_id, row.id)
            if body.asset_id
            else None
        )
        if asset and asset.state != "ready":
            raise HTTPException(
                422, "This file has no usable extracted text; choose another source"
            )
        content = asset.extracted_text if asset else body.content
        runtime = app.state.ai_registry.choose(body.provider)
        runtime.check_consent(body.live_consent)
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
            content=content,
        )
        run = CaptureRun(
            workspace_id=workspace.id,
            conversation_id=row.id,
            source_message_id=source.id,
            source_hash=hashlib.sha256(content.encode()).hexdigest(),
            provider=runtime.label("capture"),
            state="completed",
        )
        candidates = []
        invocation_id = None

        def validate_output(value):
            parsed = Extraction.model_validate(value)
            if any(
                candidate.evidence not in content for candidate in parsed.candidates
            ):
                raise ValueError("Ungrounded evidence")
            return parsed

        try:
            output, invocation_id = runtime.invoke(
                workspace.id,
                idempotency_key,
                "capture",
                {"source_text": content},
                validate_output,
                lambda: app.state.capture_provider.extract(content),
            )
            candidates = output.candidates
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
                    "unsupported_image",
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
            # Never leak provider exceptions or source text into logs/responses.
            run.state, run.error_code = "failed", "provider_unavailable"
        session.add(source)
        session.flush()
        session.add(run)
        session.flush()
        link_invocation(session, run, invocation_id)
        if asset:
            session.add(
                SourceRun(
                    workspace_id=workspace.id,
                    conversation_id=row.id,
                    run_id=run.id,
                    asset_id=asset.id,
                )
            )
        session.flush()
        proposals = []
        for position, candidate in enumerate(candidates):
            item = Proposal(
                workspace_id=workspace.id,
                conversation_id=row.id,
                run_id=run.id,
                position=position,
                candidate=candidate.model_dump(),
                draft_task=TaskCreate(
                    title=candidate.title, description=candidate.description
                ).model_dump(mode="json"),
            )
            session.add(item)
            proposals.append(item)
        message = (
            "Capture failed. Your source and draft are saved; retry when ready."
            if run.state == "failed"
            else f"{'AI' if runtime.live else 'Mock'} capture produced {len(proposals)} task proposal(s). Review each before creating a task. No deadline or priority was inferred."
        )
        session.add(
            Message(
                workspace_id=workspace.id,
                conversation_id=row.id,
                sequence=sequence + 1,
                role="assistant",
                content=message,
            )
        )
        row.draft = row.draft if asset else (content if run.state == "failed" else "")
        if row.title == "New capture":
            row.title = asset.filename if asset else content.splitlines()[0][:120]
        row.updated_at = now()
        session.flush()
        return finish(
            session,
            workspace,
            idempotency_key,
            digest,
            CaptureResult(
                conversation=ConversationOut.model_validate(row),
                run=run_out(session, run),
                proposals=[ProposalOut.model_validate(item) for item in proposals],
            ),
        )

    @app.patch("/api/v1/ai/proposals/{proposal_id}", response_model=ProposalOut)
    def edit_proposal(
        proposal_id: str,
        body: ProposalEdit,
        idempotency_key: str = Header(min_length=8, max_length=100),
        context=Depends(owner),
        session: Session = Depends(db),
    ):
        workspace = context[1]
        row = proposal(session, workspace, proposal_id)
        digest = fingerprint("proposal:edit:" + row.id, body.model_dump(mode="json"))
        old = receipt(session, workspace, idempotency_key, digest)
        if old:
            return old
        version(row, body.expected_version)
        if row.review_state != "ready_for_review":
            raise HTTPException(409, "This proposal has already been reviewed")
        row.draft_task = body.task.model_dump(mode="json")
        session.flush()
        return finish(
            session, workspace, idempotency_key, digest, ProposalOut.model_validate(row)
        )

    @app.post(
        "/api/v1/ai/proposals/{proposal_id}/decision", response_model=DecisionResult
    )
    def decision(
        proposal_id: str,
        body: Decision,
        idempotency_key: str = Header(min_length=8, max_length=100),
        context=Depends(owner),
        session: Session = Depends(db),
    ):
        user, workspace = context
        row = proposal(session, workspace, proposal_id)
        digest = fingerprint(
            "proposal:decision:" + row.id, body.model_dump(mode="json")
        )
        old = receipt(session, workspace, idempotency_key, digest)
        if old:
            return old
        if row.review_state != "ready_for_review":
            # A second approval key cannot create another task or change the reviewed payload.
            if (
                body.decision == "approve"
                and row.review_state == "approved"
                and body.task
                and body.task.model_dump(mode="json") == row.draft_task
            ):
                return DecisionResult(
                    proposal=ProposalOut.model_validate(row),
                    commit=row.committed_result,
                )
            if body.decision == "reject" and row.review_state == "rejected":
                return DecisionResult(proposal=ProposalOut.model_validate(row))
            raise HTTPException(409, "This proposal has already been reviewed")
        version(row, body.expected_version)
        result = None
        if body.decision == "approve":
            if body.task is None:
                raise HTTPException(
                    422, "Review and submit task fields before approval"
                )
            values = body.task.model_dump(mode="json")
            if body.task.due_at:
                values = {
                    **values,
                    "due_at": body.task.due_at.astimezone(timezone.utc).isoformat(),
                }
            task = Task(workspace_id=workspace.id, **values)
            if body.task.status == "completed":
                task.completed_at = now()
            session.add(task)
            session.flush()
            run = session.scalar(
                select(CaptureRun).where(
                    CaptureRun.workspace_id == workspace.id, CaptureRun.id == row.run_id
                )
            )
            activity = TaskEvent(
                workspace_id=workspace.id,
                task_id=task.id,
                actor_id=user.id,
                event_type="task_created_from_proposal",
                changes={
                    **{
                        name: {"before": None, "after": value}
                        for name, value in values.items()
                    },
                    "source": {
                        "before": None,
                        "after": {
                            "conversation_id": row.conversation_id,
                            "message_id": run.source_message_id,
                            "proposal_id": row.id,
                            "provider": run.provider,
                            "evidence": row.candidate["evidence"],
                            **(
                                {"asset_id": file_link.asset_id}
                                if (
                                    file_link := session.get(
                                        SourceRun, (workspace.id, run.id)
                                    )
                                )
                                else {}
                            ),
                        },
                    },
                },
            )
            session.add(activity)
            session.flush()
            result = TaskResult(
                task=TaskOut.model_validate(task),
                event=EventOut.model_validate(activity),
            )
            row.approved_task_id = task.id
            row.draft_task = body.task.model_dump(mode="json")
            row.committed_result = result.model_dump(mode="json")
            row.review_state = "approved"
        else:
            row.review_state = "rejected"
        row.reviewed_at, row.reviewed_by = now(), user.id
        session.flush()  # optimistic proposal version prevents concurrent approvals
        return finish(
            session,
            workspace,
            idempotency_key,
            digest,
            DecisionResult(proposal=ProposalOut.model_validate(row), commit=result),
        )

    @app.get("/api/v1/tasks/{task_id}/source", response_model=TaskSource | None)
    def source(task_id: str, context=Depends(owner), session: Session = Depends(db)):
        workspace = context[1]
        scoped_task(session, workspace, task_id)
        row = session.scalar(
            select(Proposal).where(
                Proposal.workspace_id == workspace.id,
                Proposal.approved_task_id == task_id,
            )
        )
        if not row:
            return None
        run = session.scalar(
            select(CaptureRun).where(
                CaptureRun.workspace_id == workspace.id, CaptureRun.id == row.run_id
            )
        )
        file_link = session.get(SourceRun, (workspace.id, run.id))
        return TaskSource(
            asset=SourceOut.model_validate(
                scoped_asset(session, workspace, file_link.asset_id)
            )
            if file_link
            else None,
            conversation_id=row.conversation_id,
            message_id=run.source_message_id,
            proposal_id=row.id,
            provider=run.provider,
            evidence=row.candidate["evidence"],
        )

    install_sources(app, owner, db, fingerprint, receipt, conversation, finish)

    from .task_assistant import install_task_assistant

    install_task_assistant(
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
    )
