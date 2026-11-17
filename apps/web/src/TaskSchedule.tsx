import { useEffect, useRef, useState } from "react";
import * as api from "./api";
import type { Task } from "./api";

export function TaskSchedule({
  task,
  zone,
  date,
  onChanged,
  onSaved,
}: {
  task: Task;
  zone: string;
  date?: string;
  onChanged: (task: Task) => void;
  onSaved?: () => void;
}) {
  const [current, setCurrent] = useState(task);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const guard = useRef(false);
  const operation = useRef<{
    signature: string;
    key: string;
    task: Task;
  } | null>(null);
  useEffect(() => setCurrent(task), [task.id, task.version]);
  const due = task.due_at ? new Date(task.due_at) : new Date();
  const day = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(due);
  const time = task.due_at
    ? new Intl.DateTimeFormat("en-GB", {
        timeZone: zone,
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }).format(due)
    : "17:00";
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (guard.current) return;
    guard.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    const data = new FormData(event.currentTarget);
    const localDate = String(data.get("date"));
    const localTime = String(data.get("time"));
    const fold = String(data.get("fold"));
    const signature = JSON.stringify([zone, localDate, localTime, fold]);
    if (operation.current?.signature !== signature)
      operation.current = {
        signature,
        key: crypto.randomUUID(),
        task: current,
      };
    try {
      const result = await api.reschedule(
        operation.current.task,
        localDate,
        localTime,
        fold === "" ? undefined : (Number(fold) as 0 | 1),
        operation.current.key,
      );
      setCurrent(result.task);
      operation.current = null;
      onChanged(result.task);
      setNotice("Deadline saved in " + zone);
      onSaved?.();
    } catch (e) {
      if (e instanceof api.RequestError && e.status < 500)
        operation.current = null;
      setError((e as Error).message);
      try {
        const latest = await api.getTask(current.id);
        setCurrent(latest);
        onChanged(latest);
      } catch {
        /* preserve entered date and time */
      }
    } finally {
      guard.current = false;
      setBusy(false);
    }
  }
  return (
    <form
      className="schedule-form"
      onSubmit={save}
      aria-label="Reschedule task"
    >
      <h3>Reschedule</h3>
      <p>
        Deadline in <strong>{zone}</strong>. Dragging opens this review before
        saving.
      </p>
      {error && (
        <p role="alert" className="error-banner">
          {error} Your chosen date and time are kept.
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      <fieldset disabled={busy}>
        <legend className="sr-only">New deadline</legend>
        <div className="form-grid">
          <label className="form-field">
            New due date
            <input
              name="date"
              type="date"
              defaultValue={date || day}
              required
            />
          </label>
          <label className="form-field">
            New due time
            <input name="time" type="time" defaultValue={time} required />
          </label>
        </div>
        <label className="form-field">
          Clock-change occurrence
          <select name="fold" defaultValue="">
            <option value="">Ask if this time occurs twice</option>
            <option value="0">First occurrence</option>
            <option value="1">Second occurrence</option>
          </select>
        </label>
        <button className="secondary-button" type="submit">
          {busy ? "Saving deadline…" : "Save deadline"}
        </button>
      </fieldset>
    </form>
  );
}
