from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from types import SimpleNamespace

import pytest
from sqlalchemy import event, select
from sqlalchemy.orm import Session

from app.assistant_models import TaskConversation, TaskUpdateProposal
from app.mock_provider import MockFailure
from app.models import Note, Step, Task, TaskEvent, User


def task(client, headers, user="a", **values):
    response = client.post(
        "/api/v1/tasks",
        headers=headers(user),
        json={"title": "Synthetic selected task", **values},
    )
    assert response.status_code == 201, response.text
    return response.json()["task"]


def open_chat(client, headers, item, user="a"):
    response = client.post(
        f"/api/v1/tasks/{item['id']}/assistant", headers=headers(user)
    )
    assert response.status_code == 200, response.text
    return response.json()


def send(client, headers, row, content, user="a", key=None):
    response = client.post(
        f"/api/v1/conversations/{row['id']}/task-runs",
        headers=key or headers(user),
        json={"expected_version": row["version"], "content": content},
    )
    assert response.status_code == 200, response.text
    return response.json()


def decide(client, headers, proposal, action="approve", changes=None, key=None):
    return client.post(
        f"/api/v1/ai/task-updates/{proposal['id']}/decision",
        headers=key or headers(),
        json={
            "expected_version": proposal["version"],
            "decision": action,
            "changes": changes,
        },
    )


def test_advice_is_read_only_and_scope_and_drafts_survive(setup):
    client, engine, headers = setup
    item = task(client, headers, status="blocked", blocker_reason="Awaiting access")
    row = open_chat(client, headers, item)
    assert row["task_id"] == item["id"]
    assert open_chat(client, headers, item)["id"] == row["id"]
    result = send(client, headers, row, "What should I do next?")
    assert result["updates"] == []
    detail = client.get(f"/api/v1/conversations/{row['id']}", headers=headers()).json()
    assert detail["task"]["id"] == item["id"]
    assert "Awaiting access" in detail["messages"][-1]["content"]
    assert "Synthetic selected task" in detail["messages"][-1]["content"]
    assert (
        client.get(f"/api/v1/tasks/{item['id']}", headers=headers()).json()["version"]
        == 1
    )
    assert (
        len(client.get(f"/api/v1/tasks/{item['id']}/events", headers=headers()).json())
        == 1
    )
    saved = client.patch(
        f"/api/v1/conversations/{row['id']}/draft",
        headers=headers(),
        json={
            "expected_version": result["conversation"]["version"],
            "draft": "Unsaved task question",
        },
    ).json()
    assert saved["task_id"] == item["id"]
    assert (
        client.get(f"/api/v1/conversations/{row['id']}", headers=headers()).json()[
            "conversation"
        ]["draft"]
        == "Unsaved task question"
    )
    assert (
        client.post(
            f"/api/v1/conversations/{row['id']}/runs",
            headers=headers(),
            json={
                "expected_version": saved["version"],
                "content": "Create another task",
            },
        ).status_code
        == 422
    )
    with Session(engine) as db:
        assert len(db.scalars(select(Task)).all()) == 1
        assert len(db.scalars(select(TaskConversation)).all()) == 1


def test_update_approval_is_explicit_atomic_and_idempotent(setup):
    client, _, headers = setup
    item = task(client, headers)
    row = open_chat(client, headers, item)
    key = headers()
    result = send(client, headers, row, "Mark this done and set priority high", key=key)
    assert (
        send(client, headers, row, "Mark this done and set priority high", key=key)
        == result
    )
    proposal = result["updates"][0]
    assert proposal["base_version"] == 1
    assert proposal["proposed_changes"] == {"status": "completed", "priority": "high"}
    assert proposal["before_state"]["status"] == "inbox"
    assert (
        client.get(f"/api/v1/tasks/{item['id']}", headers=headers()).json()["status"]
        == "inbox"
    )
    approval_key = headers()
    first = decide(
        client,
        headers,
        proposal,
        changes=proposal["proposed_changes"],
        key=approval_key,
    )
    assert first.status_code == 200, first.text
    assert first.json()["commit"]["task"]["id"] == item["id"]
    assert first.json()["commit"]["task"]["version"] == 2
    assert first.json()["commit"]["task"]["completed_at"]
    assert (
        decide(
            client,
            headers,
            proposal,
            changes=proposal["proposed_changes"],
            key=approval_key,
        ).json()
        == first.json()
    )
    assert (
        decide(client, headers, proposal, changes=proposal["proposed_changes"]).json()
        == first.json()
    )
    history = client.get(f"/api/v1/tasks/{item['id']}/events", headers=headers()).json()
    assert len(history) == 2
    assert history[0]["event_type"] == "task_updated_from_proposal"
    assert history[0]["changes"]["status"] == {"before": "inbox", "after": "completed"}
    assert history[0]["changes"]["source"]["after"]["conversation_id"] == row["id"]
    assert client.get("/api/v1/tasks", headers=headers()).json()["total"] == 1
    assert (
        decide(client, headers, proposal, changes={"priority": "low"}).status_code
        == 409
    )


def test_reject_stale_and_edited_fields_do_not_overwrite_other_changes(setup):
    client, _, headers = setup
    item = task(client, headers)
    result = send(client, headers, open_chat(client, headers, item), "Mark this done")
    proposal = result["updates"][0]
    assert (
        client.patch(
            f"/api/v1/tasks/{item['id']}",
            headers=headers(),
            json={"expected_version": 1, "changes": {"priority": "urgent"}},
        ).status_code
        == 200
    )
    stale = decide(client, headers, proposal, changes={"status": "completed"})
    assert stale.status_code == 409
    assert "changed after" in stale.text
    assert (
        len(client.get(f"/api/v1/tasks/{item['id']}/events", headers=headers()).json())
        == 2
    )
    assert decide(client, headers, proposal, "reject").status_code == 200
    assert (
        decide(client, headers, proposal, changes={"status": "completed"}).status_code
        == 409
    )
    refreshed = send(client, headers, result["conversation"], "Mark this done")
    edited = decide(
        client,
        headers,
        refreshed["updates"][0],
        changes={"status": "waiting", "blocker_reason": "Waiting for a reviewer"},
    )
    assert edited.status_code == 200
    assert edited.json()["commit"]["task"]["priority"] == "urgent"
    assert edited.json()["commit"]["task"]["status"] == "waiting"
    assert client.get("/api/v1/tasks", headers=headers()).json()["total"] == 1


def test_deadline_uncertainty_clear_and_progress_reopen_semantics(setup):
    client, _, headers = setup
    item = task(
        client,
        headers,
        due_at="2026-10-30T09:00:00Z",
        status="completed",
        manual_progress=25,
    )
    result = send(
        client, headers, open_chat(client, headers, item), "Move deadline to Friday"
    )
    proposal = result["updates"][0]
    assert proposal["proposed_changes"] == {}
    assert proposal["questions"]
    assert decide(client, headers, proposal, changes={}).status_code == 422
    approved = decide(
        client, headers, proposal, changes={"due_at": "2026-11-02T09:30:00+05:30"}
    )
    assert approved.status_code == 200
    assert approved.json()["commit"]["task"]["due_at"] == "2026-11-02T04:00:00Z"
    next_run = send(
        client,
        headers,
        result["conversation"],
        "Reopen this task and set progress 60% and clear deadline",
    )
    changes = next_run["updates"][0]["proposed_changes"]
    assert changes == {
        "status": "planned",
        "progress_mode": "manual",
        "manual_progress": 60,
        "due_at": None,
    }
    applied = decide(client, headers, next_run["updates"][0], changes=changes).json()[
        "commit"
    ]["task"]
    assert applied["completed_at"] is None and applied["due_at"] is None
    assert applied["manual_progress"] == 60
    history = client.get(f"/api/v1/tasks/{item['id']}/events", headers=headers()).json()
    assert len(history) == 3
    assert any(
        entry["changes"].get("status", {}).get("after") == "completed"
        for entry in history
    )


def test_task_assistant_tenant_isolation_and_target_injection(setup):
    client, _, headers = setup
    foreign = task(client, headers, "b", title="Private foreign task")
    assert (
        client.post(
            f"/api/v1/tasks/{foreign['id']}/assistant", headers=headers("a")
        ).status_code
        == 404
    )
    row = open_chat(client, headers, foreign, "b")
    result = send(client, headers, row, "Mark this done", "b")
    proposal = result["updates"][0]
    assert (
        client.get(
            f"/api/v1/conversations/{row['id']}", headers=headers("a")
        ).status_code
        == 404
    )
    assert (
        client.post(
            f"/api/v1/conversations/{row['id']}/task-runs",
            headers=headers("a"),
            json={"expected_version": 2, "content": "Mark this done"},
        ).status_code
        == 404
    )
    assert (
        decide(client, headers, proposal, changes={"status": "completed"}).status_code
        == 404
    )
    assert decide(client, headers, proposal, "reject").status_code == 404
    own = task(client, headers)
    own_chat = open_chat(client, headers, own)
    assert (
        client.post(
            f"/api/v1/conversations/{own_chat['id']}/task-runs",
            headers=headers(),
            json={
                "expected_version": 1,
                "content": "Mark this done",
                "task_id": foreign["id"],
            },
        ).status_code
        == 422
    )
    own_result = send(client, headers, own_chat, "Mark this done")
    assert (
        decide(
            client,
            headers,
            own_result["updates"][0],
            changes={"task_id": foreign["id"], "status": "completed"},
        ).status_code
        == 422
    )
    assert (
        client.get(f"/api/v1/tasks/{foreign['id']}", headers=headers("b")).json()[
            "status"
        ]
        == "inbox"
    )
    assert client.post(f"/api/v1/tasks/{own['id']}/assistant").status_code == 401


def test_context_packet_contains_only_selected_task_and_bounded_owned_history(setup):
    client, engine, headers = setup
    own = task(client, headers, description="A" * 10000)
    secret = task(client, headers, "b", title="NEVER INCLUDE FOREIGN CONTENT")
    row = open_chat(client, headers, own)
    with Session(engine) as db:
        user = db.scalar(select(User).where(User.subject == "a"))
        stored = db.get(Task, own["id"])
        for index in range(26):
            db.add(
                Step(
                    workspace_id=stored.workspace_id,
                    task_id=stored.id,
                    text=f"Owned step {index}",
                    position=index,
                )
            )
        db.add(
            Note(
                workspace_id=stored.workspace_id,
                task_id=stored.id,
                content="N" * 2000,
                author_id=user.id,
            )
        )
        db.commit()
    packets = []

    def respond(request, context):
        packets.append(context)
        return {
            "kind": "guidance",
            "reply": "Use the selected task checklist.",
            "changes": {},
        }

    client.app.state.task_assistant_provider = SimpleNamespace(respond=respond)
    result = send(client, headers, row, "What next?")
    assert result["updates"] == []
    packet = packets[0]
    assert packet["task"]["id"] == own["id"] and packet["task"]["id"] != secret["id"]
    assert len(packet["task"]["description"]) == 4000
    assert len(packet["steps"]) == 20
    assert len(packet["notes"][0]["content"]) == 600
    assert "NEVER INCLUDE FOREIGN CONTENT" not in str(packet)


@pytest.mark.parametrize(
    "mode", ["timeout", "quota", "invalid", "guidance_mutation", "ungrounded"]
)
def test_failed_task_runs_preserve_request_without_changes(setup, mode):
    client, _, headers = setup
    item = task(client, headers)
    row = open_chat(client, headers, item)

    def respond(request, context):
        if mode == "timeout":
            raise TimeoutError()
        if mode == "quota":
            raise MockFailure("quota_exhausted")
        if mode == "guidance_mutation":
            return {
                "kind": "guidance",
                "reply": "advice",
                "changes": {"status": "completed"},
            }
        if mode == "ungrounded":
            return {
                "kind": "update",
                "reply": "review",
                "changes": {"status": "completed"},
                "evidence": "Fabricated evidence",
            }
        return {
            "kind": "update",
            "reply": "review",
            "changes": {"workspace_id": "foreign"},
            "evidence": request,
        }

    client.app.state.task_assistant_provider = SimpleNamespace(respond=respond)
    result = send(client, headers, row, "Mark this done")
    assert result["run"]["state"] == "failed"
    assert result["conversation"]["draft"] == "Mark this done"
    assert result["updates"] == []
    assert (
        client.get(f"/api/v1/tasks/{item['id']}", headers=headers()).json()["version"]
        == 1
    )
    assert (
        len(client.get(f"/api/v1/tasks/{item['id']}/events", headers=headers()).json())
        == 1
    )


def test_task_update_and_review_roll_back_on_event_failure(setup):
    client, engine, headers = setup
    item = task(client, headers)
    result = send(client, headers, open_chat(client, headers, item), "Mark this done")
    proposal = result["updates"][0]

    def fail(*_):
        raise RuntimeError("Injected history failure")

    event.listen(TaskEvent, "before_insert", fail)
    try:
        with pytest.raises(RuntimeError):
            decide(client, headers, proposal, changes={"status": "completed"})
    finally:
        event.remove(TaskEvent, "before_insert", fail)
    with Session(engine) as db:
        assert db.get(Task, item["id"]).version == 1
        assert db.get(Task, item["id"]).completed_at is None
        assert (
            db.get(TaskUpdateProposal, proposal["id"]).review_state
            == "ready_for_review"
        )


def test_simultaneous_postgres_updates_apply_once(setup):
    client, engine, headers = setup
    if engine.dialect.name != "postgresql":
        pytest.skip("Real concurrent update assertion runs on PostgreSQL")
    item = task(client, headers)
    result = send(client, headers, open_chat(client, headers, item), "Mark this done")
    proposal = result["updates"][0]
    barrier = Barrier(2)

    def loaded(row, _):
        if row.id == item["id"] and row.version == 1:
            barrier.wait(timeout=10)

    event.listen(Task, "load", loaded)
    try:
        with ThreadPoolExecutor(2) as pool:
            results = list(
                pool.map(
                    lambda _: decide(
                        client, headers, proposal, changes={"status": "completed"}
                    ),
                    range(2),
                )
            )
    finally:
        event.remove(Task, "load", loaded)
    assert sorted(response.status_code for response in results) == [200, 409]
    with Session(engine) as db:
        assert db.get(Task, item["id"]).version == 2
        assert (
            len(
                db.scalars(
                    select(TaskEvent).where(TaskEvent.task_id == item["id"])
                ).all()
            )
            == 2
        )
