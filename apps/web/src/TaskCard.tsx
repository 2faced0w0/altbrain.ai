import { CalendarDays, Circle, Flag, MoreHorizontal } from "lucide-react";
import type { Task } from "./api";
import { isActive } from "./taskMeta";
import { localDay, dateLabel } from "./dates";

export function TaskCard({
  task,
  zone,
  onOpen,
}: {
  task: Task;
  zone: string;
  onOpen: (t: Task) => void;
}) {
  const overdue =
    isActive(task) &&
    task.due_at &&
    localDay(task.due_at, zone) < localDay(new Date(), zone);
  return (
    <button
      className="task-card"
      onClick={() => onOpen(task)}
      draggable
      onDragStart={(e) => e.dataTransfer.setData("text/plain", task.id)}
    >
      <div className="card-topline">
        <span
          className={`category-chip category-${task.category.startsWith("Learning") ? "learning" : task.category === "Assessments" ? "assessment" : "other"}`}
        >
          {task.category}
        </span>
        <MoreHorizontal size={15} />
      </div>
      <h3>{task.title}</h3>
      <p>{task.description || "Add a little context to this task."}</p>
      <span className="task-progress-label">
        {task.progress_mode === "manual"
          ? `${task.manual_progress}% · Manual`
          : `${task.step_progress}% · Checklist`}
      </span>
      <div className="card-meta">
        <span className={`priority-badge ${task.priority}`}>
          <Flag size={12} />
          {task.priority}
        </span>
        <span className={overdue ? "overdue" : ""}>
          <CalendarDays size={12} />
          {dateLabel(task.due_at, zone)}
        </span>
      </div>
      <div className="card-bottom">
        <span>
          <Circle size={12} />
          Saved task
        </span>
        <span className="mini-avatar" title="Private workspace task">
          <Circle size={12} />
        </span>
      </div>
    </button>
  );
}
