import { ChevronDown, ChevronUp, Plus } from "lucide-react";
import type { CaptureApp } from "./useCaptureState";
import { Button } from "./ui/Button";

export function CaptureSidebar({ app }: { app: CaptureApp }) {
  const {
    zone,
    compact,
    showHistory,
    setShowHistory,
    rows,
    page,
    busy,
    loading,
    select,
    create,
  } = app;
  return (
    <aside className="capture-sidebar">
      <div className="capture-list-heading">
        {compact ? (
          <button
            className="history-toggle"
            aria-expanded={showHistory}
            onClick={() => setShowHistory(!showHistory)}
          >
            Conversations{" "}
            {showHistory ? (
              <ChevronUp size={14} aria-hidden="true" />
            ) : (
              <ChevronDown size={14} aria-hidden="true" />
            )}
          </button>
        ) : (
          <strong>Conversations</strong>
        )}
        <Button
          variant="icon"
          aria-label="New conversation"
          disabled={busy || loading}
          onClick={create}
        >
          <Plus size={18} />
        </Button>
      </div>
      {rows.map((row) => (
        <button
          key={row.id}
          disabled={busy}
          className={`conversation-item ${page?.conversation.id === row.id ? "selected" : ""}`}
          onClick={() => void select(row.id)}
        >
          <span>
            {row.task_id ? "Task conversation · " : ""}
            {row.title}
          </span>
          <small>
            {new Date(row.updated_at).toLocaleDateString("en", {
              timeZone: zone,
              month: "short",
              day: "numeric",
            })}
          </small>
        </button>
      ))}
      {!rows.length && !loading && (
        <p className="capture-hint">Your saved captures will appear here.</p>
      )}
    </aside>
  );
}
