# ADR 0001: local foundation and delivery sequence

Accepted engineering defaults, 25 October 2026.

Implement M0 and core M1 first: private workspaces, manual tasks, append-only events, Today and Board. A small derived calendar is included; steps, notes and deliverables remain later M1 work.

Use React 19 / TypeScript / Vite with a FastAPI modular monolith. PostgreSQL 17 is the primary development and intended beta database. Alembic revision 0001 is explicit and independent of live model metadata. SQLite is an optional local/test fallback only. Timestamps are normalised ISO UTC strings in this first schema; migrate to native timestamptz before beta/report scale, with explicit conversion and coverage.

SQLAlchemy version columns perform optimistic compare-and-swap. Every task effect, append-only event and hashed-request replay receipt shares a transaction. Events have database update/delete rejection triggers. Archive is reversible; no hard-delete task endpoint exists. Race losers roll back and may retry the same key for the committed receipt.

OpenAPI is generated from response/request schemas. openapi-typescript generates the consumed frontend types; openapi-fetch checks paths and payloads. Regenerate with npm run contracts.

Redis is available for future RQ workers; there is no active worker yet. Private object storage is not provisioned because this milestone accepts no files. No paid AI, cloud deployment or third-party office-data processing is enabled.

Primary documentation consulted 25 October 2026:
- https://docs.sqlalchemy.org/en/20/orm/versioning.html
- https://fastapi.tiangolo.com/tutorial/security/oauth2-jwt/
- https://vite.dev/guide/

Dependencies are pinned to compatible explicit versions, with an npm lockfile. Existing local Python versions were used to verify this slice; use an isolated virtualenv for a fresh install. Dependency vulnerability review and supported versions are required before beta.
