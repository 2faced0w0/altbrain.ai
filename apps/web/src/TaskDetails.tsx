import { useEffect, useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  Archive,
  CalendarDays,
  Check,
  Flag,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import * as api from "./api";
import type { Activity, Task } from "./api";
import { labels, Status } from "./taskMeta";
import { dateLabel, timeLabel } from "./dates";
import { Modal } from "./Modal";
import { TaskWork } from "./TaskWork";
import { TaskSchedule } from "./TaskSchedule";
import { Banner } from "./ui/Banner";
import { Button } from "./ui/Button";
import { Field } from "./ui/Field";

function eventValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "object") {
    const item = value as Record<string, unknown>;
    if (item.message_id)
      return `${item.kind === "task_assistance" || item.provider === "deterministic-task-mock" ? "Approved task request" : "Approved capture"} · source ${String(item.message_id).slice(0, 8)}`;
    return `${item.text || item.description || item.content || ""}${"checked" in item ? (item.checked ? " · checked" : " · unchecked") : item.state ? ` · ${item.state}` : ""}`.slice(
      0,
      240,
    );
  }
  return String(value).slice(0, 240);
}

export function TaskDetails({
  task,
  zone,
  pending,
  onClose,
  onEdit,
  onAsk,
  onMove,
  onArchive,
  onChanged,
  mutationError,
}: {
  task: Task;
  zone: string;
  pending: boolean;
  onClose: () => void;
  onEdit: () => void;
  onAsk: () => void;
  onMove: (s: Status) => void;
  onArchive: () => void;
  onChanged: (task: Task) => void;
  mutationError: string;
}) {
  const [workBusy, setWorkBusy] = useState(false);
  const [events, setEvents] = useState<Activity[]>([]);
  const [source, setSource] =
    useState<Awaited<ReturnType<typeof api.taskSource>>>(null);
  useEffect(() => {
    let active = true;
    api
      .taskSource(task.id)
      .then((value) => {
        if (active) setSource(value);
      })
      .catch(() => {
        if (active) setSource(null);
      });
    return () => {
      active = false;
    };
  }, [task.id]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    setLoading(true);
    api
      .history(task.id)
      .then((rows) => {
        if (active) {
          setEvents(rows);
          setError("");
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [task.id, task.version]);
  return (
    <Modal title="Task details" onClose={onClose} wide>
      <div className="detail-content">
        <span className="category-chip">{task.category}</span>
        <h1>{task.title}</h1>
        {mutationError && <Banner as="p">{mutationError}</Banner>}
        <div className="detail-meta">
          <span className={`priority-badge ${task.priority}`}>
            <Flag size={13} />
            {task.priority} priority
          </span>
          <span>
            <CalendarDays size={14} />
            {dateLabel(task.due_at, zone)}
          </span>
        </div>
        <Field>
          Status
          <select
            value={task.status}
            disabled={pending || workBusy}
            onChange={(e) => onMove(e.target.value as Status)}
          >
            {Object.entries(labels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        <h3>Description</h3>
        <p className="detail-description">
          {task.description ||
            "No description yet. Add a little context when you edit this task."}
        </p>
        {(task.blocker_reason ||
          task.status === "blocked" ||
          task.status === "waiting") && (
          <div className="blocker-panel">
            <h3>Blocker / waiting reason</h3>
            <p>
              {task.blocker_reason ||
                "No reason recorded yet. Add one when you edit this task."}
            </p>
          </div>
        )}
        <div className="detail-actions">
          <Button
            variant="primary"
            onClick={onEdit}
            disabled={pending || workBusy}
          >
            Edit task <ArrowUpRight size={15} />
          </Button>
          <Button
            variant="secondary"
            onClick={onAsk}
            disabled={pending || workBusy}
          >
            <Sparkles size={15} />
            Ask assistant
          </Button>
          <Button
            variant="secondary"
            onClick={onArchive}
            disabled={pending || workBusy}
          >
            <Archive size={15} />
            {task.archived_at ? "Restore task" : "Archive"}
          </Button>
        </div>
        {source && (
          <section className="source-panel">
            <h3>Approved capture source</h3>
            {source.asset && (
              <p>
                Source file: <strong>{source.asset.filename}</strong> · saved
                privately in the conversation
              </p>
            )}
            <p>{source.evidence}</p>
            <small>{source.provider} · Reviewed before task creation</small>
            <a href={`/app/assistant?conversation=${source.conversation_id}`}>
              Open saved conversation
            </a>
          </section>
        )}
        <TaskWork
          task={task}
          zone={zone}
          onChanged={onChanged}
          onBusy={setWorkBusy}
        />
        <TaskSchedule
          key={task.id}
          task={task}
          zone={zone}
          onChanged={onChanged}
        />
        <div className="activity-heading">
          <h3>Activity history</h3>
          <span>Version {task.version}</span>
        </div>
        {loading ? (
          <p>Loading activity…</p>
        ) : error ? (
          <p role="alert">{error}</p>
        ) : (
          <div className="timeline">
            {events.map((event) => (
              <div className="timeline-event" key={event.id}>
                <span className="timeline-dot">
                  <Check size={12} />
                </span>
                <strong>{event.event_type.replaceAll("_", " ")}</strong>
                <small>{timeLabel(event.occurred_at, zone)}</small>
                <div>
                  {Object.entries(event.changes).map(([key, value]) => {
                    const change = value as { before: unknown; after: unknown };
                    return (
                      <p key={key}>
                        <span>{key.replaceAll("_", " ")}</span>
                        <span>
                          {eventValue(change.before)} <ArrowRight size={11} />{" "}
                          {eventValue(change.after)}
                        </span>
                      </p>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
        <p className="history-note">
          <ShieldCheck size={13} />
          Saved changes are preserved in append-only history.
        </p>
      </div>
    </Modal>
  );
}
