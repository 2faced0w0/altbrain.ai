"""Server .env configuration uses synthetic secrets and never calls a provider."""

import json

import pytest
from sqlalchemy import create_engine

from app.ai_env import ai_environment, price_micro
from app.ai_registry import AIRegistry
from app.live_adapters import PROVIDERS


@pytest.mark.parametrize("provider", PROVIDERS)
def test_provider_env_loads_key_model_and_rates(tmp_path, monkeypatch, provider):
    prefix = provider.upper()
    path = tmp_path / ".env"
    path.write_text(
        f'{prefix}_API_KEY="synthetic-secret"\n{prefix}_MODEL=fixture-model\n'
        f"{prefix}_INPUT_USD_PER_MILLION=0.4\n{prefix}_OUTPUT_USD_PER_MILLION=1.6\n"
        f"WORKROOM_AI_DEFAULT_PROVIDER={provider}\nOPENROUTER_UPSTREAM=approved-fixture\n",
        encoding="utf-8",
    )
    monkeypatch.setenv("WORKROOM_AI_ENV", str(path))
    monkeypatch.delenv("WORKROOM_AI_CONFIG", raising=False)
    registry = AIRegistry.load(create_engine("sqlite://"))
    cfg = registry.choose(None).config
    assert cfg.ready and cfg.provider == provider and cfg.api_key == "synthetic-secret"
    assert cfg.input_micro_usd_per_million == 400000
    assert cfg.output_micro_usd_per_million == 1600000
    assert cfg.model == "fixture-model"


def test_env_precedence_blank_fallback_and_no_shell_evaluation(tmp_path, monkeypatch):
    path = tmp_path / ".env"
    path.write_text(
        "OPENAI_API_KEY='$(not-executed)'\nOPENAI_MODEL=\nDATABASE_URL=ignored\n"
    )
    monkeypatch.setenv("WORKROOM_AI_ENV", str(path))
    assert ai_environment()["OPENAI_API_KEY"] == "$(not-executed)"
    assert "DATABASE_URL" not in ai_environment()
    config = tmp_path / "config.json"
    config.write_text(json.dumps({"providers": {"openai": {"model": "kept-model"}}}))
    monkeypatch.setenv("WORKROOM_AI_CONFIG", str(config))
    monkeypatch.setenv("OPENAI_API_KEY", "process-secret")
    cfg = AIRegistry.load(create_engine("sqlite://")).choose("openai").config
    assert cfg.api_key == "process-secret" and cfg.model == "kept-model"
    assert not cfg.ready  # Missing prices never enables an external request.


@pytest.mark.parametrize(
    "value", ["NaN", "Infinity", "-1", "0", "0.0000001", "secret-invalid"]
)
def test_invalid_prices_fail_without_echoing_values(value):
    with pytest.raises(RuntimeError) as error:
        price_micro(value)
    assert value not in str(error.value)


def test_unselected_dotenv_is_not_read(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    (tmp_path / ".env").write_text("MISTRAL_API_KEY=unselected-secret\n")
    monkeypatch.delenv("WORKROOM_AI_ENV", raising=False)
    monkeypatch.delenv("MISTRAL_API_KEY", raising=False)
    assert "MISTRAL_API_KEY" not in ai_environment()
