# Design tokens

`apps/web/src/tokens.css` is the single source of color and elevation values. It is imported first in `main.tsx`, so every other stylesheet can use `var(--token)`.

## Rules

1. **No color literals outside `tokens.css`.** Use a token; add one there if a genuinely new role is needed. Check with `grep -nE "#[0-9a-fA-F]{3,8}\b" apps/web/src/*.css` (only `tokens.css` should match).
2. **Pick tokens by role, not by appearance.** Backgrounds use `--surface-*`, `--accent*` and `--signal-*`; borders use `--line*`; text uses `--text*`; shadows and overlays use `--shadow-*`, `--scrim` and `--glow-ok`.
3. **Text tokens are contrast-safe.** Every `--text*` value is at least 4.5:1 on `--surface`, `--surface-page`, `--surface-tint` and `--surface-sage`, and each status text token is at least 4.5:1 on its own status surface. Do not use `--accent-soft`, `--accent-light` or `--signal-*` for text.
4. **Focus uses `--focus-ring`** (`#546e3f`, at least 4.5:1 on every surface; WCAG 1.4.11 needs 3:1).
5. **Native controls** (progress, checkbox) take `--accent-control`. Chrome derives the track from `accent-color`, and a lighter value flips the track dark.

## Roles

| Group | Tokens |
|---|---|
| Surfaces | `--surface`, `--surface-page`, `--surface-tint`, `--surface-sage`, `--surface-sage-strong` |
| Status surfaces | `--surface-danger`, `--surface-warning`, `--surface-warning-strong`, `--surface-info`, `--surface-waiting` |
| Accents | `--accent`, `--accent-strong`, `--accent-soft`, `--accent-light`, `--accent-control`, `--ink`, `--sage-300` |
| Status dots | `--signal-warning`, `--signal-waiting`, `--signal-danger`, `--signal-info` |
| Lines | `--line`, `--line-sage`, `--line-strong`, `--line-warm`, `--line-danger`, `--line-accent`, `--line-accent-strong`, `--line-warning` |
| Text | `--text`, `--text-muted`, `--text-accent`, `--text-accent-strong`, `--text-on-accent`, `--text-danger`, `--text-warning`, `--text-info`, `--text-waiting` |
| Elevation | `--shadow-faint`, `--shadow-xs`, `--shadow-soft`, `--shadow-md`, `--shadow-lg`, `--shadow-xl`, `--shadow-up`, `--shadow-launcher`, `--glow-ok`, `--scrim`, `--overlay-light` |

## How the tokens were derived

363 distinct hex values (422 uses) were grouped by role and snapped to the nearest token. Backgrounds and borders barely moved (47 near-identical backgrounds became `--surface-tint`, 48 near-identical borders became `--line`). Text was reassigned by hue and lightness so that low-contrast greens became `--text-muted`, which is the intentional accessibility change.

## Verifying a change

- `VISUAL_LABEL=before npm run test:visual`, make the change, `VISUAL_LABEL=after npm run test:visual`, then `python scripts/visual_diff.py before after`. Snapshots live in the git-ignored `.local/visual/`.
- Before the token work, 19 to 66 text elements per page failed WCAG AA contrast (31 of 90 on Today). After it, 0 do on Today, Board, Calendar and Settings.
