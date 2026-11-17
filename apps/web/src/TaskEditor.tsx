import React, { useRef, useState } from "react";
import { Check, LoaderCircle } from "lucide-react";
import * as api from "./api";
import type { Changes, Task, TaskCreate } from "./api";
import { labels, Status } from "./taskMeta";
import { localDay } from "./dates";
import { Modal } from "./Modal";
import { Banner } from "./ui/Banner";
import { Button } from "./ui/Button";
import { Field } from "./ui/Field";

export function TaskEditor({
  task,
  zone,
  initialStatus,
  onClose,
  onSaved,
  onReload,
}: {
  task: Task | null;
  zone: string;
  initialStatus: Status;
  onClose: () => void;
  onSaved: (task: Task) => Promise<void>;
  onReload: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const lock = useRef(false);
  const operation = useRef<{ payload: string; key: string } | null>(null);
  const dueValue = task?.due_at
    ? `${localDay(task.due_at, zone)}T${new Intl.DateTimeFormat("en-GB", { timeZone: zone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(task.due_at))}`
    : "";
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const due = String(form.get("due_at") || "");
    const fold = String(form.get("fold") || "");
    let dueAt = task?.due_at || null;
    try {
      dueAt = !due
        ? null
        : due === dueValue && fold === ""
          ? task?.due_at || null
          : await api.resolveDeadline(
              due,
              fold === "" ? undefined : (Number(fold) as 0 | 1),
            );
    } catch (e) {
      setError((e as Error).message);
      lock.current = false;
      setBusy(false);
      return;
    }
    const payload: TaskCreate = {
      title: String(form.get("title")).trim(),
      description: String(form.get("description")).trim(),
      category: String(form.get("category")).trim() || "General",
      status: form.get("status") as Status,
      priority: form.get("priority") as Task["priority"],
      due_at: dueAt,
      blocker_reason: String(form.get("blocker_reason") || "").trim(),
      progress_mode: form.get("progress_mode") as "steps" | "manual",
      manual_progress: Number(form.get("manual_progress")),
    };
    const encoded = JSON.stringify(payload);
    if (operation.current?.payload !== encoded)
      operation.current = { payload: encoded, key: crypto.randomUUID() };
    try {
      let result;
      if (task) {
        const changes: Changes = {};
        for (const key of [
          "title",
          "description",
          "category",
          "status",
          "priority",
          "due_at",
          "blocker_reason",
          "progress_mode",
          "manual_progress",
        ] as const)
          if (payload[key] !== task[key])
            Object.assign(changes, { [key]: payload[key] });
        if (!Object.keys(changes).length) {
          onClose();
          return;
        }
        result = await api.editTask(task, changes, operation.current.key);
      } else result = await api.addTask(payload, operation.current.key);
      await onSaved(result.task);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <Modal
      title={task ? "Edit task" : "A little room for something new"}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form onSubmit={save} className="task-form">
        <p className="form-intro">Give it a name. The next step will follow.</p>
        {error && (
          <Banner>
            {error}
            {task && (
              <button
                type="button"
                onClick={() =>
                  void onReload().catch((e) => setError(e.message))
                }
              >
                Reload latest task (discard draft)
              </button>
            )}
          </Banner>
        )}
        <Field>
          Task title
          <input
            name="title"
            required
            maxLength={200}
            autoFocus
            placeholder="What would you like to work on?"
            defaultValue={task?.title}
          />
        </Field>
        <Field>
          Description <span>optional</span>
          <textarea
            name="description"
            rows={4}
            maxLength={10000}
            placeholder="A little context, a next step, or a useful detail…"
            defaultValue={task?.description}
          />
        </Field>
        <div className="form-grid">
          <Field>
            Status
            <select name="status" defaultValue={task?.status || initialStatus}>
              {Object.entries(labels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <Field>
            Priority
            <select name="priority" defaultValue={task?.priority || "medium"}>
              {["low", "medium", "high", "urgent"].map((value) => (
                <option key={value} value={value}>
                  {value.charAt(0).toUpperCase() + value.slice(1)}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field>
          Due date & time <span>in {zone}</span>
          <input type="datetime-local" name="due_at" defaultValue={dueValue} />
        </Field>
        <Field>
          Clock-change occurrence
          <select name="fold" defaultValue="">
            <option value="">Ask if this time occurs twice</option>
            <option value="0">First occurrence</option>
            <option value="1">Second occurrence</option>
          </select>
        </Field>
        <Field>
          Category
          <input
            name="category"
            maxLength={60}
            defaultValue={task?.category || "General"}
            list="categories"
          />
          <datalist id="categories">
            <option>Learning & development</option>
            <option>Assessments</option>
            <option>Operations</option>
            <option>Events</option>
          </datalist>
        </Field>
        <Field>
          Blocker or waiting reason
          <textarea
            name="blocker_reason"
            maxLength={2000}
            rows={2}
            defaultValue={task?.blocker_reason || ""}
            placeholder="What is holding this up?"
          />
        </Field>
        <div className="form-grid">
          <Field>
            Progress source
            <select
              name="progress_mode"
              defaultValue={task?.progress_mode || "steps"}
            >
              <option value="steps">From checklist</option>
              <option value="manual">Manual percentage</option>
            </select>
          </Field>
          <Field>
            Manual progress (%)
            <input
              name="manual_progress"
              type="number"
              min={0}
              max={100}
              required
              defaultValue={task?.manual_progress || 0}
            />
          </Field>
        </div>
        <p className="form-intro">
          Manual percentage is retained separately when checklist progress is
          selected.
        </p>
        <div className="form-actions">
          <Button
            variant="secondary"
            type="button"
            onClick={onClose}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button variant="primary" type="submit" disabled={busy}>
            {busy ? (
              <LoaderCircle className="spin" size={16} />
            ) : (
              <Check size={16} />
            )}{" "}
            {busy ? "Saving…" : task ? "Save changes" : "Create task"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
