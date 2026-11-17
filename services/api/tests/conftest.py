import os
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from uuid import uuid4

import jwt
import pytest
from alembic import command
from alembic.config import Config
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session

from app.auth import Settings
from app.main import create_app
from app.models import Membership, User, Workspace


@pytest.fixture
def setup(tmp_path, monkeypatch):
    postgres_url = os.getenv("TEST_DATABASE_URL")
    if postgres_url:
        postgres_url = (
            make_url(postgres_url)
            .update_query_dict({"connect_timeout": "5"})
            .render_as_string(hide_password=False)
        )
    schema = "test_" + uuid4().hex
    admin = create_engine(postgres_url) if postgres_url else None
    if admin:
        with admin.begin() as connection:
            connection.execute(text(f'CREATE SCHEMA "{schema}"'))
    url = (
        postgres_url + f"&options=-csearch_path%3D{schema}"
        if postgres_url
        else f"sqlite:///{tmp_path / 'test.db'}"
    )
    engine = None
    try:
        monkeypatch.setenv("DATABASE_URL", url)
        cfg = Config("services/api/alembic.ini")
        command.upgrade(cfg, "head")
        engine = create_engine(
            url, connect_args={"check_same_thread": False} if not postgres_url else {}
        )
        settings = Settings(
            environment="test",
            oidc_issuer="https://issuer.example.test",
            oidc_audience="worktracker",
            oidc_jwks_url="https://issuer.example.test/jwks",
            database_url=url,
        )
        app = create_app(settings, engine)
        private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        app.state.jwks = SimpleNamespace(
            get_signing_key_from_jwt=lambda _: SimpleNamespace(
                key=private_key.public_key()
            )
        )

        def headers(subject="a", **claims):
            payload = {
                "sub": subject,
                "email": f"{subject}@example.test",
                "email_verified": True,
                "name": f"Owner {subject}",
                "iat": datetime.now(timezone.utc),
                "exp": datetime.now(timezone.utc) + timedelta(minutes=5),
                "iss": settings.oidc_issuer,
                "aud": settings.oidc_audience,
                **claims,
            }
            return {
                "Authorization": "Bearer "
                + jwt.encode(payload, private_key, algorithm="RS256"),
                "Idempotency-Key": str(uuid4()),
            }

        with Session(engine) as db:
            for name in ("a", "b"):
                user = User(
                    subject=name, email=f"{name}@example.test", name=f"Owner {name}"
                )
                db.add(user)
                db.flush()
                workspace = Workspace(owner_user_id=user.id, name=f"Workspace {name}")
                db.add(workspace)
                db.flush()
                db.add(Membership(workspace_id=workspace.id, user_id=user.id))
            db.commit()
        with TestClient(app) as client:
            yield client, engine, headers
    finally:
        if engine is not None:
            engine.dispose()
        if admin:
            with admin.begin() as connection:
                connection.execute(text(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE'))
            admin.dispose()
