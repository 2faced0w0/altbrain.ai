"""Resolve a wall-clock deadline without silently normalising DST gaps or folds."""

from datetime import datetime, time, timezone
from zoneinfo import ZoneInfo
from fastapi import HTTPException


def rescheduled_due(body, current_due: str | None, zone_name: str) -> str:
    zone = ZoneInfo(zone_name)
    wall = body.local_time
    if wall is None:
        wall = (
            datetime.fromisoformat(current_due)
            .astimezone(zone)
            .time()
            .replace(tzinfo=None)
            if current_due
            else time(17)
        )
    naive = datetime.combine(body.local_date, wall)
    candidates = {}
    for fold in (0, 1):
        candidate = naive.replace(tzinfo=zone, fold=fold)
        utc = candidate.astimezone(timezone.utc)
        if utc.astimezone(zone).replace(tzinfo=None) == naive:
            candidates[fold] = utc
    if not candidates:
        raise HTTPException(
            422,
            "That local time does not exist because the clocks change. Choose another time.",
        )
    if len(set(candidates.values())) > 1 and body.fold is None:
        raise HTTPException(
            422, "That local time occurs twice. Choose the first or second occurrence."
        )
    return candidates[body.fold or 0].isoformat()
