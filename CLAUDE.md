# CLAUDE.md

Engineering conventions, scope limits and security rules live in [AGENTS.md](AGENTS.md). Read it first; it is the source of truth. Product requirements are in `AI_Work_Tracker_Codex_Build_Handoff.md` and `docs/`.

## Stack

- `apps/web`: React 19, TypeScript, Vite
- `services/api`: FastAPI, SQLAlchemy, Alembic
- `packages/contracts`: OpenAPI contract that generates `apps/web/src/schema.d.ts`
- Tests: pytest for the API, Playwright for e2e
- Local services: `compose.yaml`; local auth via Keycloak and Mailpit

## Commands

Run from the repo root.

```bash
npm run dev          # web dev server on 127.0.0.1:5173
npm run typecheck    # tsc --noEmit
npm run build        # typecheck + vite build
npm run contracts    # regenerate OpenAPI contract and TS types
npm run format       # prettier on web sources
npm run test:e2e     # Playwright
python -m pytest -q  # API tests (testpaths: services/api/tests)
python -m ruff check services scripts
```

API dev servers: `scripts/dev-api.ps1` (development identity, loopback only) and `scripts/dev-auth-api.ps1` (local Keycloak auth).

## Before finishing a change

1. Run focused tests, `npm run typecheck` and `npm run build`; run `ruff` if Python changed.
2. Update `docs/progress.md` and `docs/open-decisions.md`.
3. If API schemas changed, run `npm run contracts`.

## Guardrails (summary; see AGENTS.md)

- Never commit `.env`, `.local/auth` credentials or raw invitation codes.
- No keys in browser code; no paid AI calls in tests; no real workplace documents as fixtures.
- Scope every owned query to the verified server-side workspace.
- Task changes, events and idempotency receipts commit atomically.
- Implement one documented milestone at a time and preserve unrelated work.
