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

## Type, spacing and radius

Use these instead of raw `px` for `font-size`, `padding`, `margin`, `gap` and `border-radius` (hairlines of 1 to 3px and fixed layout sizes stay literal). Check with `grep -nE "(font-size|padding|margin|gap|radius):.*[0-9]px" apps/web/src/*.css`.

| Scale | Tokens |
|---|---|
| Type | `--fs-xs` 11px (labels, pills, captions), `--fs-sm` 12px (secondary text), `--fs-md` 13px, `--fs-base` 14px (body), `--fs-lg` 16px, `--fs-xl` 20px, `--fs-2xl` 24px, `--fs-3xl` 28px, `--fs-4xl` 36px |
| Spacing | `--space-1` 4px, `-2` 6px, `-3` 8px, `-4` 10px, `-5` 12px, `-6` 16px, `-7` 20px, `-8` 24px, `-9` 32px, `-10` 40px, `-11` 48px |
| Radius | `--radius-xs` 4px, `--radius-sm` 6px, `--radius-md` 8px, `--radius-lg` 12px, `--radius-xl` 16px, and `50%` for circles |

The old UI used 6 to 13px for nearly all text (190 of 270 declarations were 6 to 11px). Everything up to 10px now maps to 11px, and 11, 12 and 13px each moved up one step. Spacing values snapped to the nearest scale step (almost always within 1px); radii of 18px and above and the few fixed layout widths were left literal.

## Shared components

`apps/web/src/ui/` holds the shared components. Use them instead of writing the class names by hand:

| Component | Renders | Notes |
|---|---|---|
| `Button` | `<button class="primary-button|secondary-button|icon-button">` | `variant="primary" \| "secondary" \| "icon"`; sets no default `type`, so form behavior is unchanged |
| `Field` | `<label class="form-field">` | wraps the label text and its control, so the control is named by the label |
| `Banner` | `<div\|p class="error-banner" role="alert">` | pass `as="p"` for a paragraph, or `role` to override |
| `EmptyState` | `<div\|section class="empty-state">` | |

They render exactly the markup the class-based version did, so tests and CSS selectors are unaffected. Not yet components (planned with the page redesigns): pills and badges, cards, segmented tabs, toast and navigation links. The sidebar navigation stays buttons for now because the e2e tests look it up by role.

## How the tokens were derived

363 distinct hex values (422 uses) were grouped by role and snapped to the nearest token. Backgrounds and borders barely moved (47 near-identical backgrounds became `--surface-tint`, 48 near-identical borders became `--line`). Text was reassigned by hue and lightness so that low-contrast greens became `--text-muted`, which is the intentional accessibility change.

## Verifying a change

- `VISUAL_LABEL=before npm run test:visual`, make the change, `VISUAL_LABEL=after npm run test:visual`, then `python scripts/visual_diff.py before after`. Snapshots live in the git-ignored `.local/visual/`.
- Before the token work, 19 to 66 text elements per page failed WCAG AA contrast (31 of 90 on Today). After it, 0 do on Today, Board, Calendar and Settings.
