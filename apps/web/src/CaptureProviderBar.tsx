import { Sparkles } from "lucide-react";
import type { CaptureApp } from "./useCaptureState";

export function CaptureProviderBar({ app }: { app: CaptureApp }) {
  const {
    aiStatus,
    providerId,
    onProvider,
    liveConsent,
    setLiveConsent,
    provider,
    external,
    page,
    busy,
    retry,
  } = app;
  return (
    <>
      {external ? (
        <div className="mock-banner">
          <Sparkles size={18} />
          <div>
            <strong>
              {`${provider?.label} · ${provider?.model || "configuration needed"}`}
            </strong>
            <p>
              AI can miss details or make mistakes. Review every suggestion
              before approving.
            </p>
          </div>
          <span>Review required</span>
        </div>
      ) : (
        <p className="mock-note">
          <Sparkles size={14} aria-hidden="true" />
          <span>
            <strong>Deterministic mock · no external AI calls.</strong> It may
            miss tasks, so review every suggestion.
          </span>
        </p>
      )}
      <div className="ai-provider-controls">
        <label>
          AI provider
          <select
            aria-label="AI provider"
            value={providerId}
            disabled={busy || Boolean(retry.current) || !aiStatus}
            onChange={(e) => {
              onProvider(e.target.value);
              setLiveConsent(false);
            }}
          >
            {(aiStatus?.providers || []).map((item) => (
              <option key={item.id} value={item.id} disabled={!item.ready}>
                {item.label}
                {!item.ready ? " — not configured" : ""}
              </option>
            ))}
          </select>
        </label>
        {aiStatus && external && (
          <small>
            {aiStatus.requests_used}/{aiStatus.request_limit} live requests · $
            {(aiStatus.reserved_micro_usd / 1000000).toFixed(3)} reserved of $
            {(aiStatus.daily_limit_micro_usd / 1000000).toFixed(2)} / UTC day
          </small>
        )}
        {external && (
          <label className="ai-consent">
            <input
              type="checkbox"
              checked={liveConsent}
              disabled={busy || !provider?.ready}
              onChange={(e) => setLiveConsent(e.target.checked)}
            />
            <span>
              For this request, send my submitted text and{" "}
              {page?.task
                ? "selected task, notes, steps and recent chat"
                : "selected file's extracted text"}{" "}
              to {provider?.label}
              {provider?.upstream ? ` via ${provider.upstream}` : ""}. Provider
              data policies apply.
            </span>
          </label>
        )}
      </div>
    </>
  );
}
