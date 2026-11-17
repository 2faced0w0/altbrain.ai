# Workroom AI — Floating Island UI concepts

Four desktop mockups based on the application's existing screens (26 October 2026). These are visual explorations, not an implemented interface.

## Screens

| Image | Existing page | Floating AI state |
| --- | --- | --- |
| `01_Today_Collapsed_Launcher.png` | Today dashboard | Always-visible compact launcher, centered at top of viewport |
| `02_Board_Quick_Action_Island.png` | My board | Intermediate expanded island with context-aware shortcuts |
| `03_Calendar_Full_Chat_Overlay.png` | Calendar | Full conversational overlay; page remains visible in background |
| `04_Capture_Task_Approval_Overlay.png` | Capture / Assistant | Expanded chat with email attachment and human approval task card |

## Suggested interaction behavior

1. **Resting:** Persistent floating launcher positioned `fixed`, top-center of the browser viewport, above the application shell. It should not occupy layout space or shift the page.
2. **Peek / quick actions:** Hover or keyboard focus expands the capsule into the shortcut island (screen 02) without a click. Shortcuts can open the chat directly with a preselected intent.
3. **Full chat on click:** Clicking the compact launcher immediately morphs it into a floating conversation surface, keeping the current page and its context. Include input, paste, uploads, history, optional task references, and context-specific suggestions. Background remains visible with subtle dimming.
4. **Task proposals:** Creating, changing, rescheduling, or completing a task from AI remains a draft until the user approves. The proposal card clearly lists fields and differences.
5. **Dismiss and resume:** Minimize returns to the small launcher without losing drafts or chat state. Escape dismisses, focus returns to launcher; reopening restores the current workspace conversation and pending draft. Support keyboard focus trapping in the dialog and reduced-motion users.

## Design guidance for implementation

- Preserve Workroom's current typography, warm white/ivory backgrounds, pale sage sidebar, deep forest-green buttons and subtle rounded cards.
- Center relative to **viewport**, not content/sidebar, to maintain visual consistency across Today, Board, Calendar and Capture.
- Aim for ~130×40px compact, ~450×100px quick-action, and ~570–610px wide expanded chat on desktop. Cap chat height to `calc(100dvh - 24px)` and scroll only the conversation region.
- Animate **one anchored element** between states (scale/width/height/opacity), 180–260ms, easing out. Keep the page itself stationary.
- Handle tablets and mobile with a responsive width and safe-area insets; on narrow phones expand to a nearly full-width chat sheet while retaining a clear close control.
- AI can read only resources permitted in the current private workspace; switching models or triggering changes must keep the previously defined human approvals and context continuity.

## UX detail to refine in development

The fourth mockup illustrates proposed checklist steps with filled check icons, but these are **suggested** steps, not completed tasks. Use neutral unchecked step indicators in the actual UI until the user marks them done.
