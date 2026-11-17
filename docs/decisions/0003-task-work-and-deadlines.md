# ADR 0003: task work, progress and local deadlines

Accepted engineering defaults, 26 October 2026.

Migration 0002 adds tenant-owned steps, notes and deliverables with composite foreign keys to the task workspace. Reads and updates verify both tenant and parent task. Each write checks the parent task version, appends its complete before/after item snapshot to task history, and stores an idempotency receipt in the same transaction. There is no child delete endpoint; notes are append-only. Edits and checklist order are explicit UI actions.

Checklist-derived progress is recalculated transactionally and retained separately from manual percentage. Neither step completion nor deliverable readiness changes task status or marks a goal achieved. The displayed mode is explicit. Read failures after a successful commit do not reclassify that commit as a failed write. On an uncertain network response, retry retains the original payload/version/key; a browser test verifies one note and one event despite a lost committed response.

Calendar drag opens a review form and commits only on Save deadline. A keyboard task picker supports the same operation and includes undated tasks. Date/time controls use the workspace timezone even when the device differs. The server normalises to UTC. Rescheduling without an explicit time preserves the previous local wall-clock time; an undated task defaults to 17:00, visible before saving. Nonexistent DST times fail validation, and ambiguous times need a fold selection. Clearing dates is an explicit task edit.

`POST /workspace/resolve-deadline` validates and resolves a form's wall-clock date without changing records; task creation/editing then uses the resulting UTC instant in the standard atomic transaction. No client-supplied workspace/timezone can override owner scope.

Browser regressions run on ports 5174/8011 with a fresh SQLite test database, never the preview database. Network interception injects only the failure cases. Both SQLite and PostgreSQL run the API security/transaction/timezone suite. Current official references consulted:

- https://docs.python.org/3/library/zoneinfo.html
- https://playwright.dev/docs/test-webserver
- https://playwright.dev/docs/mock
