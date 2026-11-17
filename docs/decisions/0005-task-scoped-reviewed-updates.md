# Task-scoped guidance and reviewed updates

Status: implemented locally, 26 October 2026.

A task has one canonical durable assistant conversation. Additive migration 0004 creates context links and update proposals without altering existing tracker or capture tables. Composite foreign keys preserve workspace, conversation, task and run relationships; clients cannot choose resource IDs inside a proposed update.

Each request receives the selected task, at most 20 steps, five notes and six recent messages from that conversation. Descriptions, notes and messages are clipped to bounded lengths. This is selected-task context, not general workspace retrieval. The selected task stays visible in the UI and cannot be switched inside the conversation.

Guidance is read-only. The deterministic mock validates output shape and literal source evidence, and cannot perform mutations. Update requests create editable before/after proposals bound to the task version at preparation. Unsupported language receives honest supported examples; checklist and deliverable edits remain manual.

Approval requires explicit review and typed task changes. A stale or archived task prevents approval; the server never silently rebases a proposal. Task version comparison, changes, immutable activity, proposal review and retry receipt commit together. Exact retries return the original result; conflicting reviewed intent is rejected. Concurrent approvals cannot create duplicate task events. Rejection has no task effects.

Uncertain deadlines stay unset until the user chooses an exact workspace-local time, including an explicit occurrence for ambiguous daylight-saving times. Completion and reopening retain tracker timestamp semantics.

A real provider, streaming, full context manifests/checkpoints, secure file intake and model continuity remain future work. No keys, external processing or paid model calls were introduced.
