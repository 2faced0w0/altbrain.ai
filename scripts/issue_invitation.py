"""Operator-only invitation issuance. Token goes to an ignored local file, not logs."""

import argparse
import hashlib
import os
import secrets
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import uuid4

root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root / "services/api"))
sys.path.insert(0, str(root / ".local/python-deps"))
from sqlalchemy import create_engine, select  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402
from app.models import Invite, User  # noqa: E402

parser = argparse.ArgumentParser(
    description="Issue a matching-email Workroom invitation using operator database access."
)
parser.add_argument("--email", required=True)
parser.add_argument("--hours", type=int, default=24)
args = parser.parse_args()
email = args.email.strip().lower()
if (
    not 1 <= args.hours <= 168
    or len(email) > 320
    or "@" not in email
    or any(c.isspace() for c in email)
):
    parser.error("Use a valid email and an expiry between 1 and 168 hours")
engine = create_engine(
    os.getenv(
        "DATABASE_URL",
        "postgresql+psycopg://worktracker:local_only@127.0.0.1:55432/worktracker",
    )
)
folder = root / ".local/invitations"
folder.mkdir(parents=True, exist_ok=True)
token = secrets.token_urlsafe(40)
expiry = (datetime.now(timezone.utc) + timedelta(hours=args.hours)).isoformat()
with Session(engine) as session:
    if session.scalar(select(User).where(User.email == email)):
        parser.error(
            "This email already belongs to an account; no new invitation was issued"
        )
    row = Invite(
        email=email,
        token_hash=hashlib.sha256(token.encode()).hexdigest(),
        expires_at=expiry,
    )
    session.add(row)
    session.commit()
path = folder / (str(uuid4()) + ".txt")
path.write_text(
    "Workroom invitation\nEmail: "
    + email
    + "\nExpires: "
    + expiry
    + "\nCode: "
    + token
    + "\n",
    encoding="utf-8",
)
print("Invitation created. Private code file: " + str(path))
