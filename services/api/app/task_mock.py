"""Bounded deterministic task assistant; never writes state or chooses resource IDs."""

import re
from typing import Protocol


class TaskAssistantProvider(Protocol):
    def respond(self, request: str, context: dict) -> dict: ...


class DeterministicTaskAssistant:
    def respond(self, request: str, context: dict) -> dict:
        text = request.strip().lower()
        task = context["task"]
        guidance = bool(
            re.match(r"^(how|what|why|help|suggest|can you help|give me)\b", text)
        )
        changes, questions = {}, []
        if not guidance:
            if re.search(
                r"\bmark (?:this|it|the task)(?: task)? (?:as )?(?:done|complete|completed)\b|^complete (?:this|the) task\b",
                text,
            ):
                changes["status"] = "completed"
            elif re.search(r"\breopen (?:this|the) task\b", text):
                changes["status"] = "planned"
            status = re.search(
                r"\b(?:set|change|move) (?:the )?(?:status|task)(?: to)? (in progress|in review|inbox|planned|waiting|blocked|completed|cancelled)\b",
                text,
            )
            if status:
                changes["status"] = status[1].replace(" ", "_")
            priority = re.search(
                r"\b(?:set|change) (?:the )?priority(?: to)? (low|medium|high|urgent)\b",
                text,
            )
            if priority:
                changes["priority"] = priority[1]
            progress = re.search(
                r"\b(?:set|update) (?:the )?progress(?: to)? (100|[1-9]?\d)\s*%", text
            )
            if progress:
                changes.update(progress_mode="manual", manual_progress=int(progress[1]))
            reason = re.search(r"\b(?:blocked|waiting) because (.+)", request, re.I)
            if reason:
                changes.update(
                    status="blocked" if "blocked because" in text else "waiting",
                    blocker_reason=reason[1][:2000],
                )
            if re.search(r"\b(?:clear|remove) (?:the )?(?:deadline|due date)\b", text):
                changes["due_at"] = None
            elif re.search(
                r"\b(?:move|set|change|reschedule).*(?:deadline|due|friday|monday|tomorrow|\d{4}-\d{2}-\d{2})",
                text,
            ):
                questions.append(
                    "Choose an exact due date and time in your workspace timezone, or explicitly leave the deadline unchanged. No date has been inferred."
                )
        changes = {
            key: value for key, value in changes.items() if task.get(key) != value
        }
        if changes or questions:
            return {
                "kind": "update",
                "reply": "I have prepared a proposed update for the selected task. Nothing has changed yet; review the before/after fields and approve or reject it.",
                "changes": changes,
                "questions": questions,
                "evidence": request[:1000],
            }
        next_step = next(
            (row["text"] for row in context["steps"] if not row["checked"]), None
        )
        reply = f"Mock guidance for “{task['title']}”: current status is {task['status'].replace('_', ' ')}. "
        if task.get("blocker_reason"):
            reply += f"The recorded blocker is: {task['blocker_reason'][:500]}. "
        if next_step:
            reply += f"The next unchecked step is “{next_step}”. "
        else:
            reply += "Define one concrete next step and the deliverable that will show it is finished. "
        reply += "This is deterministic guidance, not a live model response. Supported changes include ‘mark this done’, ‘set priority high’, ‘set progress 60%’, and ‘move deadline to Friday’ (requires an exact date). Guidance never changes the task."
        return {
            "kind": "guidance",
            "reply": reply[:5000],
            "changes": {},
            "questions": [],
            "evidence": "",
        }
