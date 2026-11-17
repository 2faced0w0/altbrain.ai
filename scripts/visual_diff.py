"""Compare two visual snapshot sets: python scripts/visual_diff.py before after [threshold%].

Reads .local/visual/<label>/*.png, prints per-image changed-pixel percentages and
writes red-highlight diff images to .local/visual/diff-<after>-vs-<before>/.
"""

import sys
from pathlib import Path

from PIL import Image, ImageChops

ROOT = Path(__file__).resolve().parents[1] / ".local" / "visual"
PER_CHANNEL = 24  # ignore anti-aliasing noise below this per-channel delta


def changed_fraction(a: Image.Image, b: Image.Image):
    width, height = min(a.width, b.width), min(a.height, b.height)
    a, b = a.crop((0, 0, width, height)), b.crop((0, 0, width, height))
    diff = ImageChops.difference(a, b)
    mask = diff.convert("L").point(lambda v: 255 if v > PER_CHANNEL else 0)
    changed = mask.histogram()[255]
    overlay = a.copy()
    overlay.paste((255, 0, 60), mask=mask)
    return changed / (width * height), overlay


def main():
    if len(sys.argv) < 3:
        raise SystemExit(__doc__)
    before, after = sys.argv[1], sys.argv[2]
    limit = float(sys.argv[3]) if len(sys.argv) > 3 else 2.0
    out = ROOT / f"diff-{after}-vs-{before}"
    out.mkdir(parents=True, exist_ok=True)
    names = sorted(p.name for p in (ROOT / before).glob("*.png"))
    if not names:
        raise SystemExit(f"No snapshots in {ROOT / before}")
    worst = 0.0
    print(f"{'image':34} {'changed %':>9}  note")
    for name in names:
        other = ROOT / after / name
        if not other.exists():
            print(f"{name:34} {'-':>9}  missing in '{after}'")
            continue
        a = Image.open(ROOT / before / name).convert("RGB")
        b = Image.open(other).convert("RGB")
        fraction, overlay = changed_fraction(a, b)
        overlay.save(out / name)
        note = "" if a.size == b.size else f"size {a.size} -> {b.size}"
        worst = max(worst, fraction * 100)
        flag = "  <-- above limit" if fraction * 100 > limit else ""
        print(f"{name:34} {fraction * 100:9.2f}  {note}{flag}")
    print(f"\nworst: {worst:.2f}%  (limit {limit}%)  diff images: {out}")


if __name__ == "__main__":
    main()
