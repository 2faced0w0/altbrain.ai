"""A bounded, deterministic rule-based fixture, not a live language model."""

import re
from typing import Protocol


class CaptureProvider(Protocol):
    def extract(self, content: str) -> dict: ...


class MockFailure(RuntimeError):
    def __init__(self, code: str):
        self.code = code


class DeterministicProvider:
    def extract(self, content: str) -> dict:
        candidates = []
        seen = set()
        for line in re.split(r"\n|;\s+", content):
            quote = line.strip()
            if re.match(
                r"^(?:-+\s*(?:original|forwarded) message|on .+wrote:|best[,!]|regards[,!])",
                quote,
                re.I,
            ):
                break
            if quote.startswith(">") or re.match(
                r"^(from|to|subject|sent|cc):", quote, re.I
            ):
                continue
            clean = re.sub(r"^(?:[-*•]|\d+[.)])\s*", "", quote)
            clean = re.sub(
                r"^(?:please\s+|can you\s+|could you\s+)", "", clean, flags=re.I
            )
            if not re.match(
                r"^(prepare|review|plan|draft|create|update|write|check|organize|organise|schedule|finish|fix|build|collect|confirm|complete|send|submit)\b",
                clean,
                re.I,
            ):
                continue
            if clean.lower() in seen:
                continue
            seen.add(clean.lower())
            questions = []
            if re.search(
                r"\b(by|before|tomorrow|today|next|friday|monday|tuesday|wednesday|thursday|saturday|sunday)\b|\d{4}-\d{2}-\d{2}",
                clean,
                re.I,
            ):
                questions.append(
                    "Confirm the exact due date and time in your workspace timezone. No deadline has been set."
                )
            candidates.append(
                {
                    "title": clean[:200],
                    "description": clean[:10000],
                    "evidence": quote[:1000],
                    "questions": questions,
                }
            )
            if len(candidates) == 20:
                break
        return {"candidates": candidates}
