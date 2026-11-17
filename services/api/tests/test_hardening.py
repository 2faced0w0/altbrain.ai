import logging
from dataclasses import replace

import pytest

from app.ai_config import AISettings
from app.browser_auth import RedactAuthQuery


def test_every_response_carries_framing_referrer_and_csp_headers(setup):
    client, _, _ = setup
    for path in ("/api/v1/me", "/api/v1/does-not-exist"):
        response = client.get(path)
        assert response.headers["X-Content-Type-Options"] == "nosniff"
        assert response.headers["X-Frame-Options"] == "DENY"
        assert response.headers["Referrer-Policy"] == "no-referrer"
        assert "frame-ancestors 'none'" in response.headers["Content-Security-Policy"]


def test_api_docs_page_keeps_its_own_script_policy(setup):
    client, _, _ = setup
    response = client.get("/docs")
    assert response.status_code == 200
    assert "Content-Security-Policy" not in response.headers


@pytest.mark.parametrize(
    "args",
    [
        (
            "127.0.0.1",
            "GET",
            "/api/v1/auth/callback?code=secret&state=secret",
            "1.1",
            303,
        ),
        ("GET", "/api/v1/auth/callback?code=secret&state=secret", 303),
        (
            "127.0.0.1:1234",
            "GET",
            "/api/v1/auth/login?return_path=/app/x",
            "1.1",
            303,
            "x",
        ),
    ],
)
def test_access_log_redaction_does_not_depend_on_argument_count(args):
    record = logging.LogRecord("uvicorn.access", 20, "", 1, "", args, None)
    RedactAuthQuery().filter(record)
    assert not any("?" in str(value) for value in record.args)
    assert any(str(value).startswith("/api/v1/auth/") for value in record.args)


def test_access_log_redaction_leaves_other_paths_untouched():
    args = ("127.0.0.1", "GET", "/api/v1/tasks?limit=5", "1.1", 200)
    record = logging.LogRecord("uvicorn.access", 20, "", 1, "", args, None)
    RedactAuthQuery().filter(record)
    assert record.args == args


@pytest.mark.parametrize("model", ["a/../b", "..", "../x", "x/..", "/x", "x/"])
def test_model_ids_cannot_traverse_provider_paths(model):
    cfg = AISettings(
        provider="gemini",
        model="gemini-fixture",
        api_key="private-test-key",
        input_micro_usd_per_million=400000,
        output_micro_usd_per_million=1600000,
    )
    cfg.validate()
    with pytest.raises(RuntimeError):
        replace(cfg, model=model).validate()
