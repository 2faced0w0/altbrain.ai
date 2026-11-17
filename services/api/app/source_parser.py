"""Small inert text allowlist. No archives, HTML rendering, external fetch or execution."""

import re
from email import policy
from email.parser import BytesParser
from fastapi import HTTPException

MAX_BYTES = 262144
MAX_TEXT = 20000
TYPES = {"txt": "text/plain", "md": "text/markdown", "eml": "message/rfc822"}


def validate_upload(filename, declared_type, data):
    # Keep a display name only, never a filesystem path or object key.
    filename = filename.replace("\\", "/").rsplit("/", 1)[-1]
    filename = re.sub(r"[^a-zA-Z0-9 ._()-]", "_", filename).strip(" .")
    ext = filename.rsplit(".", 1)[-1].lower()
    if not filename or ext not in TYPES:
        raise HTTPException(415, "Choose a UTF-8 .txt, .md or plain-text .eml file")
    declared = declared_type.split(";", 1)[0].strip().lower()
    if declared not in {TYPES[ext], "application/octet-stream", ""}:
        raise HTTPException(415, "The file type does not match its extension")
    if not data or len(data) > MAX_BYTES:
        raise HTTPException(413, "Choose a nonempty file no larger than 256 KB")
    if data.startswith(
        (b"%PDF", b"PK", b"MZ", b"\x89PNG", b"GIF8", b"\xff\xd8", b"\x1f\x8b")
    ):
        raise HTTPException(
            415, "Binary files are not supported in this text-only upload"
        )
    try:
        text = data.decode("utf-8-sig", errors="strict")
    except UnicodeError:
        raise HTTPException(415, "The file must contain UTF-8 text") from None
    if any(ord(c) < 32 and c not in "\r\n\t" for c in text):
        raise HTTPException(415, "Binary or control characters are not supported")
    return filename, TYPES[ext], text


def extract_text(media_type, data, text):
    if media_type == "message/rfc822":
        # Reject complex MIME before recursive parsing. This slice accepts only a
        # single text/plain body; attachments/HTML/multipart are never processed.
        try:
            message = BytesParser(policy=policy.default).parsebytes(
                data, headersonly=True
            )
            if message.defects or not any(
                message.get(h) for h in ("From", "Subject", "Date")
            ):
                return "", "invalid_email"
            if (
                message.get_content_type() != "text/plain"
                or message.get_content_disposition() == "attachment"
            ):
                return "", "unsupported_email_body"
            if message.get_content_charset() not in (None, "utf-8", "us-ascii"):
                return "", "unsupported_encoding"
            encoding = message.get("Content-Transfer-Encoding", "7bit").lower()
            if encoding not in ("7bit", "8bit", "base64", "quoted-printable"):
                return "", "unsupported_encoding"
            # headersonly leaves the payload inert; decode the single body only.
            body = message.get_payload(decode=True).decode(
                message.get_content_charset() or "utf-8", errors="strict"
            )
            if message.defects:
                return "", "invalid_email"
            if not body.strip():
                return "", "empty_text"
            headers = "\n".join(
                f"{h}: {message[h]}"
                for h in ("From", "To", "Date", "Subject")
                if message.get(h)
            )
            text = headers + "\n\n" + body
        except (UnicodeError, ValueError, TypeError, LookupError):
            return "", "invalid_email"
    if not text.strip():
        return "", "empty_text"
    if len(text) > MAX_TEXT:
        return "", "text_too_long"
    if any(ord(c) < 32 and c not in "\r\n\t" for c in text):
        return "", "invalid_text"
    return text, None
