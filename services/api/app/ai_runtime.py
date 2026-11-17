"""At-most-once provider attempts with independent, conservative quota reservations."""

import hashlib
import json
import math
from datetime import datetime, timezone
from fastapi import HTTPException
from sqlalchemy import select, update
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from .ai_models import AIDailyUse, AIInvocation, AIRunLink
from .ai_config import AISettings
from .models import now, uid
from .mock_provider import MockFailure

PROMPT_VERSION = "workroom-live-v1"


class AIFailure(MockFailure):
    def __init__(self, code, invocation_id=None):
        super().__init__(code)
        self.invocation_id = invocation_id


class AIRuntime:
    def __init__(self, engine, config=None, adapter=None):
        self.engine = engine
        self.config = config or AISettings()
        self.adapter = adapter

    @property
    def live(self):
        return self.config.provider != "mock"

    def label(self, operation):
        return (
            self.config.provider
            if self.live
            else "deterministic-task-mock"
            if operation == "task"
            else "deterministic-mock"
        )

    def check_consent(self, consent):
        if self.live and consent is not True:
            raise HTTPException(
                422, "Confirm external processing for this request before sending"
            )

    def _existing(self, session, workspace_id, key, fingerprint):
        row = session.scalar(
            select(AIInvocation).where(
                AIInvocation.workspace_id == workspace_id,
                AIInvocation.request_key == key,
            )
        )
        if not row:
            return None
        if row.fingerprint != fingerprint:
            raise HTTPException(
                409,
                "The task context, model or request changed. Reload and prepare a new request; your input is kept.",
            )
        if row.state == "running":
            raise HTTPException(
                409,
                "This AI request is still running or its result is uncertain. Check conversation history before sending a new request.",
            )
        if row.state == "failed":
            raise AIFailure(row.error_code, row.id)
        return row.output, row.id

    def invoke(self, workspace_id, key, operation, payload, validator, mock):
        if not self.live:
            return validator(mock()), None
        cfg = self.config
        if not cfg.ready:
            raise AIFailure("provider_not_configured")
        packed = json.dumps(
            payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")
        )
        if len(packed.encode()) > cfg.max_input_bytes:
            raise AIFailure("context_limit")
        signature = hashlib.sha256(
            json.dumps(
                [
                    PROMPT_VERSION,
                    cfg.provider,
                    cfg.model,
                    cfg.upstream,
                    operation,
                    packed,
                    cfg.max_output_tokens,
                ],
                ensure_ascii=False,
            ).encode()
        ).hexdigest()
        # Bytes conservatively approximate an upper token bound, with schema/system overhead.
        cost = (
            math.ceil(
                (
                    (len(packed.encode()) + 12000) * cfg.input_micro_usd_per_million
                    + cfg.max_output_tokens * cfg.output_micro_usd_per_million
                )
                / 1000000
            )
            if self.live
            else 0
        )
        day = datetime.now(timezone.utc).date().isoformat()
        invocation_id = uid()
        try:
            with Session(self.engine) as session:
                cached = self._existing(session, workspace_id, key, signature)
                if cached:
                    return validator(cached[0]), cached[1]
                usage = session.get(AIDailyUse, (workspace_id, day))
                if not usage:
                    session.add(
                        AIDailyUse(
                            workspace_id=workspace_id,
                            day=day,
                            requests=0,
                            reserved_micro_usd=0,
                        )
                    )
                    session.flush()
                changed = session.execute(
                    update(AIDailyUse)
                    .where(
                        AIDailyUse.workspace_id == workspace_id,
                        AIDailyUse.day == day,
                        AIDailyUse.requests < cfg.max_requests,
                        AIDailyUse.reserved_micro_usd + cost <= cfg.daily_micro_usd,
                    )
                    .values(
                        requests=AIDailyUse.requests + 1,
                        reserved_micro_usd=AIDailyUse.reserved_micro_usd + cost,
                    )
                )
                if changed.rowcount != 1:
                    raise AIFailure("budget_exceeded")
                session.add(
                    AIInvocation(
                        workspace_id=workspace_id,
                        id=invocation_id,
                        request_key=key,
                        fingerprint=signature,
                        provider=cfg.provider,
                        model=cfg.model,
                        upstream=cfg.upstream or None,
                        operation=operation,
                        state="running",
                        reserved_micro_usd=cost,
                    )
                )
                session.commit()
        except IntegrityError:
            with Session(self.engine) as session:
                cached = self._existing(session, workspace_id, key, signature)
                if cached:
                    return validator(cached[0]), cached[1]
            raise HTTPException(
                409, "Another AI request reserved this budget. Retry the saved action."
            ) from None
        output = None
        error = None
        input_tokens = None
        output_tokens = None
        try:
            if not self.adapter:
                raise AIFailure("provider_not_configured")
            result = self.adapter.call(operation, payload)
            validated = validator(result["output"])
            output = validated.model_dump(mode="json", exclude_unset=True)
            input_tokens = result.get("input_tokens")
            output_tokens = result.get("output_tokens")
            for value in (input_tokens, output_tokens):
                if value is not None and (type(value) is not int or value < 0):
                    raise ValueError("Invalid usage")
        except AIFailure as exc:
            error = exc.code
        except TimeoutError:
            error = "timeout"
        except ValueError:
            error = "invalid_output"
        except Exception:
            error = "provider_unavailable"
        # Keep the full reservation for all attempts, including failures. No hidden retry/failover.
        with Session(self.engine) as session:
            row = session.get(AIInvocation, (workspace_id, invocation_id))
            row.state = "failed" if error else "completed"
            row.error_code = error
            row.output = None if error else output
            row.input_tokens = input_tokens
            row.output_tokens = output_tokens
            row.finished_at = now()
            session.commit()
        if error:
            raise AIFailure(error, invocation_id)
        return validated, invocation_id


def link_invocation(session, run, invocation_id):
    if invocation_id:
        session.add(
            AIRunLink(
                workspace_id=run.workspace_id,
                conversation_id=run.conversation_id,
                run_id=run.id,
                invocation_id=invocation_id,
            )
        )


def run_metadata(session, run, result):
    link = session.get(AIRunLink, (run.workspace_id, run.id))
    if not link:
        return result
    row = session.get(AIInvocation, (run.workspace_id, link.invocation_id))
    return result.model_copy(
        update={
            "model": row.model,
            "upstream": row.upstream,
            "input_tokens": row.input_tokens,
            "output_tokens": row.output_tokens,
            "reserved_micro_usd": row.reserved_micro_usd,
        }
    )
