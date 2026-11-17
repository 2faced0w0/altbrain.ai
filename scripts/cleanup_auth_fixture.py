"""Remove only the disposable realm recorded by the real-auth browser fixture."""

import json
import re
from pathlib import Path
import httpx

root = Path(__file__).resolve().parents[1]
path = root / ".local/auth-e2e-fixture.json"
if path.exists():
    fixture = json.loads(path.read_text(encoding="utf-8"))
    realm = fixture.get("realm", "")
    if not re.fullmatch(r"workroom-e2e-[a-f0-9]{12}", realm):
        raise RuntimeError("Refusing to clean an unrecognized realm")
    config = json.loads((root / ".local/auth/config.json").read_text(encoding="utf-8"))
    with httpx.Client(base_url="http://127.0.0.1:8088", timeout=15) as client:
        response = client.post(
            "/realms/master/protocol/openid-connect/token",
            data={
                "client_id": "admin-cli",
                "grant_type": "password",
                "username": config["admin_username"],
                "password": config["admin_password"],
            },
        )
        response.raise_for_status()
        response = client.delete(
            "/admin/realms/" + realm,
            headers={"Authorization": "Bearer " + response.json()["access_token"]},
        )
        if response.status_code not in {204, 404}:
            response.raise_for_status()
    print(
        "Disposed of the isolated browser-test realm; Workroom accounts were preserved."
    )
