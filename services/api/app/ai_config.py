"""Server-only configuration. No secret is included in provider status."""

import re
from dataclasses import dataclass


@dataclass(frozen=True)
class AISettings:
    provider: str = "mock"
    model: str = ""
    api_key: str = ""
    max_requests: int = 20
    max_input_bytes: int = 40000
    max_output_tokens: int = 1500
    daily_micro_usd: int = 1000000
    input_micro_usd_per_million: int = 0
    output_micro_usd_per_million: int = 0
    timeout_seconds: int = 30
    upstream: str = ""

    def validate(self):
        numeric = (
            self.max_requests,
            self.max_input_bytes,
            self.max_output_tokens,
            self.daily_micro_usd,
            self.input_micro_usd_per_million,
            self.output_micro_usd_per_million,
            self.timeout_seconds,
        )
        if any(type(value) is not int for value in numeric):
            raise RuntimeError("AI limits and micro-dollar rates must be integers")
        if self.provider not in {
            "mock",
            "openai",
            "gemini",
            "mistral",
            "grok",
            "openrouter",
            "deepseek",
        }:
            raise RuntimeError("Unsupported AI provider")
        if self.model and (
            not re.fullmatch(r"[a-zA-Z0-9_.:/-]{1,100}", self.model)
            or ".." in self.model
            or self.model.startswith("/")
            or self.model.endswith("/")
        ):
            raise RuntimeError("Choose an explicit model ID")
        if (
            not 1 <= self.max_requests <= 1000
            or not 1000 <= self.max_input_bytes <= 60000
            or not 256 <= self.max_output_tokens <= 4000
            or not 5 <= self.timeout_seconds <= 60
        ):
            raise RuntimeError("AI request bounds are invalid")
        if (
            not 0 < self.daily_micro_usd <= 100000000
            or not 0 <= self.input_micro_usd_per_million <= 1000000000
            or not 0 <= self.output_micro_usd_per_million <= 1000000000
        ):
            raise RuntimeError(
                "Configure finite daily limits and model input/output rates"
            )

    @property
    def ready(self):
        return self.provider == "mock" or bool(
            self.model
            and self.api_key
            and not self.api_key.startswith("PASTE_")
            and self.input_micro_usd_per_million > 0
            and self.output_micro_usd_per_million > 0
            and (self.provider != "openrouter" or self.upstream)
        )
