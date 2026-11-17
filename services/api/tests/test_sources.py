import hashlib
from uuid import uuid4
import pytest
from sqlalchemy import select, func, event
from sqlalchemy.orm import Session
from app.source_models import SourceAsset, SourceRun
from app.capture_models import CaptureRun, Message
from app.models import Task, TaskEvent, Mutation


def conversation(c, h):
    r = c.post("/api/v1/conversations", headers=h(), json={})
    assert r.status_code == 201, r.text
    return r.json()


def upload(
    c,
    h,
    row,
    data=b"Prepare the synthetic outline.\nReview the assessment.",
    filename="request.txt",
    **kwargs,
):
    headers = kwargs.pop("headers", h())
    return c.post(
        f"/api/v1/conversations/{row['id']}/sources",
        content=data,
        headers={
            **headers,
            "X-File-Name": filename,
            "Content-Type": "application/octet-stream",
            **kwargs,
        },
    )


def capture(c, h, row, asset, **kwargs):
    return c.post(
        f"/api/v1/conversations/{row['id']}/runs",
        headers=kwargs.pop("headers", h()),
        json={"expected_version": row["version"], "asset_id": asset["id"], **kwargs},
    )


def test_private_original_text_provenance_and_approval(setup):
    c, engine, h = setup
    row = conversation(c, h)
    data = b"Prepare the synthetic outline by Friday.\nReview the assessment."
    asset = upload(c, h, row, data).json()
    assert asset["state"] == "ready" and asset["byte_size"] == len(data)
    assert asset["content_hash"] == hashlib.sha256(data).hexdigest()
    assert not {"original", "extracted_text", "workspace_id"} & asset.keys()
    assert c.get("/api/v1/tasks", headers=h()).json()["total"] == 0
    assert (
        c.get("/api/v1/sources/" + asset["id"], headers=h()).json()["text"]
        == data.decode()
    )
    download = c.get("/api/v1/sources/" + asset["id"] + "/download", headers=h())
    assert download.content == data
    assert download.headers["content-type"] == "application/octet-stream"
    assert download.headers["content-disposition"].startswith("attachment;")
    assert download.headers["cache-control"] == "no-store"
    assert download.headers["x-content-type-options"] == "nosniff"
    run = capture(c, h, row, asset)
    assert run.status_code == 200, run.text
    run = run.json()
    assert len(run["proposals"]) == 2 and run["run"]["source_asset_id"] == asset["id"]
    assert c.get("/api/v1/tasks", headers=h()).json()["total"] == 0
    proposal = run["proposals"][0]
    result = c.post(
        "/api/v1/ai/proposals/" + proposal["id"] + "/decision",
        headers=h(),
        json={
            "expected_version": proposal["version"],
            "decision": "approve",
            "task": proposal["draft_task"],
        },
    )
    assert result.status_code == 200, result.text
    task_id = result.json()["commit"]["task"]["id"]
    source = c.get(f"/api/v1/tasks/{task_id}/source", headers=h()).json()
    assert source["asset"]["id"] == asset["id"] and source["evidence"] in data.decode()
    activity = c.get(f"/api/v1/tasks/{task_id}/events", headers=h()).json()
    assert activity[0]["changes"]["source"]["after"]["asset_id"] == asset["id"]
    page = c.get("/api/v1/conversations/" + row["id"], headers=h()).json()
    assert (
        page["sources"] == [asset] and page["runs"][0]["source_asset_id"] == asset["id"]
    )


def test_retry_dedup_and_preserved_draft(setup):
    c, engine, h = setup
    row = conversation(c, h)
    headers = h()
    response = upload(c, h, row, headers=headers)
    asset = response.json()
    assert upload(c, h, row, headers=headers).json() == asset
    assert upload(c, h, row).json() == asset
    assert (
        upload(c, h, row, b"Plan something else.", headers=headers).status_code == 409
    )
    saved = c.patch(
        "/api/v1/conversations/" + row["id"] + "/draft",
        headers=h(),
        json={"expected_version": row["version"], "draft": "Unsaved separate request"},
    ).json()
    keys = h()
    result = capture(c, h, saved, asset, headers=keys)
    assert result.status_code == 200, result.text
    assert result.json()["conversation"]["draft"] == "Unsaved separate request"
    assert capture(c, h, saved, asset, headers=keys).json() == result.json()
    with Session(engine) as db:
        assert db.scalar(select(func.count()).select_from(SourceAsset)) == 1
        assert db.scalar(select(func.count()).select_from(SourceRun)) == 1
        assert db.scalar(select(func.count()).select_from(CaptureRun)) == 1


def test_owner_conversation_scope_and_resource_injection(setup):
    c, engine, h = setup
    a = conversation(c, h)
    another = conversation(c, h)
    asset = upload(c, h, a).json()
    b_headers = h("b")
    assert upload(c, h, a, headers=b_headers).status_code == 404
    for path in (
        "/api/v1/sources/" + asset["id"],
        "/api/v1/sources/" + asset["id"] + "/download",
    ):
        assert c.get(path, headers=b_headers).status_code == 404
        assert c.get(path).status_code == 401
    assert capture(c, h, a, asset, headers=h("b")).status_code == 404
    assert capture(c, h, another, asset).status_code == 404
    assert capture(c, h, a, asset, content="Replace trusted text").status_code == 422
    assert capture(c, h, a, asset, workspace_id="guessed").status_code == 422
    assert (
        c.post(
            f"/api/v1/conversations/{a['id']}/sources",
            headers={"X-File-Name": "a.txt"},
            content=b"Prepare test",
        ).status_code
        == 401
    )
    assert capture(c, h, a, {"id": str(uuid4())}).status_code == 404
    task = c.post("/api/v1/tasks", headers=h(), json={"title": "Task context"}).json()[
        "task"
    ]
    fixed = c.post(f"/api/v1/tasks/{task['id']}/assistant", headers=h()).json()
    assert upload(c, h, fixed).status_code == 422
    assert (
        c.post(
            f"/api/v1/conversations/{fixed['id']}/task-runs",
            headers=h(),
            json={"expected_version": fixed["version"], "asset_id": asset["id"]},
        ).status_code
        == 422
    )


@pytest.mark.parametrize(
    "filename,data,extra,status",
    [
        ("a.pdf", b"%PDF-test", {}, 415),
        ("a.txt", b"%PDF-test", {}, 415),
        ("a.md", b"PK zip data", {}, 415),
        ("a.txt", b"\xff\xfe", {}, 415),
        ("a.txt", b"hello\x00world", {}, 415),
        ("a.txt", b"", {}, 413),
        ("a.txt", b"x" * 262145, {}, 413),
        ("a.txt", b"Prepare test", {"Content-Type": "text/html"}, 415),
        ("a.txt", b"Prepare test", {"Content-Encoding": "gzip"}, 415),
    ],
    ids=lambda value: f"bytes-{len(value)}" if isinstance(value, bytes) else None,
)
def test_disallowed_files_leave_no_storage_or_proposals(
    setup, filename, data, extra, status
):
    c, engine, h = setup
    row = conversation(c, h)
    response = upload(c, h, row, data, filename, **extra)
    assert response.status_code == status, response.text
    with Session(engine) as db:
        for model in (SourceAsset, SourceRun, CaptureRun, Message, Task, TaskEvent):
            assert db.scalar(select(func.count()).select_from(model)) == 0


@pytest.mark.parametrize(
    "filename,data,code",
    [
        ("empty.txt", b"   \r\n", "empty_text"),
        ("large.txt", b"x" * 20001, "text_too_long"),
        (
            "html.eml",
            b"Subject: Test\nContent-Type: text/html\n\n<p>Prepare private work</p>",
            "unsupported_email_body",
        ),
        (
            "attachments.eml",
            b"Subject: Test\nContent-Type: multipart/mixed; boundary=x\n\n--x\nContent-Type: text/plain\n\nPrepare work\n--x--",
            "unsupported_email_body",
        ),
        ("bad.eml", b"not a real email", "invalid_email"),
    ],
    ids=lambda value: f"bytes-{len(value)}" if isinstance(value, bytes) else None,
)
def test_failed_extraction_is_visible_quarantined_and_has_no_effects(
    setup, filename, data, code
):
    c, engine, h = setup
    row = conversation(c, h)
    response = upload(c, h, row, data, filename)
    assert response.status_code == 201, response.text
    asset = response.json()
    assert asset["state"] == "failed" and asset["error_code"] == code
    assert c.get("/api/v1/sources/" + asset["id"], headers=h()).json()["text"] == ""
    assert (
        c.get("/api/v1/sources/" + asset["id"] + "/download", headers=h()).status_code
        == 422
    )
    assert capture(c, h, row, asset).status_code == 422
    with Session(engine) as db:
        assert db.scalar(select(func.count()).select_from(SourceAsset)) == 1
        assert db.scalar(select(func.count()).select_from(CaptureRun)) == 0


def test_eml_decoding_headers_and_inert_markup(setup):
    c, engine, h = setup
    row = conversation(c, h)
    data = b"From: Trainer <trainer@example.test>\r\nSubject: Synthetic request\r\nDate: Mon, 26 Oct 2026 09:00:00 +0530\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\nPrepare the synthetic outline.\r\n<script>alert(1)</script>"
    asset = upload(c, h, row, data, "..%2F..%2Frequest.eml").json()
    assert asset["filename"] == "request.eml" and asset["state"] == "ready"
    text = c.get("/api/v1/sources/" + asset["id"], headers=h()).json()["text"]
    assert "Subject: Synthetic request" in text and "<script>" in text
    assert len(capture(c, h, row, asset).json()["proposals"]) == 1


def test_streamed_limit_checks_actual_bytes_without_content_length(setup):
    c, engine, h = setup
    row = conversation(c, h)
    chunks = (b"x" * 65536 for _ in range(5))
    response = c.post(
        f"/api/v1/conversations/{row['id']}/sources",
        headers={
            **h(),
            "X-File-Name": "large.txt",
            "Content-Type": "application/octet-stream",
        },
        content=chunks,
    )
    assert response.status_code == 413
    with Session(engine) as db:
        assert db.scalar(select(func.count()).select_from(SourceAsset)) == 0


def test_upload_atomic_rollback_and_conversation_quota(setup):
    c, engine, h = setup
    row = conversation(c, h)

    def fail_receipt(mapper, connection, target):
        raise RuntimeError("Synthetic receipt write failure")

    event.listen(Mutation, "before_insert", fail_receipt)
    try:
        with pytest.raises(RuntimeError):
            upload(c, h, row)
    finally:
        event.remove(Mutation, "before_insert", fail_receipt)
    with Session(engine) as db:
        assert db.scalar(select(func.count()).select_from(SourceAsset)) == 0
    for index in range(20):
        assert upload(c, h, row, filename=f"file{index}.txt").status_code == 201
    assert upload(c, h, row, filename="over-limit.txt").status_code == 413
    # A retry/dedup still works when the quota is full.
    assert upload(c, h, row, filename="file0.txt").status_code == 201


def test_file_provider_failure_retains_cached_text_for_retry(setup):
    c, engine, h = setup
    row = conversation(c, h)
    asset = upload(c, h, row).json()
    provider = c.app.state.capture_provider

    def unavailable(content):
        raise TimeoutError()

    c.app.state.capture_provider = type(
        "Unavailable", (), {"extract": staticmethod(unavailable)}
    )()
    failed = capture(c, h, row, asset).json()
    assert failed["run"]["state"] == "failed" and failed["proposals"] == []
    assert failed["run"]["source_asset_id"] == asset["id"]
    assert c.get("/api/v1/sources/" + asset["id"], headers=h()).json()["text"]
    c.app.state.capture_provider = provider
    recovered = capture(c, h, failed["conversation"], asset).json()
    assert len(recovered["proposals"]) == 2
    with Session(engine) as db:
        assert db.scalar(select(func.count()).select_from(SourceAsset)) == 1
        assert db.scalar(select(func.count()).select_from(Task)) == 0


def test_concurrent_uploads_reuse_one_private_original(setup):
    from concurrent.futures import ThreadPoolExecutor
    import threading

    c, engine, h = setup
    if engine.dialect.name != "postgresql":
        pytest.skip("Real concurrent quota and dedup locking runs on PostgreSQL")
    row = conversation(c, h)
    gate = threading.Barrier(2)
    keys = [h(), h()]

    def send(index):
        gate.wait(timeout=10)
        return upload(c, h, row, headers=keys[index])

    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(send, range(2)))
    assert [r.status_code for r in responses] == [201, 201]
    assert responses[0].json()["id"] == responses[1].json()["id"]
    with Session(engine) as db:
        assert db.scalar(select(func.count()).select_from(SourceAsset)) == 1
