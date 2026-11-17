"""Generate the API contract without opening a database or making network calls."""

import json
import sys
from pathlib import Path

root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root / "services/api"))
from app.main import app  # noqa: E402

(root / "packages/contracts/openapi.json").write_text(
    json.dumps(app.openapi(), indent=2), encoding="utf-8"
)
