"""Authenticated source intake. Originals never get a public URL."""

import hashlib
from urllib.parse import quote, unquote
from fastapi import Depends, Header, HTTPException, Request
from fastapi.responses import Response
from sqlalchemy import select, func
from sqlalchemy.orm import Session
from .assistant_models import TaskConversation
from .models import Workspace
from .source_models import SourceAsset
from .source_schemas import SourceOut, SourceText
from .source_parser import MAX_BYTES, validate_upload, extract_text


def scoped_asset(session, workspace, asset_id, conversation_id=None):
    query = select(SourceAsset).where(
        SourceAsset.workspace_id == workspace.id, SourceAsset.id == asset_id
    )
    if conversation_id:
        query = query.where(SourceAsset.conversation_id == conversation_id)
    asset = session.scalar(query)
    if not asset:
        raise HTTPException(404, "Source file not found")
    return asset


def install_sources(app, owner, db, fingerprint, receipt, conversation, finish):
    @app.post(
        "/api/v1/conversations/{conversation_id}/sources",
        response_model=SourceOut,
        status_code=201,
        openapi_extra={
            "requestBody": {
                "required": True,
                "content": {
                    "application/octet-stream": {
                        "schema": {"type": "string", "format": "binary"}
                    }
                },
            }
        },
    )
    async def upload(
        conversation_id: str,
        request: Request,
        filename: str = Header(alias="X-File-Name", min_length=1, max_length=720),
        idempotency_key: str = Header(min_length=8, max_length=100),
        context=Depends(owner),
        session: Session = Depends(db),
    ):
        workspace = context[1]
        row = conversation(session, workspace, conversation_id)
        if session.get(TaskConversation, (workspace.id, row.id)):
            raise HTTPException(
                422,
                "Upload files in a capture conversation; task assistance uses its fixed task context",
            )
        if request.headers.get("content-encoding", "identity") != "identity":
            raise HTTPException(415, "Compressed uploads are not supported")
        length = request.headers.get("content-length")
        if length and (
            not length.isdecimal() or len(length) > 10 or int(length) > MAX_BYTES
        ):
            raise HTTPException(413, "Choose a nonempty file no larger than 256 KB")
        data = bytearray()
        async for chunk in request.stream():
            if len(data) + len(chunk) > MAX_BYTES:
                raise HTTPException(413, "Choose a nonempty file no larger than 256 KB")
            data.extend(chunk)
        original = bytes(data)
        safe_name, media_type, text = validate_upload(
            unquote(filename), request.headers.get("content-type", ""), original
        )
        content_hash = hashlib.sha256(original).hexdigest()
        digest = fingerprint(
            "source:upload:" + row.id,
            {"filename": safe_name, "media_type": media_type, "hash": content_hash},
        )
        old = receipt(session, workspace, idempotency_key, digest)
        if old:
            return old
        # Serialize quota checks on PostgreSQL across all concurrent uploads.
        session.scalar(
            select(Workspace).where(Workspace.id == workspace.id).with_for_update()
        )
        existing = session.scalar(
            select(SourceAsset).where(
                SourceAsset.workspace_id == workspace.id,
                SourceAsset.conversation_id == row.id,
                SourceAsset.content_hash == content_hash,
                SourceAsset.filename == safe_name,
            )
        )
        if existing:
            return finish(
                session,
                workspace,
                idempotency_key,
                digest,
                SourceOut.model_validate(existing),
            )
        total = session.scalar(
            select(func.count())
            .select_from(SourceAsset)
            .where(SourceAsset.workspace_id == workspace.id)
        )
        count = session.scalar(
            select(func.count())
            .select_from(SourceAsset)
            .where(
                SourceAsset.workspace_id == workspace.id,
                SourceAsset.conversation_id == row.id,
            )
        )
        if total >= 100 or count >= 20:
            raise HTTPException(
                413,
                "Local source storage limit reached (20 files per conversation, 100 per workspace)",
            )
        extracted, error = extract_text(media_type, original, text)
        asset = SourceAsset(
            workspace_id=workspace.id,
            conversation_id=row.id,
            filename=safe_name,
            media_type=media_type,
            byte_size=len(original),
            content_hash=content_hash,
            original=original,
            state="failed" if error else "ready",
            error_code=error,
            extracted_text=extracted,
            text_hash=hashlib.sha256(extracted.encode()).hexdigest()
            if not error
            else None,
        )
        session.add(asset)
        session.flush()
        return finish(
            session, workspace, idempotency_key, digest, SourceOut.model_validate(asset)
        )

    @app.get("/api/v1/sources/{asset_id}", response_model=SourceText)
    def detail(asset_id: str, context=Depends(owner), session: Session = Depends(db)):
        asset = scoped_asset(session, context[1], asset_id)
        return SourceText(
            asset=SourceOut.model_validate(asset), text=asset.extracted_text
        )

    @app.get(
        "/api/v1/sources/{asset_id}/download",
        response_class=Response,
        responses={
            200: {
                "content": {
                    "application/octet-stream": {
                        "schema": {"type": "string", "format": "binary"}
                    }
                }
            }
        },
    )
    def download(asset_id: str, context=Depends(owner), session: Session = Depends(db)):
        asset = scoped_asset(session, context[1], asset_id)
        if asset.state != "ready":
            raise HTTPException(
                422, "This source failed validation; its original is quarantined"
            )
        return Response(
            asset.original,
            media_type="application/octet-stream",
            headers={
                "Content-Disposition": "attachment; filename*=UTF-8''"
                + quote(asset.filename, safe=""),
                "Content-Security-Policy": "default-src 'none'; sandbox",
                "Cache-Control": "no-store",
                "X-Content-Type-Options": "nosniff",
            },
        )
