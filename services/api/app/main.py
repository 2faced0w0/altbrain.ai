import secrets
from contextlib import asynccontextmanager
from pathlib import Path

import jwt
from fastapi import FastAPI
from sqlalchemy import create_engine, event

from .auth import Settings
from .browser_auth import install_browser_auth
from .capture import install_capture
from .deps import fingerprint, make_db, make_owner, receipt, scoped_task
from .http_layer import install_http_layer
from .task_item_routes import install_task_item_routes
from .task_routes import install_reschedule_route, install_task_routes
from .workspace_routes import install_invitation_routes, install_workspace_routes


def build_engine(settings: Settings):
    if settings.database_url.startswith("sqlite"):
        Path(".local").mkdir(exist_ok=True)
    engine = create_engine(
        settings.database_url,
        connect_args={"check_same_thread": False}
        if settings.database_url.startswith("sqlite")
        else {"connect_timeout": 5},
        pool_pre_ping=True,
    )
    return engine


def create_app(settings: Settings | None = None, engine=None) -> FastAPI:
    settings = settings or Settings.load()
    settings.validate()
    if engine is None:
        engine = build_engine(settings)
    if engine.dialect.name == "sqlite":

        @event.listens_for(engine, "connect")
        def sqlite_foreign_keys(connection, _):
            connection.execute("PRAGMA foreign_keys=ON")

    @asynccontextmanager
    async def lifespan(app):
        # Schema is installed explicitly with Alembic; never create tables on startup.
        yield

    app = FastAPI(title="AI Work Tracker", version="0.1.0", lifespan=lifespan)
    app.state.settings = settings
    app.state.engine = engine
    app.state.local_token = secrets.token_urlsafe(48)
    app.state.jwks = (
        jwt.PyJWKClient(settings.oidc_jwks_url) if settings.oidc_jwks_url else None
    )

    install_http_layer(app)
    db = make_db(engine)
    owner = make_owner(db)
    # Registration order is part of the public API surface; keep it stable.
    install_workspace_routes(app, settings, db, owner)
    install_browser_auth(app, db)
    install_invitation_routes(app, db)
    install_task_routes(app, db, owner)
    install_task_item_routes(app, db, owner)
    install_reschedule_route(app, db, owner)
    install_capture(app, owner, db, fingerprint, receipt, scoped_task)
    return app


app = create_app()
