import { useEffect, useRef, useState } from "react";
import * as api from "./api";
import type { Task, Work, Step, Deliverable } from "./api";
import { Banner } from "./ui/Banner";
import { Button } from "./ui/Button";

export function TaskWork({
  task,
  zone,
  onChanged,
  onBusy,
}: {
  task: Task;
  zone: string;
  onChanged: (task: Task) => void;
  onBusy: (busy: boolean) => void;
}) {
  const [work, setWork] = useState<Work>({
    steps: [],
    deliverables: [],
    notes: [],
  });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState("");
  const [deliverable, setDeliverable] = useState("");
  const [note, setNote] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const guard = useRef(false);
  const retry = useRef<{
    signature: string;
    key: string;
    operation: (key: string) => ReturnType<typeof api.editTask>;
  } | null>(null);
  useEffect(() => {
    let active = true;
    setLoading(true);
    api
      .work(task.id)
      .then((data) => {
        if (active) setWork(data);
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
  async function run(
    signature: string,
    operation: (key: string) => ReturnType<typeof api.editTask>,
    done?: () => void,
  ) {
    if (guard.current) return;
    guard.current = true;
    setBusy(true);
    onBusy(true);
    setError("");
    if (retry.current?.signature !== signature)
      retry.current = { signature, key: crypto.randomUUID(), operation };
    try {
      const result = await retry.current.operation(retry.current.key);
      retry.current = null;
      done?.();
      onChanged(result.task); // A committed write is successful even if its follow-up read fails.
      try {
        setWork(await api.work(task.id));
      } catch {
        setError(
          "Saved, but the details could not be refreshed. Reopen this task to reload them.",
        );
      }
    } catch (e) {
      if (e instanceof api.RequestError && e.status < 500) retry.current = null;
      setError((e as Error).message);
      try {
        setWork(await api.work(task.id));
        onChanged(await api.getTask(task.id));
      } catch {
        /* retain the last known task and the unsaved input */
      }
    } finally {
      guard.current = false;
      setBusy(false);
      onBusy(false);
    }
  }
  function updateStep(row: Step, patch: Partial<Step>) {
    if (guard.current) return;
    const values = {
      text: row.text,
      checked: row.checked,
      position: row.position,
      ...patch,
    };
    setWork((current) => ({
      ...current,
      steps: current.steps.map((item) =>
        item.id === row.id ? { ...item, ...values } : item,
      ),
    }));
    void run(
      JSON.stringify(["step", row.id, values]),
      (key) => api.writeStep(task, values, key, row.id),
      () => setEditing(null),
    );
  }
  function updateDeliverable(row: Deliverable, patch: Partial<Deliverable>) {
    if (guard.current) return;
    const values = { description: row.description, state: row.state, ...patch };
    setWork((current) => ({
      ...current,
      deliverables: current.deliverables.map((item) =>
        item.id === row.id ? { ...item, ...values } : item,
      ),
    }));
    void run(
      JSON.stringify(["deliverable", row.id, values]),
      (key) => api.writeDeliverable(task, values, key, row.id),
      () => setEditing(null),
    );
  }
  const percent =
    task.progress_mode === "manual" ? task.manual_progress : task.step_progress;
  return (
    <section className="task-work" aria-label="Task work">
      {error && (
        <Banner as="p">
          {error} Your input is kept. Review the latest task before retrying.
        </Banner>
      )}
      <div className="work-progress">
        <h3>Progress</h3>
        <strong>
          {percent}% ·{" "}
          {task.progress_mode === "manual" ? "Manual" : "From checklist"}
        </strong>
        <progress aria-label="Task progress" max={100} value={percent} />
        <p>
          Checklist progress and manual progress are separate. Completing steps
          does not change task status.
        </p>
      </div>
      {loading && <p role="status">Loading task details…</p>}
      <h3>
        Checklist{" "}
        <small>
          {work.steps.filter((s) => s.checked).length}/{work.steps.length}
        </small>
      </h3>
      {!work.steps.length && !loading && (
        <p className="work-empty">Break this task into a few clear steps.</p>
      )}
      <fieldset disabled={busy || loading}>
        <legend className="sr-only">Checklist</legend>
        {work.steps.map((row) => (
          <div className="work-item" key={row.id}>
            <label>
              <input
                type="checkbox"
                checked={row.checked}
                onChange={(e) => updateStep(row, { checked: e.target.checked })}
              />
              <span>{row.text}</span>
            </label>
            <button
              className="text-button"
              aria-label={`Edit step ${row.text}`}
              onClick={() => setEditing(row.id)}
            >
              Edit
            </button>
            {editing === row.id && (
              <form
                className="work-edit"
                onSubmit={(e) => {
                  e.preventDefault();
                  const data = new FormData(e.currentTarget);
                  updateStep(row, {
                    text: String(data.get("text")),
                    position: Number(data.get("position")),
                  });
                }}
              >
                <label>
                  Step text
                  <input
                    name="text"
                    defaultValue={row.text}
                    required
                    maxLength={500}
                  />
                </label>
                <label>
                  Order
                  <input
                    name="position"
                    type="number"
                    min={0}
                    max={10000}
                    defaultValue={row.position}
                    required
                  />
                </label>
                <Button variant="secondary">Save step</Button>
                <button type="button" onClick={() => setEditing(null)}>
                  Cancel
                </button>
              </form>
            )}
          </div>
        ))}
        <form
          className="inline-form"
          onSubmit={(e) => {
            e.preventDefault();
            void run(
              JSON.stringify(["add-step", step]),
              (key) => api.writeStep(task, { text: step, checked: false }, key),
              () => setStep(""),
            );
          }}
        >
          <input
            aria-label="New checklist step"
            value={step}
            onChange={(e) => setStep(e.target.value)}
            required
            maxLength={500}
            placeholder="Add the next step…"
          />
          <Button variant="secondary" disabled={!step.trim()}>
            Add step
          </Button>
        </form>
      </fieldset>
      <h3>Deliverables</h3>
      {!work.deliverables.length && !loading && (
        <p className="work-empty">
          What should be ready when this work is done?
        </p>
      )}
      <fieldset disabled={busy || loading}>
        <legend className="sr-only">Deliverables</legend>
        {work.deliverables.map((row) => (
          <div className="work-item" key={row.id}>
            <label>
              <input
                type="checkbox"
                checked={row.state === "ready"}
                onChange={(e) =>
                  updateDeliverable(row, {
                    state: e.target.checked ? "ready" : "pending",
                  })
                }
              />
              <span>{row.description}</span>
            </label>
            <button
              className="text-button"
              aria-label={`Edit deliverable ${row.description}`}
              onClick={() => setEditing(row.id)}
            >
              Edit
            </button>
            {editing === row.id && (
              <form
                className="work-edit"
                onSubmit={(e) => {
                  e.preventDefault();
                  updateDeliverable(row, {
                    description: String(
                      new FormData(e.currentTarget).get("description"),
                    ),
                  });
                }}
              >
                <label>
                  Deliverable description
                  <input
                    name="description"
                    defaultValue={row.description}
                    required
                    maxLength={1000}
                  />
                </label>
                <Button variant="secondary">Save deliverable</Button>
                <button type="button" onClick={() => setEditing(null)}>
                  Cancel
                </button>
              </form>
            )}
          </div>
        ))}
        <form
          className="inline-form"
          onSubmit={(e) => {
            e.preventDefault();
            void run(
              JSON.stringify(["add-deliverable", deliverable]),
              (key) =>
                api.writeDeliverable(
                  task,
                  { description: deliverable, state: "pending" },
                  key,
                ),
              () => setDeliverable(""),
            );
          }}
        >
          <input
            aria-label="New deliverable"
            value={deliverable}
            onChange={(e) => setDeliverable(e.target.value)}
            required
            maxLength={1000}
            placeholder="A document, decision, or result…"
          />
          <Button variant="secondary" disabled={!deliverable.trim()}>
            Add deliverable
          </Button>
        </form>
      </fieldset>
      <h3>Notes</h3>
      <fieldset disabled={busy || loading}>
        <legend className="sr-only">Notes</legend>
        <form
          className="note-form"
          onSubmit={(e) => {
            e.preventDefault();
            void run(
              JSON.stringify(["note", note]),
              (key) => api.addNote(task, note, key),
              () => setNote(""),
            );
          }}
        >
          <textarea
            aria-label="New note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            required
            maxLength={10000}
            rows={3}
            placeholder="Keep a useful detail with this task…"
          />
          <Button variant="secondary" disabled={!note.trim()}>
            Add note
          </Button>
        </form>
      </fieldset>
      {work.notes.map((row) => (
        <article className="work-note" key={row.id}>
          <p>{row.content}</p>
          <small>
            {new Date(row.created_at).toLocaleString("en", { timeZone: zone })}{" "}
            · {zone}
          </small>
        </article>
      ))}
    </section>
  );
}
