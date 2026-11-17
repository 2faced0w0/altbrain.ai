# AI Work Tracker engineering conventions

Use the root handoff and linked PRD for product requirements. Implement one documented milestone at a time. Preserve unrelated work and local services. This repository includes local M1, M2 paste/proposal/approval and task-scoped reviewed updates, six server-configured AI adapters, bounded private text-file intake and local Keycloak browser authentication; do not imply the whole beta exists or real provider accounts have been verified.

- React/TypeScript/Vite in apps/web; FastAPI/SQLAlchemy/Alembic in services/api.
- Derive workspace identity from verified server-side identity and membership; every owned query is scoped.
- Task changes, immutable events and idempotency receipts commit atomically. Retain optimistic version checks.
- Development identity is explicit and loopback only; beta/production must reject it.
- Do not publish, provision paid resources or use real workplace documents as test fixtures.
- Update docs/progress.md and docs/open-decisions.md; run focused tests, typecheck and build.
- Live AI supports six user-selected providers behind server configuration, per-request external consent, shared daily limits and reviewed proposals. Never put keys in browser code or make paid calls as tests. BYOK UI, model continuity, goals, reminders and reports remain future milestones.

- Local real-auth uses Keycloak/Mailpit on loopback and dev-auth-api.ps1. Keep the original synthetic users/workspaces separate. Never commit .local/auth credentials or raw invitation codes. Provider tokens must not reach browser storage; cookie writes require same-origin CSRF. Do not enable the Keycloak development profile as production configuration.
