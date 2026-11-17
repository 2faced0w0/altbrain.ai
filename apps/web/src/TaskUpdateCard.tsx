import { useRef, useState } from "react";
import { Check, X } from "lucide-react";
import * as api from "./api";
import type { Changes, Task, TaskUpdate } from "./api";
import "./task-assistant.css";

const statuses = [
  "inbox",
  "planned",
  "in_progress",
  "waiting",
  "blocked",
  "in_review",
  "completed",
  "cancelled",
] as const;
function localValue(value: string | null | undefined, zone: string) {
  if (!value) return "";
  const date = new Date(value);
  return `${new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date)}T${new Intl.DateTimeFormat("en-GB", { timeZone: zone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date)}`;
}
function display(key: string, value: unknown, zone: string) {
  if (value === null || value === undefined || value === "") return "Not set";
  if (key === "due_at")
    return (
      new Intl.DateTimeFormat("en", {
        timeZone: zone,
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(String(value))) + ` · ${zone}`
    );
  return String(value).replaceAll("_", " ");
}

export function TaskUpdateCard({
  proposal,
  task,
  zone,
  onChanged,
  onRefresh,
  onOpenTask,
}: {
  proposal: TaskUpdate;
  task: Task;
  zone: string;
  onChanged: (row: TaskUpdate, task?: Task) => void;
  onRefresh: () => Promise<void>;
  onOpenTask: (id: string) => void;
}) {
  const [changes, setChanges] = useState<Changes>(proposal.proposed_changes);
  const [deadline, setDeadline] = useState(
    Object.hasOwn(proposal.proposed_changes, "due_at")
      ? proposal.proposed_changes.due_at === null
        ? "clear"
        : "set"
      : "keep",
  );
  const [due, setDue] = useState(
    localValue(proposal.proposed_changes.due_at || task.due_at, zone),
  );
  const [fold, setFold] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const guard = useRef(false);
  const retry = useRef<{
    signature: string;
    key: string;
    fn: (key: string) => Promise<void>;
  } | null>(null);
  const stale =
    task.version !== proposal.base_version || Boolean(task.archived_at);
  function field(key: keyof Changes, value: unknown) {
    setChanges((current) => {
      const next = { ...current };
      if (value === undefined) delete next[key];
      else Object.assign(next, { [key]: value });
      return next;
    });
  }
  async function decide(kind: "approve" | "reject") {
    if (guard.current) return;
    guard.current = true;
    setBusy(true);
    setError("");
    try {
      const values = { ...changes };
      delete values.due_at;
      if (deadline === "clear") values.due_at = null;
      if (kind === "approve" && deadline === "set") {
        if (!due)
          throw new Error(
            "Choose a precise due date and time before approving.",
          );
        values.due_at = await api.resolveDeadline(
          due,
          fold === "" ? undefined : (Number(fold) as 0 | 1),
        );
      }
      const signature = JSON.stringify([kind, values]);
      if (retry.current?.signature !== signature)
        retry.current = {
          signature,
          key: crypto.randomUUID(),
          fn: async (key) => {
            const result = await api.decideTaskUpdate(
              proposal,
              kind,
              kind === "approve" ? values : null,
              key,
            );
            onChanged(result.proposal, result.commit?.task);
          },
        };
      await retry.current.fn(retry.current.key);
      retry.current = null;
    } catch (e) {
      setError((e as Error).message);
      if (e instanceof api.RequestError && e.status < 500) retry.current = null;
    } finally {
      guard.current = false;
      setBusy(false);
    }
  }
  if (proposal.review_state !== "ready_for_review")
    return (
      <div className={`proposal-reviewed ${proposal.review_state}`}>
        <span>
          {proposal.review_state === "approved" ? (
            <Check size={17} />
          ) : (
            <X size={17} />
          )}
          <strong>
            {proposal.review_state === "approved"
              ? "Task update approved"
              : "Task update rejected"}
          </strong>
          <small>
            {proposal.review_state === "approved"
              ? "Saved once with activity history"
              : "No task changes were made"}
          </small>
        </span>
        <button
          className="secondary-button"
          onClick={() => onOpenTask(task.id)}
        >
          Open task
        </button>
      </div>
    );
  const preview = { ...changes };
  delete preview.due_at;
  if (deadline === "clear") preview.due_at = null;
  if (deadline === "set") preview.due_at = due || null;
  return (
    <form
      className="proposal-card task-update-card"
      aria-label="Task update proposal"
      onSubmit={(e) => {
        e.preventDefault();
        void decide("approve");
      }}
    >
      <div className="proposal-top">
        <span>PROPOSED UPDATE · NO CHANGES SAVED</span>
        <small>Based on task version {proposal.base_version}</small>
      </div>
      <blockquote>{proposal.evidence}</blockquote>
      <h3 className="update-task-title">Update: {task.title}</h3>
      {proposal.questions.map((question, index) => (
        <p key={index} className="proposal-question">
          {question}
        </p>
      ))}
      {stale && (
        <div className="error-banner" role="alert">
          This task changed after preparation or is archived. Approval is
          disabled. Restore it if needed, refresh task context, and send a new
          request; your draft is kept.
          <button
            type="button"
            disabled={busy}
            onClick={() => void onRefresh()}
          >
            Refresh task context
          </button>
        </div>
      )}
      {error && (
        <div className="error-banner" role="alert">
          {error}
          <button
            type="button"
            disabled={busy}
            onClick={() => void onRefresh()}
          >
            Refresh task context
          </button>
        </div>
      )}
      <table className="update-diff">
        <caption>Review before and after</caption>
        <thead>
          <tr>
            <th>Field</th>
            <th>Before</th>
            <th>After approval</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(preview).map(([key, value]) => (
            <tr key={key}>
              <th>{key.replaceAll("_", " ")}</th>
              <td>{display(key, proposal.before_state[key], zone)}</td>
              <td>
                {key === "due_at" && deadline === "set"
                  ? due
                    ? `${due.replace("T", " ")} · ${zone} (to validate)`
                    : "Choose exact time"
                  : display(key, value, zone)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!Object.keys(preview).length && (
        <p className="capture-hint">
          Choose an explicit change below. This proposal cannot be approved
          without a change.
        </p>
      )}
      <fieldset disabled={busy || stale}>
        <legend className="sr-only">Reviewed task changes</legend>
        <div className="form-grid">
          <label className="form-field">
            Change status
            <select
              value={changes.status ?? ""}
              onChange={(e) => field("status", e.target.value || undefined)}
            >
              <option value="">Leave unchanged</option>
              {statuses.map((value) => (
                <option key={value} value={value}>
                  {value.replaceAll("_", " ")}
                </option>
              ))}
            </select>
          </label>
          <label className="form-field">
            Change priority
            <select
              value={changes.priority ?? ""}
              onChange={(e) => field("priority", e.target.value || undefined)}
            >
              <option value="">Leave unchanged</option>
              {["low", "medium", "high", "urgent"].map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="form-grid">
          <label className="form-field">
            Change progress source
            <select
              value={changes.progress_mode ?? ""}
              onChange={(e) => {
                const value = e.target.value;
                setChanges((current) => {
                  const next = { ...current };
                  delete next.progress_mode;
                  delete next.manual_progress;
                  if (value === "manual") {
                    next.progress_mode = "manual";
                    next.manual_progress =
                      current.manual_progress ?? task.manual_progress;
                  }
                  if (value === "steps") next.progress_mode = "steps";
                  return next;
                });
              }}
            >
              <option value="">Leave unchanged</option>
              <option value="manual">Manual percentage</option>
              <option value="steps">From checklist</option>
            </select>
          </label>
          {changes.progress_mode === "manual" && (
            <label className="form-field">
              Proposed manual progress (%)
              <input
                type="number"
                min={0}
                max={100}
                required
                value={changes.manual_progress ?? task.manual_progress}
                onChange={(e) =>
                  field("manual_progress", Number(e.target.value))
                }
              />
            </label>
          )}
        </div>
        <label className="change-reason">
          <input
            type="checkbox"
            checked={Object.hasOwn(changes, "blocker_reason")}
            onChange={(e) =>
              field(
                "blocker_reason",
                e.target.checked ? task.blocker_reason : undefined,
              )
            }
          />
          Update blocker / waiting reason
        </label>
        {Object.hasOwn(changes, "blocker_reason") && (
          <label className="form-field">
            Proposed blocker reason
            <textarea
              rows={2}
              maxLength={2000}
              value={changes.blocker_reason ?? ""}
              onChange={(e) => field("blocker_reason", e.target.value)}
            />
          </label>
        )}
        <label className="form-field">
          Deadline action
          <select
            value={deadline}
            onChange={(e) => setDeadline(e.target.value)}
          >
            <option value="keep">Leave deadline unchanged</option>
            <option value="set">Set an exact deadline</option>
            <option value="clear">Clear deadline</option>
          </select>
        </label>
        {deadline === "set" && (
          <>
            <label className="form-field">
              Exact due date & time <span>in {zone}</span>
              <input
                type="datetime-local"
                required
                value={due}
                onChange={(e) => setDue(e.target.value)}
              />
            </label>
            <label className="form-field">
              Clock-change occurrence
              <select value={fold} onChange={(e) => setFold(e.target.value)}>
                <option value="">Ask if this time occurs twice</option>
                <option value="0">First occurrence</option>
                <option value="1">Second occurrence</option>
              </select>
            </label>
          </>
        )}
      </fieldset>
      <div className="proposal-actions">
        <button
          type="button"
          className="text-button"
          disabled={busy}
          onClick={() => void decide("reject")}
        >
          Reject update
        </button>
        <button
          type="submit"
          className="primary-button"
          disabled={busy || stale || !Object.keys(preview).length}
        >
          <Check size={15} />
          {busy ? "Saving…" : "Approve changes"}
        </button>
      </div>
    </form>
  );
}
