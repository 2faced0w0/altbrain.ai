"""Isolated browser fixture: real application + provider-contract HTTP fakes, never paid AI."""

import json
import os
import sys
from pathlib import Path
from uuid import uuid4
import httpx

root = Path(__file__).resolve().parents[1]
local = root / ".local"
local.mkdir(exist_ok=True)
os.environ.update(
    APP_ENV="test",
    LOCAL_IDENTITY="true",
    WORKROOM_ORIGIN="http://127.0.0.1:5176",
    DATABASE_URL="sqlite:///" + str(local / ("browser-ai-" + uuid4().hex + ".db")),
)
for name in ("OIDC_CLIENT_ID", "OIDC_CLIENT_SECRET", "WORKROOM_AI_CONFIG"):
    os.environ.pop(name, None)
sys.path.insert(0, str(root / "services/api"))
from alembic import command  # noqa:E402
from alembic.config import Config  # noqa:E402
from sqlalchemy.orm import Session  # noqa:E402
from app.main import app  # noqa:E402
from app.models import User, Workspace, Membership  # noqa:E402
from app.ai_config import AISettings  # noqa:E402
from app.ai_runtime import AIRuntime  # noqa:E402
from app.live_adapters import LiveAdapter, PROVIDERS  # noqa:E402
import uvicorn  # noqa:E402

command.upgrade(Config(str(root / "services/api/alembic.ini")), "head")
with Session(app.state.engine) as db:
    user = User(subject="local:alex", email="alex@example.test", name="Alex Fixture")
    db.add(user)
    db.flush()
    workspace = Workspace(owner_user_id=user.id, name="Synthetic AI browser fixture")
    db.add(workspace)
    db.flush()
    db.add(Membership(workspace_id=workspace.id, user_id=user.id))
    db.commit()


def transport(provider):
    def respond(request):
        body = json.loads(request.content)
        if provider == "gemini":
            payload = json.loads(body["contents"][0]["parts"][0]["text"])
        elif provider in {"openai", "grok"}:
            payload = json.loads(body["input"][0]["content"])
        else:
            payload = json.loads(body["messages"][-1]["content"])
        text = payload.get("source_text", payload.get("request", ""))
        if "[[quota]]" in text:
            return httpx.Response(
                429,
                json={
                    "error": {
                        "code": "insufficient_quota",
                        "message": "Synthetic billing restriction",
                    }
                },
            )
        if "[[timeout]]" in text:
            raise httpx.ReadTimeout("Synthetic timeout")
        if "source_text" in payload:
            output = {
                "candidates": [
                    {
                        "title": line[:180],
                        "description": "Synthetic provider-contract fixture",
                        "evidence": line[:1000],
                        "questions": [],
                    }
                    for line in text.splitlines()
                    if line.strip()
                ][:3]
            }
        else:
            update = "done" in text.lower()
            output = {
                "kind": "update" if update else "guidance",
                "reply": "Review this synthetic proposed change."
                if update
                else "Synthetic guidance from selected task context.",
                "changes": [{"field": "status", "value": "completed"}]
                if update
                else [],
                "questions": [],
                "evidence": text[:1000] if update else "",
            }
        content = json.dumps(output)
        if provider == "gemini":
            result = {
                "candidates": [
                    {"finishReason": "STOP", "content": {"parts": [{"text": content}]}}
                ],
                "usageMetadata": {"promptTokenCount": 100, "candidatesTokenCount": 50},
            }
        elif provider in {"openai", "grok"}:
            result = {
                "status": "completed",
                "output": [
                    {
                        "type": "message",
                        "content": [{"type": "output_text", "text": content}],
                    }
                ],
                "usage": {"input_tokens": 100, "output_tokens": 50},
            }
        else:
            result = {
                "choices": [{"finish_reason": "stop", "message": {"content": content}}],
                "usage": {"prompt_tokens": 100, "completion_tokens": 50},
            }
        return httpx.Response(200, json=result)

    return httpx.MockTransport(respond)


for provider in PROVIDERS:
    cfg = AISettings(
        provider=provider,
        model=provider + "-fixture",
        api_key="synthetic-nonworking-key",
        input_micro_usd_per_million=400000,
        output_micro_usd_per_million=1600000,
        upstream="approved-fixture" if provider == "openrouter" else "",
    )
    app.state.ai_registry.runtimes[provider] = AIRuntime(
        app.state.engine, cfg, LiveAdapter(cfg, transport(provider))
    )
app.state.ai_registry.primary = "openai"
uvicorn.run(app, host="127.0.0.1", port=8013)
