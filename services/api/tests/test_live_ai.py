import json
from dataclasses import replace
from uuid import uuid4
from concurrent.futures import ThreadPoolExecutor
import threading
import httpx
import pytest
from fastapi import HTTPException
from sqlalchemy import select, func, event
from sqlalchemy.orm import Session
from app.ai_config import AISettings
from app.ai_models import AIInvocation, AIDailyUse
from app.ai_runtime import AIRuntime, AIFailure
from app.live_adapters import LiveAdapter, PROVIDERS
from app.capture_schemas import Extraction
from app.models import Task, TaskEvent, Mutation, Workspace

CANDIDATES = {
    "candidates": [
        {
            "title": "Prepare synthetic outline",
            "description": "Synthetic fixture only",
            "evidence": "Prepare the synthetic outline.",
            "questions": [],
        }
    ]
}
TASK_WIRE = {
    "kind": "update",
    "reply": "Review the proposed completion.",
    "changes": [{"field": "status", "value": "completed"}],
    "questions": [],
    "evidence": "Mark this done",
}


@pytest.mark.parametrize(
    "provider,model,field,expected",
    [
        ("deepseek", "deepseek-flash", "thinking", {"type": "disabled"}),
        ("mistral", "mistral-small-2603", "reasoning_effort", "none"),
    ],
)
def test_configured_hybrid_models_keep_budget_for_json(
    provider, model, field, expected
):
    def transport(request):
        assert json.loads(request.content)[field] == expected
        return httpx.Response(200, json=envelope(provider, CANDIDATES))

    cfg = replace(settings(provider), model=model)
    result = LiveAdapter(cfg, httpx.MockTransport(transport)).call(
        "capture", {"source_text": "Synthetic only"}
    )
    assert result["output"] == CANDIDATES


def settings(provider="openai", **values):
    return AISettings(
        provider=provider,
        model="fixture-model",
        api_key="private-test-key",
        input_micro_usd_per_million=400000,
        output_micro_usd_per_million=1600000,
        upstream="approved-upstream" if provider == "openrouter" else "",
        **values,
    )


def envelope(provider, value):
    text = json.dumps(value)
    if provider == "gemini":
        return {
            "candidates": [
                {"finishReason": "STOP", "content": {"parts": [{"text": text}]}}
            ],
            "usageMetadata": {
                "promptTokenCount": 100,
                "candidatesTokenCount": 50,
                "thoughtsTokenCount": 5,
            },
        }
    if provider in {"openai", "grok"}:
        return {
            "status": "completed",
            "output": [
                {"type": "message", "content": [{"type": "output_text", "text": text}]}
            ],
            "usage": {"input_tokens": 100, "output_tokens": 50},
        }
    return {
        "choices": [{"finish_reason": "stop", "message": {"content": text}}],
        "usage": {"prompt_tokens": 100, "completion_tokens": 50},
    }


def register(c, engine, provider="openai", value=None, config=None):
    calls = []
    cfg = config or settings(provider)

    def transport(request):
        calls.append(request)
        return httpx.Response(
            200, json=envelope(provider, CANDIDATES if value is None else value)
        )

    runtime = AIRuntime(engine, cfg, LiveAdapter(cfg, httpx.MockTransport(transport)))
    c.app.state.ai_registry.runtimes[provider] = runtime
    return calls, runtime


def conversation(c, h):
    return c.post("/api/v1/conversations", headers=h(), json={}).json()


def send(c, h, row, provider="openai", headers=None, **body):
    return c.post(
        "/api/v1/conversations/" + row["id"] + "/runs",
        headers=headers or h(),
        json={
            "expected_version": row["version"],
            "content": "Prepare the synthetic outline.",
            "provider": provider,
            "live_consent": True,
            **body,
        },
    )


@pytest.mark.parametrize("provider", list(PROVIDERS))
def test_each_provider_contract_private_capture_and_usage(setup, provider):
    c, engine, h = setup
    calls, runtime = register(c, engine, provider)
    row = conversation(c, h)
    result = send(c, h, row, provider)
    assert result.status_code == 200, result.text
    result = result.json()
    assert (
        result["run"]["state"] == "completed" and result["run"]["provider"] == provider
    )
    assert (
        result["run"]["model"] == "fixture-model"
        and result["run"]["input_tokens"] == 100
    )
    assert result["run"]["output_tokens"] == (55 if provider == "gemini" else 50)
    assert result["run"]["reserved_micro_usd"] > 0
    assert (
        len(result["proposals"]) == 1
        and c.get("/api/v1/tasks", headers=h()).json()["total"] == 0
    )
    assert len(calls) == 1
    request = calls[0]
    body = json.loads(request.content)
    assert "private-test-key" not in str(request.url)
    assert "tools" not in body and body.get("stream", False) is False
    if provider == "gemini":
        assert request.headers["x-goog-api-key"] == "private-test-key"
        assert body["generationConfig"]["maxOutputTokens"] == 1500
        assert body["generationConfig"]["responseMimeType"] == "application/json"
    elif provider in {"openai", "grok"}:
        assert body["store"] is False and body["max_output_tokens"] == 1500
        assert body["text"]["format"]["strict"] is True
    else:
        assert body["max_tokens"] == 1500 and body["response_format"] == {
            "type": "json_object"
        }
    if provider == "openrouter":
        assert body["provider"]["only"] == ["approved-upstream"]
        assert (
            body["provider"]["allow_fallbacks"] is False
            and body["provider"]["data_collection"] == "deny"
        )
    status = c.get("/api/v1/ai/status", headers=h()).json()
    assert status["requests_used"] == 1 and "private-test-key" not in json.dumps(status)
    assert c.get("/api/v1/ai/status").status_code == 401
    assert c.get("/api/v1/ai/status", headers=h("b")).json()["requests_used"] == 0
    item = result["proposals"][0]
    approval = c.post(
        "/api/v1/ai/proposals/" + item["id"] + "/decision",
        headers=h(),
        json={
            "expected_version": item["version"],
            "decision": "approve",
            "task": item["draft_task"],
        },
    )
    assert approval.status_code == 200
    assert c.get("/api/v1/tasks", headers=h()).json()["total"] == 1


@pytest.mark.parametrize("provider", list(PROVIDERS))
def test_each_provider_task_guidance_and_reviewed_update(setup, provider):
    c, engine, h = setup
    task = c.post(
        "/api/v1/tasks",
        headers=h(),
        json={"title": "Selected private task", "priority": "urgent"},
    ).json()["task"]
    row = c.post("/api/v1/tasks/" + task["id"] + "/assistant", headers=h()).json()
    calls, _ = register(
        c,
        engine,
        provider,
        {
            "kind": "guidance",
            "reply": "Consider a small first step.",
            "changes": [],
            "questions": [],
            "evidence": "",
        },
    )
    response = c.post(
        "/api/v1/conversations/" + row["id"] + "/task-runs",
        headers=h(),
        json={
            "expected_version": row["version"],
            "content": "How should I proceed?",
            "provider": provider,
            "live_consent": True,
        },
    )
    assert response.status_code == 200, response.text
    assert response.json()["updates"] == []
    assert c.get("/api/v1/tasks/" + task["id"], headers=h()).json()["version"] == 1
    row = response.json()["conversation"]
    calls, _ = register(c, engine, provider, TASK_WIRE)
    response = c.post(
        "/api/v1/conversations/" + row["id"] + "/task-runs",
        headers=h(),
        json={
            "expected_version": row["version"],
            "content": "Mark this done",
            "provider": provider,
            "live_consent": True,
        },
    )
    assert response.status_code == 200, response.text
    update = response.json()["updates"][0]
    assert c.get("/api/v1/tasks/" + task["id"], headers=h()).json()["status"] == "inbox"
    result = c.post(
        "/api/v1/ai/task-updates/" + update["id"] + "/decision",
        headers=h(),
        json={
            "expected_version": update["version"],
            "decision": "approve",
            "changes": {"status": "completed"},
        },
    )
    assert result.status_code == 200, result.text
    assert result.json()["commit"]["task"]["priority"] == "urgent"
    assert len(calls) == 1


def test_consent_foreign_access_and_unsupported_provider_never_call(setup):
    c, engine, h = setup
    calls, _ = register(c, engine)
    row = conversation(c, h)
    assert send(c, h, row, live_consent=False).status_code == 422
    assert send(c, h, row, headers=h("b")).status_code == 404
    assert send(c, h, row, provider="unknown").status_code == 422
    assert not calls
    with Session(engine) as db:
        assert db.scalar(select(func.count()).select_from(AIInvocation)) == 0


def test_budget_and_context_limits_prevent_provider_requests(setup):
    c, engine, h = setup
    calls, _ = register(c, engine, config=settings(daily_micro_usd=1))
    row = conversation(c, h)
    result = send(c, h, row).json()
    assert result["run"]["error_code"] == "budget_exceeded" and not calls
    calls, _ = register(c, engine, config=settings(max_input_bytes=1000))
    row = conversation(c, h)
    result = send(c, h, row, content="Prepare " + ("x" * 1100)).json()
    assert result["run"]["error_code"] == "context_limit" and not calls
    with Session(engine) as db:
        assert db.scalar(select(func.count()).select_from(Task)) == 0


def test_same_key_replays_without_rebilling_even_after_application_rollback(setup):
    c, engine, h = setup
    calls, _ = register(c, engine)
    row = conversation(c, h)
    headers = h()

    def fail(mapper, connection, target):
        raise RuntimeError("Synthetic receipt failure")

    event.listen(Mutation, "before_insert", fail)
    try:
        with pytest.raises(RuntimeError):
            send(c, h, row, headers=headers)
    finally:
        event.remove(Mutation, "before_insert", fail)
    with Session(engine) as db:
        assert db.scalar(select(func.count()).select_from(AIInvocation)) == 1
        assert db.scalar(select(func.count()).select_from(TaskEvent)) == 0
    result = send(c, h, row, headers=headers)
    assert result.status_code == 200, result.text
    assert send(c, h, row, headers=headers).json() == result.json()
    assert len(calls) == 1
    with Session(engine) as db:
        assert db.scalar(select(AIDailyUse)).requests == 1


@pytest.mark.parametrize(
    "value",
    [
        {
            "candidates": [
                {
                    "title": "Invented",
                    "description": "",
                    "evidence": "not in source",
                    "questions": [],
                }
            ]
        },
        {
            "candidates": [
                {
                    "title": "Injected",
                    "description": "",
                    "evidence": "Prepare the synthetic outline.",
                    "questions": [],
                    "workspace_id": "other",
                }
            ]
        },
    ],
    ids=["ungrounded", "authoritative-id"],
)
def test_invalid_output_has_no_proposals_and_attempt_is_not_repeated(setup, value):
    c, engine, h = setup
    calls, _ = register(c, engine, value=value)
    row = conversation(c, h)
    headers = h()
    result = send(c, h, row, headers=headers)
    assert (
        result.json()["run"]["state"] == "failed" and result.json()["proposals"] == []
    )
    assert result.json()["conversation"]["draft"] == "Prepare the synthetic outline."
    assert send(c, h, row, headers=headers).json() == result.json() and len(calls) == 1


@pytest.mark.parametrize(
    "status,code",
    [
        (401, "invalid_credentials"),
        (403, "invalid_credentials"),
        (402, "quota_exhausted"),
        (429, "rate_limited"),
        (503, "provider_unavailable"),
        (302, "provider_unavailable"),
    ],
)
def test_http_failures_are_generic_and_do_not_fallback(status, code):
    calls = []

    def handler(request):
        calls.append(request)
        return httpx.Response(
            status,
            headers={"Location": "https://untrusted.test"},
            text="private upstream exception",
        )

    adapter = LiveAdapter(settings(), httpx.MockTransport(handler))
    with pytest.raises(AIFailure) as error:
        adapter.call("capture", {"source_text": "Prepare test"})
    assert error.value.code == code and len(calls) == 1
    assert "private upstream" not in str(error.value)


@pytest.mark.parametrize(
    "upstream_code",
    [
        "insufficient_quota",
        "credit_balance_exhausted",
        "organization_spend_limit_exceeded",
        "project_spend_limit_exceeded",
        "organization_usage_limit_exceeded",
        "usage_limit_exceeded",
    ],
)
def test_openai_429_billing_codes_are_not_temporary_throttles(upstream_code):
    adapter = LiveAdapter(
        settings(),
        httpx.MockTransport(
            lambda request: httpx.Response(
                429,
                json={
                    "error": {
                        "code": upstream_code,
                        "message": "Private upstream details",
                    }
                },
            )
        ),
    )
    with pytest.raises(AIFailure) as error:
        adapter.call("capture", {"source_text": "Synthetic"})
    assert error.value.code == "quota_exhausted"
    assert "Private upstream" not in str(error.value)


@pytest.mark.parametrize(
    "payload",
    [
        {"error": {"code": "rate_limit_exceeded"}},
        {"error": {"code": "slow_down", "type": "insufficient_quota"}},
        {"error": {"code": ["insufficient_quota"]}},
        {"error": "Unexpected private text"},
        [],
    ],
)
def test_unknown_429_payloads_preserve_generic_error(payload):
    adapter = LiveAdapter(
        settings(),
        httpx.MockTransport(lambda request: httpx.Response(429, json=payload)),
    )
    with pytest.raises(AIFailure) as error:
        adapter.call("capture", {"source_text": "Synthetic"})
    assert error.value.code == "rate_limited"


def test_timeout_partial_output_and_guidance_mutations_fail_closed(setup):
    def timeout(request):
        raise httpx.ReadTimeout("private transport error")

    with pytest.raises(AIFailure) as exc:
        LiveAdapter(settings(), httpx.MockTransport(timeout)).call(
            "capture", {"source_text": "test"}
        )
    assert exc.value.code == "timeout"
    response = envelope("openai", CANDIDATES)
    response["status"] = "incomplete"
    with pytest.raises(AIFailure) as exc:
        LiveAdapter(
            settings(),
            httpx.MockTransport(lambda request: httpx.Response(200, json=response)),
        ).call("capture", {"source_text": "test"})
    assert exc.value.code == "output_truncated"
    c, engine, h = setup
    task = c.post(
        "/api/v1/tasks", headers=h(), json={"title": "Keep unchanged"}
    ).json()["task"]
    row = c.post("/api/v1/tasks/" + task["id"] + "/assistant", headers=h()).json()
    register(c, engine, value={**TASK_WIRE, "kind": "guidance"})
    result = c.post(
        "/api/v1/conversations/" + row["id"] + "/task-runs",
        headers=h(),
        json={
            "expected_version": row["version"],
            "content": "Mark this done",
            "provider": "openai",
            "live_consent": True,
        },
    ).json()
    assert result["run"]["state"] == "failed" and result["updates"] == []
    assert c.get("/api/v1/tasks/" + task["id"], headers=h()).json()["version"] == 1


def test_concurrent_reservations_enforce_workspace_limit(setup):
    c, engine, h = setup
    if engine.dialect.name != "postgresql":
        pytest.skip("Real concurrent reservation locking is verified on PostgreSQL")
    calls, runtime = register(c, engine, config=settings(max_requests=1))
    with Session(engine) as db:
        workspace_id = db.scalar(
            select(Workspace).where(Workspace.name == "Workspace a")
        ).id
    gate = threading.Barrier(2)

    def invoke(index):
        gate.wait(timeout=10)
        try:
            return runtime.invoke(
                workspace_id,
                str(uuid4()),
                "capture",
                {"source_text": "Prepare the synthetic outline."},
                Extraction.model_validate,
                lambda: None,
            )
        except (AIFailure, HTTPException) as error:
            return error

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(invoke, range(2)))
    assert sum(isinstance(result, tuple) for result in results) == 1 and len(calls) == 1
    with Session(engine) as db:
        assert db.scalar(select(AIDailyUse)).requests == 1
        assert db.scalar(select(func.count()).select_from(AIInvocation)) == 1


def test_registry_never_exposes_key_and_requires_explicit_openrouter_route(
    tmp_path, setup, monkeypatch
):
    from app.ai_registry import AIRegistry

    c, engine, h = setup
    key = tmp_path / "key.txt"
    key.write_text("private-config-key", encoding="utf-8")
    path = tmp_path / "config.json"
    path.write_text(
        json.dumps(
            {
                "providers": {
                    "openrouter": {
                        "model": "org/model",
                        "api_key_file": "key.txt",
                        "input_micro_usd_per_million": 1000000,
                        "output_micro_usd_per_million": 1000000,
                    }
                }
            }
        ),
        encoding="utf-8",
    )
    monkeypatch.setenv("WORKROOM_AI_CONFIG", str(path))
    registry = AIRegistry.load(engine)
    assert not registry.choose("openrouter").config.ready
    cfg = json.loads(path.read_text())
    cfg["providers"]["openrouter"]["upstream"] = "approved-only"
    path.write_text(json.dumps(cfg))
    assert AIRegistry.load(engine).choose("openrouter").config.ready
    cfg["providers"]["openrouter"]["api_key"] = "raw-key"
    path.write_text(json.dumps(cfg))
    with pytest.raises(RuntimeError):
        AIRegistry.load(engine)


def test_uncertain_task_attempt_cannot_rebase_cached_output_on_new_version(setup):
    c, engine, h = setup
    calls, _ = register(c, engine, value=TASK_WIRE)
    task = c.post(
        "/api/v1/tasks", headers=h(), json={"title": "Original version"}
    ).json()["task"]
    row = c.post("/api/v1/tasks/" + task["id"] + "/assistant", headers=h()).json()
    keys = h()
    body = {
        "expected_version": row["version"],
        "content": "Mark this done",
        "provider": "openai",
        "live_consent": True,
    }

    def fail(mapper, connection, target):
        raise RuntimeError("Synthetic post-provider commit failure")

    event.listen(Mutation, "before_insert", fail)
    try:
        with pytest.raises(RuntimeError):
            c.post(
                "/api/v1/conversations/" + row["id"] + "/task-runs",
                headers=keys,
                json=body,
            )
    finally:
        event.remove(Mutation, "before_insert", fail)
    changed = c.patch(
        "/api/v1/tasks/" + task["id"],
        headers=h(),
        json={"expected_version": task["version"], "changes": {"priority": "urgent"}},
    )
    assert changed.status_code == 200
    retry = c.post(
        "/api/v1/conversations/" + row["id"] + "/task-runs", headers=keys, json=body
    )
    assert retry.status_code == 409 and len(calls) == 1
    assert c.get("/api/v1/tasks/" + task["id"], headers=h()).json()["status"] == "inbox"
