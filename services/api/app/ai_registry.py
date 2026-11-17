"""Server-approved provider/model registry and owner-scoped usage status."""

import json
import os
from pathlib import Path
from datetime import datetime, timezone
from fastapi import Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from .ai_config import AISettings
from .ai_runtime import AIRuntime
from .ai_models import AIDailyUse
from .live_adapters import LiveAdapter, PROVIDERS
from .ai_env import ai_environment, price_micro


class ProviderState(BaseModel):
    id: str
    label: str
    model: str
    ready: bool
    external: bool
    upstream: str | None = None


class AIStatus(BaseModel):
    default_provider: str
    providers: list[ProviderState]
    day_utc: str
    requests_used: int
    request_limit: int
    reserved_micro_usd: int
    daily_limit_micro_usd: int


class AIRegistry:
    def __init__(self, engine, runtimes=None, primary="mock"):
        self.engine = engine
        self.primary = primary
        self.runtimes = runtimes or {"mock": AIRuntime(engine, AISettings())}

    @classmethod
    def load(cls, engine):
        path = os.getenv("WORKROOM_AI_CONFIG", "")
        config_path = Path(path) if path else None
        data = (
            json.loads(config_path.read_text(encoding="utf-8")) if config_path else {}
        )
        env = ai_environment()
        common = data.get("limits", {})
        allowed_limits = {
            "max_requests",
            "max_input_bytes",
            "max_output_tokens",
            "daily_micro_usd",
            "timeout_seconds",
        }
        if set(common) - allowed_limits:
            raise RuntimeError("Unknown AI limit")
        mock_config = AISettings(**common)
        mock_config.validate()
        runtimes = {"mock": AIRuntime(engine, mock_config)}
        providers = dict(data.get("providers", {}))
        for provider in PROVIDERS:
            if any(name.startswith(provider.upper() + "_") for name in env):
                providers.setdefault(provider, {})
        for provider, values in providers.items():
            if provider not in PROVIDERS:
                raise RuntimeError("Unsupported AI provider")
            values = dict(values)
            key_file = values.pop("api_key_file", "")
            if "api_key" in values:
                raise RuntimeError("Provider keys belong in separate server key files")
            key_path = (
                (config_path.parent / key_file).resolve()
                if key_file and config_path
                else None
            )
            key = (
                key_path.read_text(encoding="utf-8").strip()
                if key_path and key_path.is_file()
                else ""
            )
            prefix = provider.upper()
            key = env.get(prefix + "_API_KEY", key)
            if prefix + "_MODEL" in env:
                values["model"] = env[prefix + "_MODEL"]
            for suffix, field in (
                ("_INPUT_USD_PER_MILLION", "input_micro_usd_per_million"),
                ("_OUTPUT_USD_PER_MILLION", "output_micro_usd_per_million"),
            ):
                if prefix + suffix in env:
                    values[field] = price_micro(env[prefix + suffix])
            if provider == "openrouter" and "OPENROUTER_UPSTREAM" in env:
                values["upstream"] = env["OPENROUTER_UPSTREAM"]
            cfg = AISettings(provider=provider, api_key=key, **common, **values)
            cfg.validate()
            runtimes[provider] = AIRuntime(engine, cfg, LiveAdapter(cfg))
        primary = env.get(
            "WORKROOM_AI_DEFAULT_PROVIDER", data.get("default_provider", "mock")
        )
        if primary not in runtimes:
            raise RuntimeError("Unknown default AI provider")
        return cls(engine, runtimes, primary)

    def choose(self, provider):
        name = provider or self.primary
        if name not in self.runtimes:
            raise HTTPException(
                422, "This AI provider is not configured by your workspace operator"
            )
        return self.runtimes[name]

    def state(self, session, workspace):
        primary = self.choose(None).config
        day = datetime.now(timezone.utc).date().isoformat()
        usage = session.get(AIDailyUse, (workspace.id, day))
        choices = [
            ProviderState(
                id="mock",
                label="Deterministic mock",
                model="",
                ready=True,
                external=False,
            )
        ]
        for name, label in PROVIDERS.items():
            runtime = self.runtimes.get(name)
            cfg = runtime.config if runtime else None
            choices.append(
                ProviderState(
                    id=name,
                    label=label,
                    model=cfg.model if cfg else "",
                    ready=bool(cfg and cfg.ready),
                    external=True,
                    upstream=cfg.upstream if cfg and cfg.upstream else None,
                )
            )
        return AIStatus(
            default_provider=self.primary,
            providers=choices,
            day_utc=day,
            requests_used=usage.requests if usage else 0,
            request_limit=primary.max_requests,
            reserved_micro_usd=usage.reserved_micro_usd if usage else 0,
            daily_limit_micro_usd=primary.daily_micro_usd,
        )


def install_ai_status(app, owner, db):
    app.state.ai_registry = AIRegistry.load(app.state.engine)

    @app.get("/api/v1/ai/status", response_model=AIStatus)
    def status(context=Depends(owner), session: Session = Depends(db)):
        return app.state.ai_registry.state(session, context[1])
