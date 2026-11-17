"""Prepare server-only AI configuration; never print, accept or fetch keys."""

import argparse
import json
from decimal import Decimal, InvalidOperation
from pathlib import Path

PROVIDERS = ("openai", "gemini", "mistral", "grok", "openrouter", "deepseek")
root = Path(__file__).resolve().parents[1]
folder = root / ".local/ai"
keys = folder / "keys"
keys.mkdir(parents=True, exist_ok=True)
path = folder / "config.json"
parser = argparse.ArgumentParser(
    description="Prepare provider key files, model IDs, prices and limits without making any network calls."
)
parser.add_argument("--provider", choices=PROVIDERS)
parser.add_argument("--model")
parser.add_argument("--input-usd-per-million")
parser.add_argument("--output-usd-per-million")
parser.add_argument("--upstream", help="Explicit OpenRouter upstream slug")
parser.add_argument("--make-default", action="store_true")
args = parser.parse_args()
if path.exists():
    data = json.loads(path.read_text(encoding="utf-8"))
else:
    data = {
        "default_provider": "mock",
        "limits": {
            "max_requests": 20,
            "max_input_bytes": 40000,
            "max_output_tokens": 1500,
            "daily_micro_usd": 1000000,
            "timeout_seconds": 30,
        },
        "providers": {},
    }
for provider in PROVIDERS:
    key_path = keys / (provider + ".txt")
    if not key_path.exists():
        key_path.write_text("PASTE_YOUR_PROVIDER_API_KEY_HERE\n", encoding="utf-8")
    data["providers"].setdefault(
        provider,
        {
            "model": "",
            "api_key_file": "keys/" + provider + ".txt",
            "input_micro_usd_per_million": 0,
            "output_micro_usd_per_million": 0,
            **({"upstream": ""} if provider == "openrouter" else {}),
        },
    )
if args.provider:
    config = data["providers"][args.provider]
    if args.model:
        config["model"] = args.model
    for value, field in [
        (args.input_usd_per_million, "input_micro_usd_per_million"),
        (args.output_usd_per_million, "output_micro_usd_per_million"),
    ]:
        if value is not None:
            try:
                micro = Decimal(value) * 1000000
            except InvalidOperation:
                parser.error("Use a positive USD price per million tokens")
            if (
                not micro.is_finite()
                or micro <= 0
                or micro != micro.to_integral_value()
            ):
                parser.error("Use a positive price with at most six decimals")
            config[field] = int(micro)
    if args.upstream:
        if args.provider != "openrouter":
            parser.error("Only OpenRouter uses an upstream route")
        config["upstream"] = args.upstream
    if args.make_default:
        data["default_provider"] = args.provider
elif any(
    [
        args.model,
        args.input_usd_per_million,
        args.output_usd_per_million,
        args.upstream,
        args.make_default,
    ]
):
    parser.error("Choose --provider when changing a model or default")
path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
print("Server AI configuration: " + str(path))
print("Private key files: " + str(keys))
print(
    "No keys were read or displayed; no provider requests were made. Restart the local API after configuring a model, rates and key."
)
