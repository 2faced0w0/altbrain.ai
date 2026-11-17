# Local AI model configuration

Configured 27 October 2026 after the user supplied keys in the ignored root `.env`. All six pass configuration readiness. No keys are copied into this document, test fixtures or logs. No live model call has been made; account access, credits and actual response quality are not yet verified. The default remains `mock`; selecting an external provider still requires per-request consent.

Standard text rates in USD per million tokens, checked against official sources:

| Provider | Configured model | Input | Output | Reference |
| --- | --- | ---: | ---: | --- |
| OpenAI | `gpt-5.4-mini-2026-03-17` | 0.75 | 4.50 | [Official model](https://developers.openai.com/api/docs/models/gpt-5.4-mini) |
| Gemini | `gemini-2.5-flash-lite` | 0.10 | 0.40 | [Standard pricing](https://ai.google.dev/gemini-api/docs/pricing#gemini-2.5-flash-lite) |
| Mistral | `mistral-small-2603` | 0.15 | 0.60 | [Official model](https://docs.mistral.ai/models/mistral-small-4-0-26-03) |
| Grok | `grok-4.20-0309-non-reasoning` | 1.25 | 2.50 | [Official pricing](https://docs.x.ai/developers/pricing) |
| OpenRouter | `openai/gpt-5.4-mini` | 0.75 | 4.50 | [Live public endpoint catalog](https://openrouter.ai/api/v1/models/openai/gpt-5.4-mini/endpoints) |
| DeepSeek | `deepseek-flash` | 0.30 | 1.20 | [Official pricing](https://api-docs.deepseek.com/quick_start/pricing/) |

OpenRouter is restricted to upstream `openai`, with fallback disabled, deny-data-collection routing and the configured price caps. Higher-priced priority routes are excluded by those caps. The OpenRouter model ID is its catalog alias; the direct OpenAI ID pins the documented snapshot. Cached, batch, free-tier and promotional discounts are not assumed for budget reservations. DeepSeek uses peak cache-miss rates conservatively even when the actual request qualifies for off-peak/caching. The Grok context stays below its 200k long-context pricing threshold under the current 40,000-byte input limit. Prices can change; recheck these references before adjusting models or usage limits.

The existing daily limits remain 20 external attempts and $1 in conservative reservations per workspace per UTC day. This is not a reconciled vendor bill. Keys are server-side. Per-request consent and reviewed task changes remain mandatory. No automatic provider/model fallback was enabled.

The selected DeepSeek Flash API defaults to thinking enabled; its request now explicitly uses `thinking.type=disabled`. Mistral Small 4 requests use `reasoning_effort=none`. These settings keep the small output cap available for structured task JSON. See [DeepSeek thinking controls](https://api-docs.deepseek.com/guides/thinking_mode/) and [Mistral reasoning](https://docs.mistral.ai/studio/conversations/reasoning). GPT-5.4 Mini documents `none` as its default reasoning effort. Broader reasoning configuration remains future work.

After changing `.env`, restart `scripts/dev-auth-api.ps1` and refresh Workroom. Choose a provider in the assistant and consent before sending a synthetic request. Readiness alone does not verify credentials or billing access.
