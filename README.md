# AI Work Tracker · local foundation

A private task workspace built from [PRD v1.2](https://chatgpt.com/space/page_cf316b4bc7488191a10d370d065fcb0b) and the root engineering handoff. The local UI uses the working label **Workroom**.

Implemented: task creation/editing/status changes, checklists, deliverables, notes, blocker reasons, independent manual/checklist progress, Today, seven-column Kanban, day/week/month calendar with reviewed drag rescheduling, archive/restore, activity history, optimistic updates with rollback, version conflicts, idempotent writes and scoped private workspaces. **Capture** adds durable pasted requests/conversations, editable task proposals, explicit approval/rejection and source provenance. Task-scoped conversations also provide guidance and reviewed updates to existing tasks. Both support the local deterministic mock and server-configured OpenAI, Gemini, Mistral, Grok, OpenRouter and DeepSeek adapters. External processing requires per-request consent and daily limits. No real keys/models have been configured or live vendor accounts verified. This is a local M1 + bounded M2 slice, not the complete SaaS. No external beta has been published. Real local Keycloak sign-in, email verification/recovery and matching-email invitations are implemented. The optional manual-demo launcher still uses a labelled synthetic identity.

## Run with real local sign-in

Keycloak 26.8.1 and Mailpit run only on loopback. Accounts, passwords and verification/recovery messages stay on this computer. This is development sign-in, not an externally deployed beta.

After installing the dependencies below, run from the project root:

```powershell
python scripts/init_local_auth.py
docker compose -p altbrain-worktracker --profile auth up -d
powershell -ExecutionPolicy Bypass -File scripts/dev-auth-api.ps1
```

In another terminal run `npm run dev`, then open **http://127.0.0.1:5173/app/today** (use this exact origin). Only one API launcher should use port 8000. The auth launcher sets `LOCAL_IDENTITY=false`, applies additive migrations and never seeds or links real accounts to the demo workspace. It reads randomly generated, ignored `.local/auth/config.json`; do not commit or publish that file. Keycloak account data and the local inbox survive restarts in separate Docker volumes.

1. Choose **Sign in with Keycloak → Register**, enter your email and name.
2. Open [the local inbox](http://127.0.0.1:8025), follow the verification link, then set your password in Keycloak. With this local mail capture, placeholder emails work; a public deployment needs an inbox you control and a real mail service.
3. An operator issues a matching-email invitation:

   ```powershell
   python scripts/issue_invitation.py --email user1@altbrain.ai
   ```

   The command writes the private code to a new ignored `.local/invitations/*.txt` file and prints only its path. Paste that code into Workroom, choose your timezone and redeem it. Each invitation expires in 24 hours by default, is one-use and cannot grant access to another workspace. No signup automatically receives a workspace.
4. **Settings → Sign out** revokes the Workroom session immediately and continues to Keycloak's logout confirmation. **Forgot Password?** on the provider sign-in screen starts recovery through the local inbox. Workroom never receives passwords.

Browser credentials are opaque HttpOnly SameSite=Lax cookies; production sets Secure. Mutation requests require a same-origin CSRF token. Provider tokens are never stored by Workroom or returned to the SPA. Sessions expire at the verified ID-token expiry, capped at one hour (the supplied realm uses 15 minutes); sign in again when prompted. There is no refresh-token storage. Logout revokes the current app session; provider-side password resets/admin revocation on other devices may take until their app session expires. Immediate global/back-channel revocation and production hardening remain release work.

## Run the manual demo on Windows

From `D:\myprojects\Alt-Brain.ai` with Python 3.12, Node 22 and Docker Desktop running:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r services/api/requirements.txt
npm ci
docker compose -p altbrain-worktracker up -d
powershell -ExecutionPolicy Bypass -File scripts/dev-api.ps1
```

In a second terminal at the repository root:

```powershell
npm run dev
```

Open [the local app](http://127.0.0.1:5173). API health: [health](http://127.0.0.1:8000/api/health); contract and interactive docs: [OpenAPI UI](http://127.0.0.1:8000/docs). Development ports are web 5173, API 8000, PostgreSQL **55432**, Redis 6379. No unrelated service is stopped. The database volume survives container restarts; don't remove it to restart the app.

The launcher explicitly opts into local identity, migrates only this project's configured database, and seeds two synthetic isolated tenants idempotently. The UI uses Alex; Blair is a tenant-isolation fixture. API restarts invalidate the development session; reload the web app to reconnect. The launcher defaults to PostgreSQL. To run the optional offline SQLite mode, set `$env:DATABASE_URL='sqlite:///./.local/worktracker.db'` first. `.env.example` is a reference; the launcher sets local defaults and does not silently load an arbitrary .env.

## Floating Workroom AI

The **Ask Workroom** capsule stays at the top center of the viewport across Today, Board, Calendar and Capture. Hover or focus it for **Capture a task**, **Update progress** and a page-context shortcut. Click the capsule to resume the conversation without leaving your page. Capture opens a new capture; Update progress lets you choose a task and keeps that conversation scoped to it.

The overlay reuses saved conversations, paste/file intake and explicit proposal approvals. Minimize, close or Escape returns focus to the launcher and keeps the mounted draft and pending form state. Conversation history expands from its header; **Attach a file** reveals the existing bounded upload controls. **This page** shows a read-only snapshot from the currently loaded workspace tasks, not a generated AI answer. Desktop/phone layouts, native dialog focus containment and reduced motion are supported. The provider selector distinguishes the deterministic mock from configured external models.

The layout follows the supplied `README (2).md` visual concept; suggested checklist/deliverable generation shown in mockups is not implemented. Existing capture and task update review forms remain the authoritative approval interface.

## Try Capture

Open [Capture](http://127.0.0.1:5173/app/assistant), start a conversation and paste synthetic sample requests:

```text
Please prepare the workshop outline by Friday.
Review the assessment draft.
Plan the certification event.
```

Review the three proposals. Edit titles, descriptions, status, priority or an explicit workspace-time deadline; **Save edits** keeps a proposal pending, **Approve task** creates it once, and **Reject** creates no task. The Friday deadline is intentionally unset until you choose an exact time. Open an approved task to see its source evidence and link back to the saved conversation. The mock recognises simple action lines and can miss requests; no live model, keys or costs are involved.

Conversation drafts save automatically after a brief pause, or with **Save draft**. Draft recovery also keeps an owner/conversation-scoped browser backup; use a trusted browser for sensitive text. If another session changed the saved revision, review the recovered text and explicitly save/send it. **Retry saved action** replays an uncertain capture without making duplicate messages/proposals. Network failures and mock-provider failures preserve your input.

## Try the task assistant

Open a task and choose **Ask assistant**. Its conversation stays attached to that task, with the selected task and version visible. Try `How should I approach this task?` for read-only guidance, then `Mark this done` for a before/after proposal. **Approve changes** applies the reviewed fields to the existing task; **Reject** leaves it unchanged. Neither sending a request nor receiving guidance changes task state.

The mock supports status, priority, manual progress, blocker reasons and clearing deadlines. Ambiguous deadlines require an exact workspace-time choice in the review form. If someone edits the task while a proposal is pending, refresh the context and send a new request; stale proposals cannot overwrite their changes. Conversation history and drafts persist. The assistant does not yet edit checklist items or deliverables. External models use the same review boundary and require explicit consent.

## Try private file intake

In a regular Capture conversation, choose **Choose a source file → Upload privately**. This local slice accepts UTF-8 `.txt`, `.md` and single-body `text/plain` `.eml` files up to **256 KB**. Use [the synthetic sample](docs/fixtures/synthetic-file-intake.txt). Inspect **View extracted text**, then choose **Review file proposals**. Uploading and preparing proposals create no tasks; approve or reject each proposal explicitly. Approved task details retain the filename, evidence and saved conversation link.

Originals and extracted text are stored privately in this project's database, with no public object URLs. Downloads require the current owner's session and are served as attachments. The server checks actual streamed bytes, extension, MIME and UTF-8/control-byte content, and caches extraction by content hash/name within a conversation. Failed extraction remains visible and its original is quarantined from download. Retry uses the same saved request key. The typed composer draft stays separate.

Extracted text is limited to **20,000 characters**; split longer sources. Storage is limited to **20 files per conversation / 100 per workspace**. HTML/multipart email, embedded attachments, PDF, Word, images and OCR are not supported. This is an inert text-only development intake, not a general malware scanner. Files are retained locally; production storage encryption, retention/deletion and operational scanning are release gates. Originals stay local. Selecting an external model and consenting to review sends the extracted text to that provider.

## Configure AI providers

All six adapters are implemented. The current local `.env` has user-supplied keys and configured models/rates for all six, with the mock retained as default. No paid calls have been made or vendor accounts verified. See [configured models, rates and official sources](docs/ai-model-configuration.md). Keys belong only in server files, never chat, browser storage, `VITE_*` variables or source control. New installations start unconfigured.

The root **`.env`** now contains blank key, model and USD-per-million input/output rate fields for all six providers. Fill the providers you want, leaving the rest blank. Grok uses `GROK_API_KEY` for the xAI key; OpenRouter also requires `OPENROUTER_UPSTREAM`. Keep `WORKROOM_AI_DEFAULT_PROVIDER=mock` or choose a fully configured provider ID. Restart `scripts/dev-auth-api.ps1` after editing. This launcher explicitly selects the root file through `WORKROOM_AI_ENV`; arbitrary `.env` files are not auto-loaded by tests or other entrypoints. Only allowlisted AI settings are read, with no shell expansion. Process AI variables override nonempty `.env` values, which override JSON and separate key files; blanks preserve existing configuration. The file is ignored by source control. `.env.example` is a shareable blank reference.

The existing separate-key-file setup also remains available:

```powershell
python scripts/configure_ai.py
```

This idempotently creates ignored `.local/ai/config.json` and `.local/ai/keys/{provider}.txt` placeholders. Replace the placeholder in each provider's key file locally. Set that provider's exact compatible model ID and current input/output USD-per-million-token rates, either in the config or using the helper below (replace the illustrative variables with your provider's values):

```powershell
$modelId = 'YOUR_MODEL_ID'
$inputRate = 'YOUR_INPUT_USD_PER_MILLION'
$outputRate = 'YOUR_OUTPUT_USD_PER_MILLION'
python scripts/configure_ai.py --provider openai --model $modelId --input-usd-per-million $inputRate --output-usd-per-million $outputRate --make-default
```

Provider IDs: `openai`, `gemini`, `mistral`, `grok`, `openrouter`, `deepseek`. OpenRouter also needs `--upstream` with the approved upstream slug; routing fallback is disabled. Models must support the adapter's JSON format; see [the AI decision record](docs/decisions/0009-multi-provider-reviewed-ai.md). No model or rate is silently selected. The helper never prints or accepts keys as arguments.

Restart **only the Workroom API** with `scripts/dev-auth-api.ps1`; it loads this config if present and applies migration 0007. Refresh the app. Settings shows configuration readiness; the assistant lets you select a configured provider. Read the processing disclosure and check consent before each new request. A configured label does not prove vendor access; the first consented synthetic request verifies that account/model combination. Upload alone does not contact AI. Sending a task request can include its selected task, bounded notes/steps and recent chat; capture sends submitted or extracted text. Provider policies apply.

Defaults are **20 live attempts / $1 conservative reservations per workspace per UTC day**, shared across providers, 40,000 input bytes, 1,500 output tokens and a 30-second timeout. Configure the common `limits` object to change these. Reserved dollars retain the full estimate even after failures; they are not your invoice. Use provider-account spending caps too. No automatic network retry or provider fallback occurs. **Retry saved action** replays the same invocation/result without another call; an interrupted running call or changed task context produces a conflict. Check history before deliberately sending a new request, which may incur another charge.

OpenAI HTTP 429 may mean throttling or an account credit/spend/usage restriction. Workroom distinguishes recognized billing codes as **quota exhausted**, with billing/limits links. Older **rate limited** records lack the original subtype. Resolve account restrictions before a new request; waiting alone does not fix exhausted credits. A saved failed invocation stays failed on replay. After resolving the cause, submit a new request with fresh consent. See [OpenAI's error guide](https://developers.openai.com/api/docs/guides/error-codes).

Provider browser regressions use isolated **5176/8013** servers, synthetic HTTP responses and no working keys:

```powershell
npx playwright test --config playwright.ai.config.ts
```

## Verify

```powershell
python -m pytest -q
$env:TEST_DATABASE_URL='postgresql+psycopg://worktracker:local_only@127.0.0.1:55432/worktracker'
python -m pytest -q
Remove-Item Env:TEST_DATABASE_URL
python -m ruff check services scripts
npm run contracts
npm run build
```

PostgreSQL tests create and drop uniquely named test schemas; they do not overwrite the app's public schema or existing task data. Tests cover identity verification, foreign ID access, atomic rollback, immutable history, retry keys, conflicts, completion/reopen, archive/restore, invitation use/expiry and timezone validation. CI repeats SQLite and PostgreSQL suites and verifies generated contracts.

Browser regressions use a fresh disposable SQLite database and separate servers on **5174/8011**, so the preview database is untouched. With installed Chrome on Windows:

```powershell
$env:PW_CHANNEL='chrome'
npm run test:e2e
```

Alternatively install the test browser with `npx playwright install chromium`, leave `PW_CHANNEL` unset, then run `npm run test:e2e`. CI installs Chromium and runs the same suite. Coverage includes failed-drag rollback with no phantom activity, concurrent drafts and explicit reload, keyboard checklist interactions, persisted notes/deliverables/manual progress, reviewed calendar drag, device/workspace timezone differences, and exactly-once retries when the server committed but the response was lost. Browser-test servers stop on completion; their ignored fixture databases remain under `.local` for diagnosis.

All deadline forms display the **workspace timezone**. Rescheduling preserves the local time by default, and rejects nonexistent clock-change times; a duplicated time requires a first/second-occurrence choice. Clearing a deadline returns the task to undated work. Checklist progress never silently overwrites manual progress or marks a task complete.

## Layout and boundaries

- `apps/web`: React/TypeScript/Vite; generated OpenAPI types consumed by the API client.
- `services/api`: FastAPI, SQLAlchemy, Alembic `0001` for identity/membership/invites/tasks/events/receipts, `0002` for task work/progress, additive `0003` for capture history/runs/proposals, `0004` for fixed task conversations/reviewed updates, `0005` for private text originals and run provenance, `0006` for opaque sessions, one-use login transactions and auth attempt windows, and `0007` for AI invocations, shared daily usage and run attribution.
- `services/worker`: documented future boundary; no active jobs.
- `docs/decisions`: architecture and auth ADRs; `docs/progress.md` records observed checks.

The API never accepts a caller workspace ID for authority. Events and mutations are transactional; history rejects database updates/deletes. Every write needs a retry key. Task deletion is archive/restore.

Production must set `APP_ENV=production`, `LOCAL_IDENTITY=false`, OIDC issuer/audience/HTTPS JWKS, a restricted PostgreSQL role and approved hosting. It refuses development identity. The local Keycloak flow is verified, but production Keycloak/database/TLS/mail setup, restricted database roles, global revocation, operational review and deployment validation are still required; do not publish this development build as a secure external beta. Upcoming functionality and remaining release gates are in `docs/open-decisions.md`.

## Real-provider acceptance test

With local Keycloak/Mailpit running, run the opt-in fixture test:

```powershell
$env:PW_CHANNEL='chrome'
npx playwright test --config playwright.auth.config.ts
```

It uses a unique disposable Keycloak realm, fresh SQLite database and separate web/API ports **5175/8012**. It tests real registration, email verification, password setup, invitation redemption, a persisted task, app/provider logout and password recovery. The recorded test realm is removed at teardown; the main `workroom` realm and preview database are untouched. Ignored test artifacts and synthetic messages remain for diagnosis. Standard browser regressions continue to use the synthetic identity and ports 5174/8011; no provider or paid service is needed for them.
