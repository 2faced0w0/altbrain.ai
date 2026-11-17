# Floating Workroom AI workspace shell

Status: implemented locally, 26 October 2026.

The supplied README (2).md and four visual references call for a fixed viewport-centered assistant rather than navigating away from work. A single launcher shell expands on pointer hover or keyboard focus; click opens a native dialog at the same top-center anchor. Desktop dimensions are 190px compact, 490px shortcut island and 600px dialog. The dialog uses a subtle dim/blur backdrop, a forest-green header, warm ivory surfaces and compact review controls. Responsive safe-area sizing and reduced-motion rules preserve usability on phones.

Capture is a single lazily mounted instance outside the route content. Closing/minimizing hides it without unmounting drafts or pending proposal forms. Background navigation retains that instance. The explicit capture shortcut requests a new general conversation through the existing guarded capture mutation, while task selection loads the canonical fixed-scope task conversation. The conversation query is retained on the current route; ai=open supports restoring the overlay on refresh. Existing /app/assistant source links still open their saved conversation.

Native dialog modal behavior contains focus and makes the background inert. Escape, close and minimize restore focus to the launcher. The body scroll locks while the dialog is open; a stable scrollbar gutter prevents background movement. Inside the chat, conversation history scrolls independently of its composer. Attachment controls and the saved conversation list expand on demand.

This page snapshots are deterministic projections of the task records already loaded by the authenticated app. They are explicitly read-only, with no claims of generated reasoning or a provider connection. Snapshot task selection opens the existing task assistant; it cannot mutate tasks. Actual task changes continue through version-bound proposals and human approval. No new backend, database, provider, credential or publication behavior was introduced.

The mockup's generated checklist steps and deliverable are not represented as implemented functionality. The supported creation/update review forms, exact deadline resolution and source evidence stay intact. The scope remains a local deterministic preview.
