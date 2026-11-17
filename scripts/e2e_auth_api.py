"""Opt-in real Keycloak browser fixture; fresh realm and SQLite DB, no preview data."""

import hashlib
import json
import os
import secrets
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import uuid4
import httpx

root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root / "services/api"))
config = json.loads((root / ".local/auth/config.json").read_text(encoding="utf-8"))
realm = json.loads(
    (root / ".local/auth/import/workroom-realm.json").read_text(encoding="utf-8")
)
realm_name = "workroom-e2e-" + uuid4().hex[:12]
secret = secrets.token_urlsafe(36)
realm.update(realm=realm_name, displayName="Workroom browser test")
client = realm["clients"][0]
client["secret"] = secret
client["redirectUris"] = ["http://127.0.0.1:5175/api/v1/auth/callback"]
client["webOrigins"] = ["http://127.0.0.1:5175"]
client["attributes"]["post.logout.redirect.uris"] = (
    "http://127.0.0.1:5175/app/today?logged_out=1"
)
with httpx.Client(base_url="http://127.0.0.1:8088", timeout=15) as admin:
    response = admin.post(
        "/realms/master/protocol/openid-connect/token",
        data={
            "client_id": "admin-cli",
            "grant_type": "password",
            "username": config["admin_username"],
            "password": config["admin_password"],
        },
    )
    response.raise_for_status()
    headers = {"Authorization": "Bearer " + response.json()["access_token"]}
    response = admin.post("/admin/realms", headers=headers, json=realm)
    response.raise_for_status()
issuer = "http://127.0.0.1:8088/realms/" + realm_name
folder = root / ".local"
folder.mkdir(exist_ok=True)
os.environ.update(
    APP_ENV="test",
    LOCAL_IDENTITY="false",
    WORKROOM_ORIGIN="http://127.0.0.1:5175",
    OIDC_ISSUER=issuer,
    OIDC_AUDIENCE="workroom-api",
    OIDC_JWKS_URL=issuer + "/protocol/openid-connect/certs",
    OIDC_CLIENT_ID="workroom-web",
    OIDC_CLIENT_SECRET=secret,
    DATABASE_URL="sqlite:///" + str(folder / (realm_name + ".db")),
)
from alembic import command  # noqa:E402
from alembic.config import Config  # noqa:E402
from sqlalchemy.orm import Session  # noqa:E402
from app.main import app  # noqa:E402
from app.models import Invite  # noqa:E402
import uvicorn  # noqa:E402

command.upgrade(Config(str(root / "services/api/alembic.ini")), "head")
fixture = {
    "realm": realm_name,
    "email": "account-" + uuid4().hex[:12] + "@example.test",
    "password": "Fixture1!" + secrets.token_urlsafe(18),
    "new_password": "Recovered2!" + secrets.token_urlsafe(18),
    "invitation": secrets.token_urlsafe(40),
}
with Session(app.state.engine) as db:
    db.add(
        Invite(
            email=fixture["email"],
            token_hash=hashlib.sha256(fixture["invitation"].encode()).hexdigest(),
            expires_at=(datetime.now(timezone.utc) + timedelta(hours=1)).isoformat(),
        )
    )
    db.commit()
(folder / "auth-e2e-fixture.json").write_text(json.dumps(fixture), encoding="utf-8")
uvicorn.run(app, host="127.0.0.1", port=8012)
