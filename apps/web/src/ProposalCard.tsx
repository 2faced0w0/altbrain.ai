import { useRef, useState } from "react";
import { ArrowRight, Check, X } from "lucide-react";
import * as api from "./api";
import type { Proposal, Task, TaskCreate } from "./api";

export function ProposalCard({
  proposal,
  zone,
  onChanged,
  onOpenTask,
}: {
  proposal: Proposal;
  zone: string;
  onChanged: (row: Proposal, task?: Task) => void;
  onOpenTask: (id: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const guard = useRef(false);
  const retry = useRef<{
    signature: string;
    fn: (key: string) => Promise<void>;
    key: string;
  } | null>(null);
  const base = proposal.draft_task;
  async function action(
    form: HTMLFormElement,
    kind: "save" | "approve" | "reject",
  ) {
    if (guard.current) return;
    guard.current = true;
    setBusy(true);
    setError("");
    const data = new FormData(form);
    const due = String(data.get("due") || "");
    try {
      const originalDue = base.due_at
        ? `${new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(base.due_at))}T${new Intl.DateTimeFormat("en-GB", { timeZone: zone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(base.due_at))}`
        : "";
      const fold = String(data.get("fold") || "");
      const due_at =
        kind === "reject"
          ? null
          : !due
            ? null
            : due === originalDue && fold === ""
              ? base.due_at
              : await api.resolveDeadline(
                  due,
                  fold === "" ? undefined : (Number(fold) as 0 | 1),
                );
      const task: TaskCreate = {
        ...base,
        title: String(data.get("title")).trim(),
        description: String(data.get("description")).trim(),
        priority: data.get("priority") as Task["priority"],
        status: data.get("status") as Task["status"],
        due_at,
      };
      const signature = JSON.stringify([kind, task]);
      if (retry.current?.signature !== signature)
        retry.current = {
          signature,
          key: crypto.randomUUID(),
          fn: async (key) => {
            if (kind === "save") {
              const updated = await api.saveProposal(proposal, task, key);
              onChanged(updated);
              setSaved("Proposal edits saved");
            } else {
              const result = await api.decide(
                proposal,
                kind,
                kind === "approve" ? task : null,
                key,
              );
              onChanged(result.proposal, result.commit?.task);
            }
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
          <strong>{base.title}</strong>
          <small>
            {proposal.review_state === "approved"
              ? "Approved · task created"
              : "Rejected · no task created"}
          </small>
        </span>
        {proposal.approved_task_id && (
          <button
            className="secondary-button"
            onClick={() => onOpenTask(proposal.approved_task_id!)}
          >
            Open task <ArrowRight size={14} />
          </button>
        )}
      </div>
    );
  const dueValue = base.due_at
    ? `${new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(base.due_at))}T${new Intl.DateTimeFormat("en-GB", { timeZone: zone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(base.due_at))}`
    : "";
  return (
    <form
      className="proposal-card"
      aria-label={`Task proposal: ${proposal.candidate.title}`}
      onSubmit={(e) => {
        e.preventDefault();
        if (e.currentTarget.reportValidity())
          void action(e.currentTarget, "approve");
      }}
    >
      <div className="proposal-top">
        <span>PROPOSAL · NOT A SAVED TASK</span>
        <small>Review required</small>
      </div>
      <blockquote>{proposal.candidate.evidence}</blockquote>
      {(proposal.candidate.questions || []).map((question, index) => (
        <p className="proposal-question" key={index}>
          {question}
        </p>
      ))}
      {error && (
        <p className="error-banner" role="alert">
          {error} Your edits remain in this form. Reload the conversation to
          review the latest saved proposal.
        </p>
      )}
      {saved && <p role="status">{saved}</p>}
      <fieldset disabled={busy}>
        <legend className="sr-only">Proposed task fields</legend>
        <label className="form-field">
          Proposed title
          <input
            name="title"
            defaultValue={base.title}
            required
            maxLength={200}
          />
        </label>
        <label className="form-field">
          Proposed description
          <textarea
            name="description"
            rows={2}
            defaultValue={base.description}
            maxLength={10000}
          />
        </label>
        <div className="form-grid">
          <label className="form-field">
            Priority <span>neutral default; not inferred</span>
            <select name="priority" defaultValue={base.priority}>
              {["low", "medium", "high", "urgent"].map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <label className="form-field">
            Initial status
            <select name="status" defaultValue={base.status}>
              {[
                "inbox",
                "planned",
                "in_progress",
                "waiting",
                "blocked",
                "in_review",
                "completed",
                "cancelled",
              ].map((value) => (
                <option key={value} value={value}>
                  {value.replaceAll("_", " ")}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="form-field">
          Due date & time <span>in {zone}; leave blank for no deadline</span>
          <input name="due" type="datetime-local" defaultValue={dueValue} />
        </label>
        <label className="form-field">
          Clock-change occurrence
          <select name="fold" defaultValue="">
            <option value="">Ask if this time occurs twice</option>
            <option value="0">First occurrence</option>
            <option value="1">Second occurrence</option>
          </select>
        </label>
        <div className="proposal-actions">
          <button
            type="button"
            className="text-button"
            onClick={(e) => void action(e.currentTarget.form!, "reject")}
          >
            Reject
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={(e) => {
              const form = e.currentTarget.form!;
              if (form.reportValidity()) void action(form, "save");
            }}
          >
            Save edits
          </button>
          <button type="submit" className="primary-button">
            <Check size={15} />
            {busy ? "Saving…" : "Approve task"}
          </button>
        </div>
      </fieldset>
    </form>
  );
}
