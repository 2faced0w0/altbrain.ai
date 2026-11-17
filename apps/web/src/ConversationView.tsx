import { ShieldCheck, Sparkles } from "lucide-react";
import type { ConversationPage } from "./api";
import { SourceFiles } from "./SourceFiles";
import { TaskUpdateCard } from "./TaskUpdateCard";
import { ProposalCard } from "./ProposalCard";
import type { CaptureApp } from "./useCaptureState";

export function ConversationView({
  app,
  page,
}: {
  app: CaptureApp;
  page: ConversationPage;
}) {
  const {
    zone,
    onOpenTask,
    compact,
    setLiveConsent,
    canSend,
    draft,
    setDraft,
    busy,
    saved,
    setSaved,
    backup,
    select,
    saveDraft,
    send,
    upload,
    reviewFile,
    older,
    proposalChanged,
    updateChanged,
  } = app;
  return (
    <>
      {page.task && (
        <section
          className="selected-task-context"
          aria-label="Selected task context"
        >
          <div>
            <strong>Selected task: {page.task.title}</strong>
            <span>
              Scope is fixed to this task ·{" "}
              {page.task.status.replaceAll("_", " ")} · version{" "}
              {page.task.version}
            </span>
          </div>
          <button
            className="secondary-button"
            onClick={() => onOpenTask(page.task!.id)}
          >
            Open selected task
          </button>
          <button
            className="secondary-button"
            disabled={busy}
            onClick={() => void select(page.conversation.id, true)}
          >
            Refresh task context
          </button>
        </section>
      )}
      <div className="capture-title">
        <h2>{page.conversation.title}</h2>
        <span>
          <ShieldCheck size={13} />
          Private · saved in your workspace
        </span>
      </div>
      {!page.task &&
        (compact ? (
          <details
            className="island-file-drawer"
            open={(page.sources || []).length > 0 || undefined}
          >
            <summary>
              Attach a file{" "}
              <span>
                {page.sources?.length
                  ? `${page.sources.length} saved`
                  : "TXT · MD · EML"}
              </span>
            </summary>
            <SourceFiles
              key={page.conversation.id}
              page={page}
              busy={busy}
              onUpload={upload}
              onReview={reviewFile}
              canReview={canSend}
            />
          </details>
        ) : (
          <SourceFiles
            key={page.conversation.id}
            page={page}
            busy={busy}
            onUpload={upload}
            onReview={reviewFile}
            canReview={canSend}
          />
        ))}
      {page.has_older && (
        <button
          className="secondary-button"
          disabled={busy}
          onClick={() => void older()}
        >
          Load older messages
        </button>
      )}
      <div className="capture-history">
        {page.messages.map((message) => (
          <article
            className={`capture-message ${message.role}`}
            key={message.id}
          >
            <div>
              <strong>
                {message.role === "user"
                  ? page.task
                    ? "Your task request"
                    : page.runs.some(
                          (run) =>
                            run.source_message_id === message.id &&
                            run.source_asset_id,
                        )
                      ? "File request"
                      : "Pasted request"
                  : page.task
                    ? "Task assistant"
                    : "Saved assistant reply"}
              </strong>
              <time>
                {new Date(message.created_at).toLocaleString("en", {
                  timeZone: zone,
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </time>
            </div>
            <p>{message.content}</p>
            {page.runs
              .filter((run) => run.source_message_id === message.id)
              .map((run) => (
                <section
                  key={run.id}
                  className="capture-run"
                  aria-label="Capture result"
                >
                  {run.source_asset_id && (
                    <p className="source-file-reference">
                      Source file:{" "}
                      {page.sources?.find(
                        (asset) => asset.id === run.source_asset_id,
                      )?.filename || "Saved private file"}
                    </p>
                  )}
                  <div className={`run-label ${run.state}`}>
                    <span>
                      {run.state === "failed"
                        ? `Failed · ${run.error_code?.replaceAll("_", " ")}`
                        : page.task
                          ? page.updates?.some((item) => item.run_id === run.id)
                            ? "Update waiting for review"
                            : "Guidance · no task changes"
                          : "Proposals ready for review"}
                    </span>
                    <small>
                      {run.provider}
                      {run.model ? ` · ${run.model}` : ""}
                      {run.input_tokens != null
                        ? ` · ${run.input_tokens} in / ${run.output_tokens ?? "?"} out`
                        : ""}
                    </small>
                  </div>
                  {run.state === "failed" ? (
                    <p className="capture-hint">
                      Your request and draft are retained. No task changes were
                      made and no fallback provider was contacted.
                      {run.error_code === "quota_exhausted" && (
                        <>
                          {" "}
                          The provider reported exhausted credits or an account
                          usage/spend limit. Check its billing and limits before
                          sending a new request; waiting alone may not resolve
                          it.
                        </>
                      )}
                      {run.error_code === "rate_limited" && (
                        <>
                          {" "}
                          The provider returned HTTP 429. This can mean
                          temporary throttling or an account quota/billing
                          restriction. Check the provider's limits and billing
                          before trying again.
                        </>
                      )}
                      {(run.error_code === "rate_limited" ||
                        run.error_code === "quota_exhausted") && (
                        <>
                          {" "}
                          A saved failed action replays its recorded failure.
                          After resolving the cause, send a new request with
                          fresh consent.
                        </>
                      )}
                      {run.provider === "openai" &&
                        (run.error_code === "rate_limited" ||
                          run.error_code === "quota_exhausted") && (
                          <>
                            {" "}
                            <a
                              href="https://platform.openai.com/settings/organization/billing/overview"
                              target="_blank"
                              rel="noreferrer"
                            >
                              OpenAI API billing
                            </a>
                            {" · "}
                            <a
                              href="https://platform.openai.com/settings/organization/limits"
                              target="_blank"
                              rel="noreferrer"
                            >
                              OpenAI limits
                            </a>
                          </>
                        )}
                    </p>
                  ) : page.task ? (
                    <>
                      {(page.updates || [])
                        .filter((item) => item.run_id === run.id)
                        .map((item) => (
                          <TaskUpdateCard
                            key={`${item.id}:${item.version}`}
                            proposal={item}
                            task={page.task!}
                            zone={zone}
                            onChanged={updateChanged}
                            onRefresh={() => select(page.conversation.id, true)}
                            onOpenTask={onOpenTask}
                          />
                        ))}
                      {!page.updates?.some(
                        (item) => item.run_id === run.id,
                      ) && (
                        <p className="capture-hint">
                          Read the saved guidance below. Advice has no task
                          effects.
                        </p>
                      )}
                    </>
                  ) : !page.proposals.some((item) => item.run_id === run.id) ? (
                    <p className="capture-hint">
                      No actionable requests found. Try a line such as “Prepare
                      the workshop outline”.
                    </p>
                  ) : (
                    page.proposals
                      .filter((item) => item.run_id === run.id)
                      .map((item) => (
                        <ProposalCard
                          key={`${item.id}:${item.version}`}
                          proposal={item}
                          zone={zone}
                          onChanged={proposalChanged}
                          onOpenTask={onOpenTask}
                        />
                      ))
                  )}
                </section>
              ))}
          </article>
        ))}
      </div>
      <div className="capture-composer">
        <label htmlFor="capture-input">
          {page.task
            ? "Ask about this task"
            : "Paste an email or type a request"}
        </label>
        <textarea
          id="capture-input"
          value={draft}
          maxLength={20000}
          rows={compact ? 2 : 6}
          disabled={busy}
          placeholder={
            page.task
              ? "What should I do next? Or: mark this done, set priority high, set progress 60%, move deadline to Friday…"
              : "Please prepare the workshop outline by Friday.\nReview the assessment draft.\nPlan the certification event."
          }
          onChange={(e) => {
            setDraft(e.target.value);
            setLiveConsent(false);
            backup(page.conversation.id, e.target.value);
            setSaved("Unsaved changes");
          }}
        />
        <div className="composer-bottom">
          <span role="status">
            {busy ? "Saving…" : saved || "Drafts save automatically"} ·{" "}
            {draft.length.toLocaleString()}/20,000
          </span>
          <div>
            <button
              className="secondary-button"
              disabled={busy}
              onClick={() => void saveDraft(page.conversation, draft)}
            >
              Save draft
            </button>
            <button
              className="primary-button"
              disabled={busy || !draft.trim() || !canSend}
              onClick={send}
            >
              <Sparkles size={15} />
              {page.task ? "Send task request" : "Review proposals"}
            </button>
          </div>
        </div>
        <p className="capture-hint">
          {page.task
            ? "Guidance never changes this task. A proposed update needs your approval and the original task version."
            : "No task is created until you approve a proposal. Deadlines and priorities are yours to confirm."}
        </p>
      </div>
    </>
  );
}
