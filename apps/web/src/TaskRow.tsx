import { ArrowUpRight, CalendarDays, Check, Circle, Flag } from "lucide-react";
import type { Task } from "./api";
import { labels, isActive, Status } from "./taskMeta";
import { localDay, dateLabel } from "./dates";
import { Button } from "./ui/Button";

export function TaskRow({
  task,
  zone,
  onOpen,
  onMove,
  pending,
}: {
  task: Task;
  zone: string;
  onOpen: (t: Task) => void;
  onMove: (t: Task, s: Status) => void;
  pending: boolean;
}) {
  const overdue =
    isActive(task) &&
    task.due_at &&
    localDay(task.due_at, zone) < localDay(new Date(), zone);
  return (
    <div className="task-row">
      <button
        className={`complete-button ${task.status === "completed" ? "checked" : ""}`}
        aria-label={
          task.status === "completed"
            ? `Reopen ${task.title}`
            : `Complete ${task.title}`
        }
        disabled={pending}
        onClick={() =>
          onMove(task, task.status === "completed" ? "planned" : "completed")
        }
      >
        {task.status === "completed" ? (
          <Check size={14} />
        ) : (
          <Circle size={19} />
        )}
      </button>
      <button className="task-row-main" onClick={() => onOpen(task)}>
        <strong>{task.title}</strong>
        <span>{task.category}</span>
        <span className="task-progress-label">
          {task.progress_mode === "manual"
            ? `${task.manual_progress}% · Manual`
            : `${task.step_progress}% · Checklist`}
        </span>
      </button>
      <span className={`status-pill ${task.status}`}>
        <span className={`status-dot ${task.status}`} />
        {labels[task.status]}
      </span>
      <span className={`priority-badge ${task.priority}`}>
        <Flag size={12} />
        {task.priority}
      </span>
      <span className={`row-date ${overdue ? "overdue" : ""}`}>
        <CalendarDays size={13} />
        {dateLabel(task.due_at, zone)}
      </span>
      <Button
        variant="icon"
        aria-label={`Open ${task.title}`}
        onClick={() => onOpen(task)}
      >
        <ArrowUpRight size={17} />
      </Button>
    </div>
  );
}
