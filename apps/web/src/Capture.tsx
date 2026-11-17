import { Plus, Sparkles } from "lucide-react";
import "./capture.css";
import type { CaptureProps } from "./useCaptureState";
import { useCaptureState } from "./useCaptureState";
import { CaptureSidebar } from "./CaptureSidebar";
import { CaptureProviderBar } from "./CaptureProviderBar";
import { ConversationView } from "./ConversationView";
import { Banner } from "./ui/Banner";
import { Button } from "./ui/Button";
import { EmptyState } from "./ui/EmptyState";

export function Capture(props: CaptureProps) {
  const app = useCaptureState(props);
  const {
    compact,
    showHistory,
    page,
    busy,
    loading,
    error,
    retry,
    select,
    perform,
    create,
  } = app;

  return (
    <div
      className={`capture-workspace ${compact ? "island-capture" : ""} ${showHistory ? "show-history" : ""}`}
    >
      <CaptureSidebar app={app} />
      <section className="capture-main" aria-label="Capture assistant">
        <CaptureProviderBar app={app} />
        {error && (
          <Banner>
            <span>{error}</span>
            {retry.current && (
              <button
                onClick={() => {
                  const pending = retry.current;
                  if (pending) void perform(pending.signature, pending.fn);
                }}
                disabled={busy}
              >
                Retry saved action
              </button>
            )}
            {page && (
              <button
                disabled={busy}
                onClick={() => void select(page.conversation.id, true)}
              >
                Reload conversation
              </button>
            )}
          </Banner>
        )}
        {loading ? (
          <EmptyState>
            <h3>Opening saved capture…</h3>
          </EmptyState>
        ) : !page ? (
          <EmptyState>
            <Sparkles size={30} />
            <h2>Turn a request into a clear next step.</h2>
            <p>
              Start a conversation, paste a synthetic email or type a request,
              then review the proposed tasks.
            </p>
            <Button variant="primary" disabled={busy} onClick={create}>
              <Plus size={16} />
              Start a capture
            </Button>
          </EmptyState>
        ) : (
          <ConversationView app={app} page={page} />
        )}
      </section>
    </div>
  );
}
