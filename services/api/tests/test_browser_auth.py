import base64
import hashlib
from dataclasses import replace
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from urllib.parse import parse_qs, urlsplit
from uuid import uuid4
import httpx
import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.testclient import TestClient
from sqlalchemy import select, func, update
from sqlalchemy.orm import Session
from app.main import create_app
from app.auth import Settings, subject_key
from app.browser_auth import RedactAuthQuery
from app.models import Invite, User, Workspace
from app.session_models import BrowserSession, LoginTransaction


@pytest.fixture
def browser(setup):
    previous, engine, _ = setup
    settings = replace(
        previous.app.state.settings,
        oidc_client_id="workroom-web",
        oidc_client_secret="test-only-secret",
        app_origin="http://127.0.0.1:5173",
    )
    app = create_app(settings, engine)
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    app.state.oidc_jwks = SimpleNamespace(
        get_signing_key_from_jwt=lambda _: SimpleNamespace(key=key.public_key())
    )
    with TestClient(app, base_url=settings.app_origin) as c:

        def begin():
            response = c.get("/api/v1/auth/login", follow_redirects=False)
            assert response.status_code == 303, response.text
            return parse_qs(urlsplit(response.headers["location"]).query)

        def complete(params=None, **overrides):
            params = params or begin()
            claims = {
                "sub": "real-fixture",
                "email": "real-fixture@example.test",
                "email_verified": True,
                "name": "Real fixture",
                "aud": settings.oidc_client_id,
                "iss": settings.oidc_issuer,
                "iat": datetime.now(timezone.utc),
                "exp": datetime.now(timezone.utc) + timedelta(minutes=15),
                "nonce": params["nonce"][0],
                **overrides,
            }

            def exchange(request):
                values = parse_qs(request.content.decode())
                challenge = (
                    base64.urlsafe_b64encode(
                        hashlib.sha256(values["code_verifier"][0].encode()).digest()
                    )
                    .rstrip(b"=")
                    .decode()
                )
                assert challenge == params["code_challenge"][0]
                assert values["grant_type"] == ["authorization_code"]
                assert request.headers["authorization"].startswith("Basic ")
                return httpx.Response(
                    200,
                    json={
                        "id_token": jwt.encode(claims, key, algorithm="RS256"),
                        "access_token": "must-never-reach-browser",
                        "refresh_token": "must-never-be-stored",
                    },
                )

            app.state.oidc_transport = httpx.MockTransport(exchange)
            return c.get(
                "/api/v1/auth/callback",
                params={"code": "test-code", "state": params["state"][0]},
                follow_redirects=False,
            )

        yield c, engine, settings, begin, complete


def issue(engine, email="real-fixture@example.test"):
    token = str(uuid4()) + str(uuid4())
    with Session(engine) as db:
        db.add(
            Invite(
                token_hash=hashlib.sha256(token.encode()).hexdigest(),
                email=email,
                expires_at=(
                    datetime.now(timezone.utc) + timedelta(hours=1)
                ).isoformat(),
            )
        )
        db.commit()
    return token


def test_real_browser_session_invitation_and_logout(browser):
    c, engine, settings, begin, complete = browser
    assert not c.get("/api/v1/auth/session").json()["authenticated"]
    params = begin()
    assert params["code_challenge_method"] == ["S256"] and params["scope"] == [
        "openid email profile"
    ]
    response = complete(params)
    assert (
        response.status_code == 303 and "auth_error" not in response.headers["location"]
    )
    assert (
        "HttpOnly" in response.headers["set-cookie"]
        and "SameSite=lax" in response.headers["set-cookie"]
    )
    status = c.get("/api/v1/auth/session").json()
    assert status["authenticated"] and not status["has_workspace"]
    assert c.get("/api/v1/tasks").status_code == 403
    assert (
        c.post(
            "/api/v1/dev/session", headers={"X-Local-Development": "worktracker"}
        ).status_code
        == 404
    )
    token = issue(engine)
    writes = {
        "Origin": settings.app_origin,
        "X-CSRF-Token": status["csrf_token"],
        "Idempotency-Key": str(uuid4()),
    }
    redeemed = c.post(
        "/api/v1/invitations/redeem", headers=writes, json={"token": token}
    )
    assert redeemed.status_code == 200, redeemed.text
    assert not redeemed.json()["local_identity"]
    assert c.get("/api/v1/auth/session").json()["has_workspace"]
    task = c.post("/api/v1/tasks", headers=writes, json={"title": "Real private task"})
    assert task.status_code == 201, task.text
    with Session(engine) as db:
        session = db.scalar(select(BrowserSession))
        assert session.token_hash != c.cookies.get("workroom_session")
        assert "must-never" not in str(session.claims)
        user = db.scalar(select(User).where(User.email == "real-fixture@example.test"))
        assert user.subject == subject_key(settings.oidc_issuer, "real-fixture")
        assert db.scalar(select(func.count()).select_from(LoginTransaction)) == 0
    cookie = c.cookies.get("workroom_session")
    logout = c.post("/api/v1/auth/logout", headers=writes)
    assert logout.status_code == 200 and "/logout?" in logout.json()["redirect_url"]
    assert not c.get("/api/v1/auth/session").json()["authenticated"]
    c.cookies.set("workroom_session", cookie, path="/api")
    assert c.get("/api/v1/tasks").status_code == 401


@pytest.mark.parametrize(
    "claims",
    [
        {"nonce": "wrong"},
        {"email_verified": False},
        {"aud": "wrong"},
        {"iss": "https://foreign.test"},
        {"exp": datetime.now(timezone.utc) - timedelta(minutes=1)},
        {"azp": "foreign"},
        {"aud": ["workroom-web", "another"], "azp": "another"},
        {"email": "not-an-email"},
    ],
    ids=[
        "nonce",
        "unverified",
        "audience",
        "issuer",
        "expired",
        "azp",
        "multi-audience",
        "email",
    ],
)
def test_callback_rejects_invalid_identity(browser, claims):
    c, engine, _, _, complete = browser
    response = complete(**claims)
    assert "auth_error=sign_in_failed" in response.headers["location"]
    assert not c.get("/api/v1/auth/session").json()["authenticated"]
    with Session(engine) as db:
        assert db.scalar(select(func.count()).select_from(BrowserSession)) == 0


def test_state_browser_binding_expiry_replay_and_open_redirect(browser):
    c, engine, settings, begin, complete = browser
    assert (
        c.get(
            "/api/v1/auth/login",
            params={"return_path": "https://evil.test"},
            follow_redirects=False,
        ).status_code
        == 422
    )
    params = begin()
    c.cookies.clear()
    response = c.get(
        "/api/v1/auth/callback",
        params={"code": "anything", "state": params["state"][0]},
        follow_redirects=False,
    )
    assert "invalid_state" in response.headers["location"]
    params = begin()
    response = complete(params)
    assert "auth_error" not in response.headers["location"]
    replay = c.get(
        "/api/v1/auth/callback",
        params={"code": "test-code", "state": params["state"][0]},
        follow_redirects=False,
    )
    assert "invalid_state" in replay.headers["location"]
    params = begin()
    with Session(engine) as db:
        db.execute(
            update(LoginTransaction).values(expires_at="2000-01-01T00:00:00+00:00")
        )
        db.commit()
    assert "invalid_state" in complete(params).headers["location"]
    with Session(engine) as db:
        assert db.scalar(select(func.count()).select_from(BrowserSession)) == 1


def test_csrf_expiration_and_cookie_cannot_be_used_as_bearer(browser):
    c, engine, settings, _, complete = browser
    complete()
    status = c.get("/api/v1/auth/session").json()
    token = issue(engine)
    assert (
        c.post("/api/v1/invitations/redeem", json={"token": token}).status_code == 403
    )
    assert (
        c.post(
            "/api/v1/invitations/redeem",
            headers={
                "Origin": "https://evil.test",
                "X-CSRF-Token": status["csrf_token"],
            },
            json={"token": token},
        ).status_code
        == 403
    )
    assert (
        c.post(
            "/api/v1/auth/logout",
            headers={"Origin": settings.app_origin, "X-CSRF-Token": "wrong"},
        ).status_code
        == 403
    )
    assert (
        c.get(
            "/api/v1/tasks",
            headers={"Authorization": "Bearer " + c.cookies.get("workroom_session")},
        ).status_code
        == 401
    )
    with Session(engine) as db:
        db.execute(
            update(BrowserSession).values(expires_at="2000-01-01T00:00:00+00:00")
        )
        db.commit()
    assert not c.get("/api/v1/auth/session").json()["authenticated"]
    assert c.get("/api/v1/tasks").status_code == 401


def test_invite_matching_and_throttle_fail_closed(browser):
    c, engine, settings, _, complete = browser
    complete()
    status = c.get("/api/v1/auth/session").json()
    headers = {"Origin": settings.app_origin, "X-CSRF-Token": status["csrf_token"]}
    foreign = issue(engine, "another@example.test")
    assert (
        c.post(
            "/api/v1/invitations/redeem", headers=headers, json={"token": foreign}
        ).status_code
        == 403
    )
    for _ in range(9):
        assert (
            c.post(
                "/api/v1/invitations/redeem",
                headers=headers,
                json={"token": "invalid-token-123456"},
            ).status_code
            == 403
        )
    valid = issue(engine)
    assert (
        c.post(
            "/api/v1/invitations/redeem", headers=headers, json={"token": valid}
        ).status_code
        == 429
    )
    with Session(engine) as db:
        assert (
            db.scalar(
                select(Invite).where(
                    Invite.token_hash == hashlib.sha256(valid.encode()).hexdigest()
                )
            ).redeemed_at
            is None
        )
        assert db.scalar(select(func.count()).select_from(Workspace)) == 2


def test_disabled_account_cannot_reauthenticate(browser):
    c, engine, settings, _, complete = browser
    with Session(engine) as db:
        db.add(
            User(
                subject=subject_key(settings.oidc_issuer, "real-fixture"),
                email="real-fixture@example.test",
                name="Disabled",
                active=False,
            )
        )
        db.commit()
    assert "account_disabled" in complete().headers["location"]
    assert not c.get("/api/v1/auth/session").json()["authenticated"]


def test_secure_config_and_auth_log_redaction():
    with pytest.raises(RuntimeError):
        Settings(
            environment="production",
            oidc_issuer="http://127.0.0.1:8088/realms/workroom",
            oidc_jwks_url="http://127.0.0.1:8088/certs",
            oidc_client_id="web",
            oidc_client_secret="secret",
            database_url="postgresql://db",
            oidc_audience="api",
        ).validate()
    import logging

    record = logging.LogRecord(
        "uvicorn.access",
        20,
        "",
        1,
        "",
        (
            "127.0.0.1",
            "GET",
            "/api/v1/auth/callback?code=secret&state=secret",
            "1.1",
            303,
        ),
        None,
    )
    RedactAuthQuery().filter(record)
    assert record.args[2] == "/api/v1/auth/callback"


def test_cookie_accounts_remain_isolated_and_sign_in_rotates_old_session(browser):
    c, engine, settings, _, complete = browser
    complete()
    first = c.get("/api/v1/auth/session").json()
    writes = {
        "Origin": settings.app_origin,
        "X-CSRF-Token": first["csrf_token"],
        "Idempotency-Key": str(uuid4()),
    }
    assert (
        c.post(
            "/api/v1/invitations/redeem", headers=writes, json={"token": issue(engine)}
        ).status_code
        == 200
    )
    first_task = c.post(
        "/api/v1/tasks", headers=writes, json={"title": "First account private task"}
    ).json()["task"]
    old_cookie = c.cookies.get("workroom_session")
    complete(sub="second-account", email="second@example.test")
    second = c.get("/api/v1/auth/session").json()
    assert not second["has_workspace"] and second["csrf_token"] != first["csrf_token"]
    writes = {
        "Origin": settings.app_origin,
        "X-CSRF-Token": second["csrf_token"],
        "Idempotency-Key": str(uuid4()),
    }
    assert (
        c.post(
            "/api/v1/invitations/redeem",
            headers=writes,
            json={"token": issue(engine, "second@example.test")},
        ).status_code
        == 200
    )
    assert c.get("/api/v1/tasks").json()["total"] == 0
    for suffix in ("", "/events", "/source", "/work"):
        assert c.get("/api/v1/tasks/" + first_task["id"] + suffix).status_code == 404
    assert (
        c.post(
            "/api/v1/tasks/" + first_task["id"] + "/assistant", headers=writes
        ).status_code
        == 404
    )
    c.cookies.clear()
    c.cookies.set("workroom_session", old_cookie, path="/api")
    assert c.get("/api/v1/tasks").status_code == 401


def test_failed_token_exchange_is_generic_one_shot_and_creates_no_session(browser):
    c, engine, settings, begin, _ = browser
    params = begin()
    c.app.state.oidc_transport = httpx.MockTransport(
        lambda request: httpx.Response(200, json=["malformed-provider-payload"])
    )
    response = c.get(
        "/api/v1/auth/callback",
        params={"state": params["state"][0], "code": "private-code"},
        follow_redirects=False,
    )
    assert response.headers["location"].endswith("auth_error=sign_in_failed")
    assert "private-code" not in response.text
    with Session(engine) as db:
        assert db.scalar(select(func.count()).select_from(BrowserSession)) == 0
        assert db.scalar(select(func.count()).select_from(LoginTransaction)) == 0


def test_https_session_cookie_configuration(browser):
    c, engine, settings, _, _ = browser
    production = replace(
        settings,
        environment="production",
        app_origin="https://workroom.example.test",
        database_url="postgresql://configured-by-operator",
    )
    app = create_app(production, engine)
    with TestClient(app, base_url=production.app_origin) as secure:
        response = secure.get("/api/v1/auth/login", follow_redirects=False)
        assert (
            "Secure" in response.headers["set-cookie"]
            and "HttpOnly" in response.headers["set-cookie"]
        )
        assert response.headers["cache-control"] == "no-store"
