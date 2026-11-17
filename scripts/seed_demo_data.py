"""Explicit, local-only synthetic data seed. Never operates in beta/production."""

import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root / "services/api"))
from sqlalchemy import select  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402
from app.main import app  # noqa: E402
from app.models import Membership, Task, TaskEvent, User, Workspace  # noqa: E402


def seed():
    if (
        app.state.settings.environment != "local"
        or not app.state.settings.local_identity
    ):
        raise RuntimeError("Seed requires APP_ENV=local and LOCAL_IDENTITY=true")
    with Session(app.state.engine) as db:
        for subject, name, email in [
            ("local:alex", "Alex Morgan", "alex@example.test"),
            ("local:blair", "Blair Taylor", "blair@example.test"),
        ]:
            if db.scalar(select(User).where(User.subject == subject)):
                continue
            user = User(subject=subject, name=name, email=email)
            db.add(user)
            db.flush()
            workspace = Workspace(
                owner_user_id=user.id, name=f"{name.split()[0]}'s workspace"
            )
            db.add(workspace)
            db.flush()
            db.add(Membership(workspace_id=workspace.id, user_id=user.id))
            rows = [
                (
                    "Prepare GenAI training decks",
                    "in_progress",
                    "high",
                    "Learning & development",
                    0,
                    "Shape the next training session around practical examples. Review the outline and refine the hands-on exercises.",
                ),
                (
                    "Review Java + SQL assessment",
                    "in_review",
                    "high",
                    "Assessments",
                    1,
                    "Review the insurance CRUD case study, solution approach, and test cases before sharing the final assessment.",
                ),
                (
                    "Plan November certification event",
                    "planned",
                    "medium",
                    "Events",
                    4,
                    "Outline the developer certification event, including the agenda, practice lab, and registration checklist.",
                ),
                (
                    "Collect feedback on the onboarding guide",
                    "waiting",
                    "medium",
                    "Operations",
                    2,
                    "Waiting for feedback from the reviewers before finalising the updated guide.",
                ),
                (
                    "Refresh the workshop resource library",
                    "inbox",
                    "low",
                    "Learning & development",
                    None,
                    "Bring together useful references and examples for the upcoming workshop.",
                ),
                (
                    "Confirm access to the training environment",
                    "blocked",
                    "urgent",
                    "Operations",
                    -1,
                    "Blocked by pending access approval. Follow up before the practice session.",
                ),
                (
                    "Publish October learning recap",
                    "completed",
                    "medium",
                    "Learning & development",
                    -2,
                    "Final recap is ready, reviewed, and published.",
                ),
                (
                    "Draft the next assessment rubric",
                    "inbox",
                    "medium",
                    "Assessments",
                    3,
                    "Define clear scoring criteria and include a few representative examples.",
                ),
            ]
            for title, status, priority, category, offset, description in rows:
                due = (
                    (
                        datetime.now(timezone.utc).replace(
                            hour=11, minute=30, second=0, microsecond=0
                        )
                        + timedelta(days=offset)
                    ).isoformat()
                    if offset is not None
                    else None
                )
                task = Task(
                    workspace_id=workspace.id,
                    title=title,
                    description=description,
                    status=status,
                    priority=priority,
                    category=category,
                    due_at=due,
                    completed_at=datetime.now(timezone.utc).isoformat()
                    if status == "completed"
                    else None,
                )
                db.add(task)
                db.flush()
                db.add(
                    TaskEvent(
                        workspace_id=workspace.id,
                        task_id=task.id,
                        actor_id=user.id,
                        event_type="task_created",
                        changes={
                            "title": {"before": None, "after": title},
                            "status": {"before": None, "after": status},
                        },
                    )
                )
        db.commit()
    print("Synthetic workspaces ready (seed is idempotent).")


if __name__ == "__main__":
    seed()
