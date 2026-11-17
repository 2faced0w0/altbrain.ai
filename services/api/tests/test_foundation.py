import hashlib
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select, text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import Session

from app.auth import Settings
from app.main import create_app
from app.models import Invite, Task, TaskEvent


def create(client, headers, **fields):
    response = client.post(
        "/api/v1/tasks",
        headers=headers,
        json={"title": "Synthetic assignment", **fields},
    )
    assert response.status_code == 201, response.text
    return response.json()["task"]


def test_auth_fail_closed(setup):
    client, _, headers = setup
    assert client.get("/api/v1/tasks").status_code == 401
    assert (
        client.get("/api/v1/tasks", headers=headers(email_verified=False)).status_code
        == 401
    )
    assert client.get("/api/v1/tasks", headers=headers(aud="wrong")).status_code == 401
    assert (
        client.get(
            "/api/v1/tasks",
            headers=headers(exp=datetime.now(timezone.utc) - timedelta(seconds=5)),
        ).status_code
        == 401
    )
    assert (
        client.post(
            "/api/v1/dev/session", headers={"X-Local-Development": "worktracker"}
        ).status_code
        == 404
    )
    assert client.get("/api/v1/tasks", headers=headers("unknown")).status_code == 403


def test_tenant_isolation_every_task_path(setup):
    client, _, headers = setup
    task = create(client, headers("b"), title="B private task")
    own = create(client, headers("a"), title="A private task")
    result = client.get("/api/v1/tasks", headers=headers("a")).json()
    assert [row["id"] for row in result["items"]] == [own["id"]]
    for suffix in ("", "/events"):
        response = client.get(
            f"/api/v1/tasks/{task['id']}{suffix}", headers=headers("a")
        )
        assert response.status_code == 404
        assert "B private" not in response.text
    assert (
        client.patch(
            f"/api/v1/tasks/{task['id']}",
            headers=headers("a"),
            json={"expected_version": 1, "changes": {"status": "completed"}},
        ).status_code
        == 404
    )
    for action in ("archive", "restore"):
        assert (
            client.post(
                f"/api/v1/tasks/{task['id']}/{action}",
                headers=headers("a"),
                json={"expected_version": 1},
            ).status_code
            == 404
        )
    assert (
        client.post(
            "/api/v1/tasks",
            headers=headers("a"),
            json={"title": "bad", "workspace_id": "foreign"},
        ).status_code
        == 422
    )


def test_retry_conflict_reopen_and_history(setup):
    client, engine, headers = setup
    auth = headers()
    task = create(client, auth)
    assert create(client, auth)["id"] == task["id"]
    assert (
        client.post(
            "/api/v1/tasks", headers=auth, json={"title": "Different"}
        ).status_code
        == 409
    )
    patch_headers = headers()
    payload = {"expected_version": 1, "changes": {"status": "completed"}}
    first = client.patch(
        f"/api/v1/tasks/{task['id']}", headers=patch_headers, json=payload
    )
    assert first.status_code == 200
    assert first.json()["task"]["completed_at"]
    assert (
        client.patch(
            f"/api/v1/tasks/{task['id']}", headers=patch_headers, json=payload
        ).json()
        == first.json()
    )
    assert (
        client.patch(
            f"/api/v1/tasks/{task['id']}", headers=headers(), json=payload
        ).status_code
        == 409
    )
    reopened = client.patch(
        f"/api/v1/tasks/{task['id']}",
        headers=headers(),
        json={"expected_version": 2, "changes": {"status": "planned"}},
    )
    assert reopened.json()["task"]["completed_at"] is None
    history = client.get(f"/api/v1/tasks/{task['id']}/events", headers=headers()).json()
    assert len(history) == 3
    assert any(
        e["changes"].get("status", {}).get("after") == "completed" for e in history
    )
    with engine.begin() as connection:
        with pytest.raises(DBAPIError):
            connection.execute(text("UPDATE task_events SET event_type = 'tamper'"))


def test_archive_restore_validation_and_search(setup):
    client, _, headers = setup
    task = create(client, headers(), title="100% ready")
    assert client.get("/api/v1/tasks?q=%25", headers=headers()).json()["total"] == 1
    assert client.get("/api/v1/tasks?q=absent", headers=headers()).json()["total"] == 0
    for body in (
        {"title": " "},
        {"title": "x", "status": "bogus"},
        {"title": "x", "due_at": "2026-10-25T12:00:00"},
    ):
        assert (
            client.post("/api/v1/tasks", headers=headers(), json=body).status_code
            == 422
        )
    assert (
        client.patch(
            f"/api/v1/tasks/{task['id']}",
            headers=headers(),
            json={"expected_version": 1, "changes": {"title": None}},
        ).status_code
        == 422
    )
    assert (
        client.post(
            f"/api/v1/tasks/{task['id']}/archive",
            headers=headers(),
            json={"expected_version": 1},
        ).status_code
        == 200
    )
    assert client.get("/api/v1/tasks", headers=headers()).json()["total"] == 0
    assert (
        client.get("/api/v1/tasks?archived=true", headers=headers()).json()["total"]
        == 1
    )
    assert (
        client.post(
            f"/api/v1/tasks/{task['id']}/restore",
            headers=headers(),
            json={"expected_version": 2},
        ).status_code
        == 200
    )


def test_invite_identity_email_expiry_and_single_redemption(setup):
    client, engine, headers = setup
    tokens = {
        "new": "valid-invitation-token-123",
        "expired": "expired-invitation-12345",
    }
    with Session(engine) as db:
        for name, token in tokens.items():
            db.add(
                Invite(
                    token_hash=hashlib.sha256(token.encode()).hexdigest(),
                    email=f"{name}@example.test",
                    expires_at=(
                        datetime.now(timezone.utc)
                        + timedelta(days=1 if name == "new" else -1)
                    ).isoformat(),
                )
            )
        db.commit()
    assert (
        client.post(
            "/api/v1/invitations/redeem",
            headers=headers("wrong"),
            json={"token": tokens["new"]},
        ).status_code
        == 403
    )
    assert (
        client.post(
            "/api/v1/invitations/redeem",
            headers=headers("expired"),
            json={"token": tokens["expired"]},
        ).status_code
        == 403
    )
    assert (
        client.post(
            "/api/v1/invitations/redeem",
            headers=headers("new"),
            json={"token": tokens["new"]},
        ).status_code
        == 200
    )
    assert (
        client.post(
            "/api/v1/invitations/redeem",
            headers=headers("new"),
            json={"token": tokens["new"]},
        ).status_code
        == 403
    )
    assert (
        client.get("/api/v1/me", headers=headers("new")).json()["workspace_name"]
        == "My workspace"
    )


def test_atomic_rollback_on_event_failure(setup, monkeypatch):
    client, engine, headers = setup
    task = create(client, headers())
    from sqlalchemy import event

    def fail(mapper, connection, target):
        raise RuntimeError("Injected event write failure")

    event.listen(TaskEvent, "before_insert", fail)
    try:
        with pytest.raises(RuntimeError):
            client.patch(
                f"/api/v1/tasks/{task['id']}",
                headers=headers(),
                json={"expected_version": 1, "changes": {"title": "Must roll back"}},
            )
    finally:
        event.remove(TaskEvent, "before_insert", fail)
    with Session(engine) as db:
        assert db.get(Task, task["id"]).title == "Synthetic assignment"
        assert len(db.scalars(select(TaskEvent)).all()) == 1


def test_production_rejects_local_identity():
    with pytest.raises(RuntimeError):
        create_app(Settings(environment="production", local_identity=True))
    with pytest.raises(RuntimeError):
        create_app(Settings(environment="production"))


def test_timezone_preferences(setup):
    client, _, headers = setup
    assert (
        client.patch(
            "/api/v1/workspace/preferences",
            headers=headers(),
            json={"timezone": "Europe/London"},
        ).status_code
        == 200
    )
    assert (
        client.get("/api/v1/me", headers=headers()).json()["timezone"]
        == "Europe/London"
    )
    assert (
        client.patch(
            "/api/v1/workspace/preferences",
            headers=headers(),
            json={"timezone": "Invalid/Zone"},
        ).status_code
        == 422
    )


def test_task_work_progress_retries_and_history(setup):
    client, _, headers = setup
    task = create(
        client,
        headers(),
        progress_mode="manual",
        manual_progress=35,
        blocker_reason="Waiting for approval",
    )
    url = f"/api/v1/tasks/{task['id']}"
    key = headers()
    body = {"expected_version": 1, "text": "Review draft", "position": 2}
    added = client.post(url + "/steps", headers=key, json=body)
    assert added.status_code == 200, added.text
    assert client.post(url + "/steps", headers=key, json=body).json() == added.json()
    work = client.get(url + "/work", headers=headers()).json()
    assert len(work["steps"]) == 1
    step = work["steps"][0]
    changed = client.patch(
        url + "/steps/" + step["id"],
        headers=headers(),
        json={
            "expected_version": 2,
            "text": "Review revised draft",
            "checked": True,
            "position": 1,
        },
    )
    assert changed.status_code == 200
    current = changed.json()["task"]
    assert current["step_progress"] == 100
    assert current["manual_progress"] == 35
    assert current["status"] == "inbox"
    assert current["blocker_reason"] == "Waiting for approval"
    assert (
        client.post(
            url + "/notes",
            headers=headers(),
            json={"expected_version": 2, "content": "Stale note"},
        ).status_code
        == 409
    )
    assert (
        client.post(
            url + "/notes",
            headers=headers(),
            json={"expected_version": 3, "content": "Reviewed with synthetic fixture"},
        ).status_code
        == 200
    )
    added = client.post(
        url + "/deliverables",
        headers=headers(),
        json={"expected_version": 4, "description": "Final draft"},
    )
    assert added.status_code == 200
    row = client.get(url + "/work", headers=headers()).json()["deliverables"][0]
    assert (
        client.patch(
            url + "/deliverables/" + row["id"],
            headers=headers(),
            json={
                "expected_version": 5,
                "description": "Final reviewed draft",
                "state": "ready",
            },
        ).status_code
        == 200
    )
    work = client.get(url + "/work", headers=headers()).json()
    assert work["steps"][0]["checked_at"]
    assert len(work["notes"]) == 1
    assert work["deliverables"][0]["state"] == "ready"
    events = client.get(url + "/events", headers=headers()).json()
    assert len(events) == 6
    assert {row["event_type"] for row in events} == {
        "task_created",
        "step_added",
        "step_updated",
        "note_added",
        "deliverable_added",
        "deliverable_updated",
    }


def test_task_work_tenant_and_parent_isolation(setup):
    client, _, headers = setup
    foreign = create(client, headers("b"))
    own = create(client, headers("a"))
    url = f"/api/v1/tasks/{foreign['id']}"
    assert (
        client.post(
            url + "/steps",
            headers=headers("b"),
            json={"expected_version": 1, "text": "Private step"},
        ).status_code
        == 200
    )
    assert (
        client.post(
            url + "/deliverables",
            headers=headers("b"),
            json={"expected_version": 2, "description": "Private deliverable"},
        ).status_code
        == 200
    )
    work = client.get(url + "/work", headers=headers("b")).json()
    assert client.get(url + "/work", headers=headers("a")).status_code == 404
    for kind, body in [
        ("steps", {"text": "Intruder"}),
        ("notes", {"content": "Intruder"}),
        ("deliverables", {"description": "Intruder"}),
        ("reschedule", {"local_date": "2026-11-02"}),
    ]:
        assert (
            client.post(
                url + "/" + kind,
                headers=headers("a"),
                json={"expected_version": 3, **body},
            ).status_code
            == 404
        )
    for kind, body in [
        ("steps", {"text": "Intruder"}),
        ("deliverables", {"description": "Intruder"}),
    ]:
        item_id = work[kind][0]["id"]
        assert (
            client.patch(
                f"/api/v1/tasks/{own['id']}/{kind}/{item_id}",
                headers=headers("a"),
                json={"expected_version": 1, **body},
            ).status_code
            == 404
        )
        assert (
            client.patch(
                url + f"/{kind}/{item_id}",
                headers=headers("a"),
                json={"expected_version": 3, **body},
            ).status_code
            == 404
        )


def test_step_write_rolls_back_when_history_fails(setup):
    from sqlalchemy import event
    from app.models import Step

    client, engine, headers = setup
    task = create(client, headers())

    def fail(mapper, connection, target):
        raise RuntimeError("Injected history failure")

    event.listen(TaskEvent, "before_insert", fail)
    try:
        with pytest.raises(RuntimeError):
            client.post(
                f"/api/v1/tasks/{task['id']}/steps",
                headers=headers(),
                json={"expected_version": 1, "text": "Must not persist"},
            )
    finally:
        event.remove(TaskEvent, "before_insert", fail)
    with Session(engine) as db:
        assert db.scalars(select(Step)).all() == []
        assert db.get(Task, task["id"]).version == 1


def test_calendar_workspace_timezone_dst_and_idempotency(setup):
    client, _, headers = setup
    client.patch(
        "/api/v1/workspace/preferences",
        headers=headers(),
        json={"timezone": "America/New_York"},
    )
    task = create(client, headers(), due_at="2026-03-07T14:30:00Z")
    url = f"/api/v1/tasks/{task['id']}/reschedule"
    key = headers()
    body = {"expected_version": 1, "local_date": "2026-03-08"}
    result = client.post(url, headers=key, json=body)
    assert result.status_code == 200
    assert (
        result.json()["task"]["due_at"] == "2026-03-08T13:30:00Z"
    )  # still 09:30 after DST
    assert client.post(url, headers=key, json=body).json() == result.json()
    assert (
        client.post(
            url,
            headers=headers(),
            json={
                "expected_version": 2,
                "local_date": "2026-03-08",
                "local_time": "02:30",
            },
        ).status_code
        == 422
    )
    ambiguous = {
        "expected_version": 2,
        "local_date": "2026-11-01",
        "local_time": "01:30",
    }
    assert client.post(url, headers=headers(), json=ambiguous).status_code == 422
    result = client.post(url, headers=headers(), json={**ambiguous, "fold": 1})
    assert result.status_code == 200
    assert result.json()["task"]["due_at"] == "2026-11-01T06:30:00Z"
    assert client.post(url, headers=headers(), json=ambiguous).status_code == 409
    history = client.get(f"/api/v1/tasks/{task['id']}/events", headers=headers()).json()
    assert len(history) == 3  # rejected gaps/folds/conflicts never emit events


def test_work_validation_and_clear_deadline(setup):
    client, _, headers = setup
    task = create(client, headers(), due_at="2026-10-26T00:15:00+05:30")
    assert task["due_at"] == "2026-10-25T18:45:00Z"
    url = f"/api/v1/tasks/{task['id']}"
    for kind, body in [
        ("steps", {"text": " "}),
        ("deliverables", {"description": "x", "state": "unknown"}),
        ("notes", {"content": " "}),
    ]:
        assert (
            client.post(
                url + "/" + kind,
                headers=headers(),
                json={"expected_version": 1, **body},
            ).status_code
            == 422
        )
    for changes in (
        {"manual_progress": 101},
        {"progress_mode": "auto"},
        {"blocker_reason": None},
    ):
        assert (
            client.patch(
                url, headers=headers(), json={"expected_version": 1, "changes": changes}
            ).status_code
            == 422
        )
    assert (
        client.patch(
            url,
            headers=headers(),
            json={"expected_version": 1, "changes": {"due_at": None}},
        ).json()["task"]["due_at"]
        is None
    )


def test_deadline_resolution_uses_owner_timezone_without_mutation(setup):
    client, engine, headers = setup
    client.patch(
        "/api/v1/workspace/preferences",
        headers=headers("a"),
        json={"timezone": "Europe/London"},
    )
    payload = {"local_date": "2026-10-26", "local_time": "09:30"}
    url = "/api/v1/workspace/resolve-deadline"
    assert client.post(url, json=payload).status_code == 401
    first = client.post(url, headers=headers("a"), json=payload)
    second = client.post(url, headers=headers("b"), json=payload)
    assert first.json() == {
        "due_at": "2026-10-26T09:30:00+00:00",
        "timezone": "Europe/London",
    }
    assert second.json() == {
        "due_at": "2026-10-26T04:00:00+00:00",
        "timezone": "Asia/Kolkata",
    }
    assert (
        client.post(
            url, headers=headers(), json={**payload, "local_time": "09:30+01:00"}
        ).status_code
        == 422
    )
    assert (
        client.post(
            url, headers=headers(), json={**payload, "workspace_id": "foreign"}
        ).status_code
        == 422
    )
    with Session(engine) as db:
        assert db.scalars(select(TaskEvent)).all() == []
