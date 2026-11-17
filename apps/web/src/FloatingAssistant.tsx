import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Sparkles,
  Plus,
  CircleCheck,
  Minus,
  X,
  CalendarDays,
  ArrowUpRight,
  MessageSquare,
  ListChecks,
} from "lucide-react";
import type { Task } from "./api";
export type AssistantView = "chat" | "overview" | "update";
export function FloatingAssistant({
  open,
  view,
  context,
  tasks,
  zone,
  children,
  onOpen,
  onCapture,
  onClose,
  onTask,
  aiLabel,
  externalAI,
}: {
  aiLabel: string;
  externalAI: boolean;
  open: boolean;
  view: AssistantView;
  context: string;
  tasks: Task[];
  zone: string;
  children: ReactNode;
  onOpen: (view: AssistantView) => void;
  onCapture: () => void;
  onClose: () => void;
  onTask: (task: Task) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const launcher = useRef<HTMLButtonElement>(null);
  const [peek, setPeek] = useState(false);
  const active = tasks.filter(
    (task) =>
      !task.archived_at && !["completed", "cancelled"].includes(task.status),
  );
  const day = (value: string | Date) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(value));
  const today = day(new Date());
  const attention = active.filter(
    (task) =>
      (task.due_at && day(task.due_at) <= today) || task.status === "blocked",
  );
  const deadlines = active
    .filter((task) => task.due_at)
    .sort((a, b) => a.due_at!.localeCompare(b.due_at!));
  const snapshot = context === "Calendar" ? deadlines : attention;
  useEffect(() => {
    const modal = dialog.current;
    if (open) {
      setPeek(false);
      if (modal && !modal.open) modal.showModal();
      const previous = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = previous;
      };
    }
    if (modal?.open) modal.close();
  }, [open]);
  function dismiss() {
    onClose();
    setPeek(false);
    requestAnimationFrame(() => launcher.current?.focus());
  }
  return (
    <div className={`ai-island ${peek && !open ? "is-peeking" : ""}`}>
      <div
        className="ai-launcher-shell"
        hidden={open}
        onPointerEnter={(e) => {
          if (e.pointerType !== "touch") setPeek(true);
        }}
        onPointerLeave={() => setPeek(false)}
        onFocusCapture={() => setPeek(true)}
        onBlurCapture={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node))
            setPeek(false);
        }}
      >
        <button
          ref={launcher}
          className="ai-launcher"
          aria-label="Ask Workroom"
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => onOpen("chat")}
        >
          <Sparkles size={21} />
          <strong>{peek ? "Workroom AI" : "Ask Workroom"}</strong>
          <span className="ai-status-dot" aria-hidden="true" />
        </button>
        <div className="ai-quick-actions" inert={!peek || undefined}>
          <button onClick={onCapture}>
            <Plus size={16} />
            Capture a task
          </button>
          <button onClick={() => onOpen("update")}>
            <CircleCheck size={16} />
            Update progress
          </button>
          <button onClick={() => onOpen("overview")}>
            <Sparkles size={16} />
            Ask about{" "}
            {context === "Calendar"
              ? "calendar"
              : context === "My board"
                ? "board"
                : "today"}
          </button>
        </div>
        <span className="ai-launcher-caption">Your work, one click away</span>
      </div>
      <dialog
        ref={dialog}
        className="ai-conversation-dialog"
        aria-labelledby="ai-dialog-title"
        onCancel={(e) => {
          e.preventDefault();
          dismiss();
        }}
        onClick={(e) => {
          if (e.target === e.currentTarget) dismiss();
        }}
      >
        <header className="ai-dialog-header">
          <Sparkles size={26} />
          <div>
            <h2 id="ai-dialog-title">Workroom AI</h2>
            <p>
              <span /> {context} context ·{" "}
              {view === "chat" ? aiLabel : "read-only snapshot"}
            </p>
          </div>
          <button
            className="ai-header-button"
            aria-label="Minimize Workroom AI"
            onClick={dismiss}
          >
            <Minus size={20} />
          </button>
          <button
            className="ai-header-button"
            aria-label="Close Workroom AI"
            onClick={dismiss}
          >
            <X size={20} />
          </button>
        </header>
        <nav className="ai-dialog-tabs" aria-label="Assistant views">
          <button aria-pressed={view === "chat"} onClick={() => onOpen("chat")}>
            <MessageSquare size={15} />
            Conversation
          </button>
          <button
            aria-pressed={view === "overview"}
            onClick={() => onOpen("overview")}
          >
            <CalendarDays size={15} />
            This page
          </button>
          <button
            aria-pressed={view === "update"}
            onClick={() => onOpen("update")}
          >
            <ListChecks size={15} />
            Update a task
          </button>
        </nav>
        <div className="ai-chat-surface" hidden={view !== "chat"}>
          {children}
        </div>
        <section
          className="ai-context-surface"
          hidden={view === "chat"}
          aria-label={
            view === "update"
              ? "Choose a task to update"
              : "Current page snapshot"
          }
        >
          <div className="ai-context-intro">
            <span className="ai-context-icon">
              <Sparkles size={22} />
            </span>
            <div>
              <span className="ai-eyebrow">
                {context.toUpperCase()} · PRIVATE WORKSPACE
              </span>
              <h3>
                {view === "update"
                  ? "Which task shall we work on?"
                  : context === "Calendar"
                    ? "Your upcoming deadlines, together."
                    : "A little clarity for your next step."}
              </h3>
              <p>
                {view === "update"
                  ? "Choose a task to open its saved conversation. Any proposed change will need your approval."
                  : "This snapshot comes from the tasks loaded on this page. It is read-only; no model was called."}
              </p>
            </div>
          </div>
          {view === "overview" && (
            <div className="ai-snapshot-stats">
              <span>
                <strong>{active.length}</strong>Active tasks
              </span>
              <span>
                <strong>{attention.length}</strong>Need attention
              </span>
              <span>
                <strong>{deadlines.length}</strong>With deadlines
              </span>
            </div>
          )}
          <div className="ai-context-tasks">
            {(view === "update" ? active : snapshot)
              .slice(0, 12)
              .map((task) => (
                <button
                  className="ai-context-task"
                  key={task.id}
                  onClick={() => onTask(task)}
                >
                  <span className={`ai-task-symbol ${task.status}`}>
                    <CalendarDays size={18} />
                  </span>
                  <span>
                    <strong>{task.title}</strong>
                    <small>
                      {task.due_at
                        ? new Intl.DateTimeFormat("en", {
                            timeZone: zone,
                            month: "short",
                            day: "numeric",
                          }).format(new Date(task.due_at))
                        : "No deadline"}{" "}
                      · {task.status.replaceAll("_", " ")}
                    </small>
                  </span>
                  <ArrowUpRight size={16} />
                </button>
              ))}
          </div>
          {!(view === "update" ? active : snapshot).length && (
            <div className="ai-context-empty">
              <CircleCheck size={28} />
              <h4>
                {view === "update"
                  ? "No active tasks on this page."
                  : "A little breathing room."}
              </h4>
              <p>
                {view === "update"
                  ? "Create a task or switch to your board to choose work."
                  : "No matching deadlines or blockers in the current page snapshot."}
              </p>
            </div>
          )}
          {(view === "update" ? active : snapshot).length > 12 && (
            <p className="ai-context-limit">
              Showing the first 12 matching tasks. Use your board to find more.
            </p>
          )}
          <div className="ai-context-note">
            <Sparkles size={18} />
            <p>
              Open a task for guidance, a reviewed progress update or an exact
              deadline change. Nothing is saved until you approve.
            </p>
          </div>
        </section>
        <footer className="ai-dialog-footer">
          {view === "chat" && externalAI
            ? "Approve processing before sending · approve changes before saving"
            : "Suggestions require your approval · no external AI calls"}
        </footer>
      </dialog>
    </div>
  );
}
