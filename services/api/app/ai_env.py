"""Read explicitly selected server AI settings without evaluating shell expressions."""

import os
from decimal import Decimal, InvalidOperation
from pathlib import Path

from .live_adapters import PROVIDERS


def ai_environment():
    allowed = {"WORKROOM_AI_DEFAULT_PROVIDER", "OPENROUTER_UPSTREAM"}
    for provider in PROVIDERS:
        allowed.update(
            provider.upper() + suffix
            for suffix in (
                "_API_KEY",
                "_MODEL",
                "_INPUT_USD_PER_MILLION",
                "_OUTPUT_USD_PER_MILLION",
            )
        )
    values = {}
    path = os.getenv("WORKROOM_AI_ENV", "")
    if path:
        for line in Path(path).read_text(encoding="utf-8-sig").splitlines():
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            name, separator, value = line.partition("=")
            name = name.strip()
            if name not in allowed:
                continue
            if not separator:
                raise RuntimeError("Invalid server AI environment assignment")
            value = value.strip()
            if value.startswith(("'", '"')):
                if len(value) < 2 or value[-1] != value[0]:
                    raise RuntimeError("Unclosed server AI environment value")
                value = value[1:-1]
            if value:
                values[name] = value
    # Explicit process settings take precedence; blank values keep prior configuration.
    values.update({name: os.environ[name] for name in allowed if os.getenv(name)})
    return values


def price_micro(value):
    try:
        micro = Decimal(value) * 1000000
        if not micro.is_finite() or micro <= 0 or micro != micro.to_integral_value():
            raise ValueError()
        return int(micro)
    except (InvalidOperation, ValueError, OverflowError):
        raise RuntimeError(
            "AI token rates must be positive USD per million with at most six decimals"
        ) from None
