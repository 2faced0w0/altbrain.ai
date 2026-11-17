"""Dedicated browser-test API. Never opens the preview or production database."""

import os
import sys
from pathlib import Path
from uuid import uuid4

root = Path(__file__).resolve().parents[1]
local = root / ".local"
local.mkdir(exist_ok=True)
os.environ.update(
    APP_ENV="test",
    LOCAL_IDENTITY="true",
    DATABASE_URL=f"sqlite:///{local / ('browser-' + uuid4().hex + '.db')}",
)
sys.path.insert(0, str(root / "services/api"))
from alembic import command  # noqa: E402
from alembic.config import Config  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402
from app.main import app  # noqa: E402
from app.models import User, Workspace, Membership  # noqa: E402
import uvicorn  # noqa: E402

command.upgrade(Config(str(root / "services/api/alembic.ini")), "head")
with Session(app.state.engine) as db:
    user = User(subject="local:alex", email="alex@example.test", name="Alex Morgan")
    db.add(user)
    db.flush()
    workspace = Workspace(owner_user_id=user.id, name="Browser test workspace")
    db.add(workspace)
    db.flush()
    db.add(Membership(workspace_id=workspace.id, user_id=user.id))
    db.commit()
uvicorn.run(app, host="127.0.0.1", port=8011)
