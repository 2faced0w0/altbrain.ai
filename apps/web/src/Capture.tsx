import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  Check,
  Plus,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import * as api from "./api";
import type {
  Conversation,
  ConversationPage,
  Proposal,
  Task,
  TaskCreate,
} from "./api";
import "./capture.css";
import { SourceFiles } from "./SourceFiles";
import { TaskUpdateCard } from "./TaskUpdateCard";
import type { TaskUpdate } from "./api";

export function Capture({
  zone,
  ownerKey,
  onTask,
  onOpenTask,
  compact = false,
  newConversationRequest = 0,
  onConversation,
  aiStatus,
  providerId,
  onProvider,
  onUsage,
}: {
  aiStatus: api.AIStatus | null;
  providerId: string;
  onProvider: (id: string) => void;
  onUsage: () => void;
  compact?: boolean;
  newConversationRequest?: number;
  onConversation?: (id: string) => void;
  zone: string;
  ownerKey: string;
  onTask: (task: Task) => void;
  onOpenTask: (id: string) => void;
}) {
  const [liveConsent, setLiveConsent] = useState(false);
  const provider = aiStatus?.providers.find((item) => item.id === providerId);
  const external = Boolean(provider?.external);
  const canSend = Boolean(provider?.ready && (!external || liveConsent));
  const selection = (): api.AISelection =>
    providerId === "mock"
      ? { provider: "mock" }
      : {
          provider: providerId as api.AISelection["provider"],
          live_consent: liveConsent,
        };
  const handledNewRequest = useRef(0);
  const [showHistory, setShowHistory] = useState(false);
  const [rows, setRows] = useState<Conversation[]>([]);
  const [page, setPage] = useState<ConversationPage | null>(null);
  const [draft, setDraft] = useState("");
  useEffect(() => setLiveConsent(false), [providerId, page?.conversation.id]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const guard = useRef(false);
  const activeId = useRef<string | null>(null);
  const loadSequence = useRef(0);
  const recoveryPaused = useRef(false);
  const retry = useRef<{
    signature: string;
    fn: (key: string) => Promise<void>;
    key: string;
  } | null>(null);
  const storageKey = (id: string) => `workroom:capture:${ownerKey}:${id}`;
  function backup(id: string, text: string, version?: number) {
    try {
      localStorage.setItem(
        storageKey(id),
        JSON.stringify({
          text,
          version: version ?? page?.conversation.version,
        }),
      );
    } catch {
      /* explicit server saving remains available */
    }
  }
  function initialDraft(row: Conversation) {
    recoveryPaused.current = false;
    try {
      const raw = localStorage.getItem(storageKey(row.id));
      if (!raw) return row.draft;
      const local = JSON.parse(raw) as { text?: unknown; version?: number };
      if (typeof local.text !== "string" || local.text.length > 20000)
        return row.draft;
      if (local.text !== row.draft && local.version !== row.version) {
        recoveryPaused.current = true;
        setError(
          "A recovered local draft differs from the newer saved conversation. Review it, then choose Save draft or Review proposals explicitly. Automatic saving is paused.",
        );
      }
      return local.text;
    } catch {
      return row.draft;
    }
  }
  function replaceConversation(row: Conversation) {
    setPage((current) =>
      current?.conversation.id === row.id
        ? { ...current, conversation: row }
        : current,
    );
    setRows((current) => [
      row,
      ...current.filter((item) => item.id !== row.id),
    ]);
  }
  async function select(id: string, keepDraft = false) {
    if (activeId.current !== id) retry.current = null;
    if (keepDraft) recoveryPaused.current = true;
    const sequence = ++loadSequence.current;
    activeId.current = id;
    setLoading(true);
    setError("");
    setSaved("");
    try {
      const next = await api.conversation(id);
      if (sequence !== loadSequence.current) return;
      setPage(next);
      if (!keepDraft) setDraft(initialDraft(next.conversation));
      else
        setSaved(
          "Draft kept locally. Choose Save draft or Review proposals when ready.",
        );
      if (onConversation) onConversation(id);
      else history.replaceState(null, "", `/app/assistant?conversation=${id}`);
    } catch (e) {
      if (sequence === loadSequence.current) setError((e as Error).message);
    } finally {
      if (sequence === loadSequence.current) setLoading(false);
    }
  }
  useEffect(() => {
    let active = true;
    api
      .conversations()
      .then(async (list) => {
        if (!active) return;
        setRows(list);
        const requested = new URLSearchParams(location.search).get(
          "conversation",
        );
        if (requested || list[0]) await select(requested || list[0].id);
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      loadSequence.current++;
    };
  }, []);
  async function perform(
    signature: string,
    fn: (key: string) => Promise<void>,
  ) {
    if (guard.current) return;
    guard.current = true;
    setBusy(true);
    setError("");
    if (retry.current?.signature !== signature)
      retry.current = { signature, fn, key: crypto.randomUUID() };
    try {
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
  function create() {
    void perform("new-conversation", async (key) => {
      const row = await api.newConversation(key);
      setRows((current) => [
        row,
        ...current.filter((item) => item.id !== row.id),
      ]);
      await select(row.id);
    });
  }
  useEffect(() => {
    if (
      newConversationRequest > handledNewRequest.current &&
      !loading &&
      !busy
    ) {
      handledNewRequest.current = newConversationRequest;
      create();
    }
  }, [newConversationRequest, loading, busy]);
  function saveDraft(row: Conversation, text: string) {
    return perform(`draft:${row.id}:${text}`, async (key) => {
      const updated = await api.saveDraft(row, text, key);
      recoveryPaused.current = false;
      backup(row.id, text, updated.version);
      replaceConversation(updated);
      setSaved("Draft saved");
    });
  }
  useEffect(() => {
    if (!page || recoveryPaused.current || draft === page.conversation.draft)
      return;
    const row = page.conversation;
    const text = draft;
    const timer = setTimeout(() => {
      if (!guard.current && !retry.current) void saveDraft(row, text);
    }, 900);
    return () => clearTimeout(timer);
  }, [draft, page?.conversation.id, page?.conversation.version]);
  function send() {
    if (!page || !draft.trim() || !canSend) return;
    const options = selection();
    setLiveConsent(false);
    const row = page.conversation,
      text = draft;
    void perform(`capture:${row.id}:${text}:${providerId}`, async (key) => {
      const result = row.task_id
        ? await api.taskRun(row, text, key, options)
        : await api.capture(row, text, key, options);
      onUsage();
      replaceConversation(result.conversation);
      recoveryPaused.current = false;
      setDraft(result.conversation.draft);
      backup(row.id, result.conversation.draft, result.conversation.version);
      // Read failure after an acknowledged commit must never replay a capture with a new key.
      try {
        const next = await api.conversation(row.id);
        if (activeId.current === row.id) setPage(next);
      } catch {
        setError(
          "Capture saved, but the history could not reload. Use Reload conversation.",
        );
      }
      setSaved(
        result.run.state === "failed"
          ? "Capture failed; source and draft saved"
          : row.task_id
            ? "Task reply saved. Review any proposed changes before approving."
            : "Capture saved. Review proposals below.",
      );
    });
  }
  function upload(file: File) {
    if (!page) return;
    setLiveConsent(false);
    const row = page.conversation;
    void perform(
      `upload:${row.id}:${file.name}:${file.size}:${file.lastModified}`,
      async (key) => {
        const asset = await api.uploadSource(row.id, file, key);
        const next = await api.conversation(row.id);
        if (activeId.current === row.id) setPage(next);
        setSaved(
          asset.state === "ready"
            ? "File saved privately. Review its extracted text and proposals."
            : "File saved; extraction failed. Choose another source.",
        );
      },
    );
  }
  function reviewFile(asset: api.SourceAsset) {
    if (!page || !canSend) return;
    const options = selection();
    setLiveConsent(false);
    const row = page.conversation;
    void perform(
      `file-capture:${row.id}:${asset.id}:${providerId}`,
      async (key) => {
        const result = await api.captureSource(row, asset.id, key, options);
        onUsage();
        replaceConversation(result.conversation);
        const next = await api.conversation(row.id);
        if (activeId.current === row.id) setPage(next);
        setSaved(
          result.run.state === "failed"
            ? "File capture failed; saved text is available to retry."
            : "File proposals saved. No tasks created until approval.",
        );
      },
    );
  }
  async function older() {
    if (!page?.messages[0] || guard.current) return;
    guard.current = true;
    const id = page.conversation.id;
    setBusy(true);
    try {
      const previous = await api.conversation(id, page.messages[0].sequence);
      setPage((current) =>
        current?.conversation.id === id
          ? {
              ...current,
              messages: [...previous.messages, ...current.messages],
              runs: [...previous.runs, ...current.runs],
              proposals: [...previous.proposals, ...current.proposals],
              updates: [
                ...(previous.updates || []),
                ...(current.updates || []),
              ],
              has_older: previous.has_older,
            }
          : current,
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      guard.current = false;
      setBusy(false);
    }
  }
  function proposalChanged(updated: Proposal, task?: Task) {
    setPage((current) =>
      current
        ? {
            ...current,
            proposals: current.proposals.map((row) =>
              row.id === updated.id ? updated : row,
            ),
          }
        : current,
    );
    if (task) onTask(task);
  }
  function updateChanged(updated: TaskUpdate, task?: Task) {
    setPage((current) =>
      current
        ? {
            ...current,
            updates: (current.updates || []).map((row) =>
              row.id === updated.id ? updated : row,
            ),
            task: task || current.task,
          }
        : current,
    );
    if (task) onTask(task);
  }
  return (
    <div
      className={`capture-workspace ${compact ? "island-capture" : ""} ${showHistory ? "show-history" : ""}`}
    >
      <aside className="capture-sidebar">
        <div className="capture-list-heading">
          {compact ? (
            <button
              className="history-toggle"
              aria-expanded={showHistory}
              onClick={() => setShowHistory(!showHistory)}
            >
              Conversations <span>{showHistory ? "−" : "+"}</span>
            </button>
          ) : (
            <strong>Conversations</strong>
          )}
          <button
            className="icon-button"
            aria-label="New conversation"
            disabled={busy || loading}
            onClick={create}
          >
            <Plus size={18} />
          </button>
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
      <section className="capture-main" aria-label="Capture assistant">
        <div className="mock-banner">
          <Sparkles size={18} />
          <div>
            <strong>
              {external
                ? `${provider?.label} · ${provider?.model || "configuration needed"}`
                : "Deterministic mock · no external AI calls"}
            </strong>
            <p>
              {external
                ? "AI can miss details or make mistakes. Review every suggestion before approving."
                : "This rule-based preview recognises simple request lines. It may miss tasks. Review every suggestion."}
            </p>
          </div>
          <span>{external ? "Review required" : "0 tokens"}</span>
        </div>
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
          {aiStatus && (
            <small>
              {aiStatus.requests_used}/{aiStatus.request_limit} live requests ·
              ${(aiStatus.reserved_micro_usd / 1000000).toFixed(3)} reserved of
              ${(aiStatus.daily_limit_micro_usd / 1000000).toFixed(2)} / UTC day
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
                {provider?.upstream ? ` via ${provider.upstream}` : ""}.
                Provider data policies apply.
              </span>
            </label>
          )}
        </div>
        {error && (
          <div className="error-banner" role="alert">
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
          </div>
        )}
        {loading ? (
          <div className="empty-state">
            <h3>Opening saved capture…</h3>
          </div>
        ) : !page ? (
          <div className="empty-state">
            <Sparkles size={30} />
            <h2>Turn a request into a clear next step.</h2>
            <p>
              Start a conversation, paste a synthetic email or type a request,
              then review the proposed tasks.
            </p>
            <button className="primary-button" disabled={busy} onClick={create}>
              <Plus size={16} />
              Start a capture
            </button>
          </div>
        ) : (
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
                                ? page.updates?.some(
                                    (item) => item.run_id === run.id,
                                  )
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
                            Your request and draft are retained. No task changes
                            were made and no fallback provider was contacted.
                            {run.error_code === "quota_exhausted" && (
                              <>
                                {" "}
                                The provider reported exhausted credits or an
                                account usage/spend limit. Check its billing and
                                limits before sending a new request; waiting
                                alone may not resolve it.
                              </>
                            )}
                            {run.error_code === "rate_limited" && (
                              <>
                                {" "}
                                The provider returned HTTP 429. This can mean
                                temporary throttling or an account quota/billing
                                restriction. Check the provider's limits and
                                billing before trying again.
                              </>
                            )}
                            {(run.error_code === "rate_limited" ||
                              run.error_code === "quota_exhausted") && (
                              <>
                                {" "}
                                A saved failed action replays its recorded
                                failure. After resolving the cause, send a new
                                request with fresh consent.
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
                                  onRefresh={() =>
                                    select(page.conversation.id, true)
                                  }
                                  onOpenTask={onOpenTask}
                                />
                              ))}
                            {!page.updates?.some(
                              (item) => item.run_id === run.id,
                            ) && (
                              <p className="capture-hint">
                                Read the saved guidance below. Advice has no
                                task effects.
                              </p>
                            )}
                          </>
                        ) : !page.proposals.some(
                            (item) => item.run_id === run.id,
                          ) ? (
                          <p className="capture-hint">
                            No actionable requests found. Try a line such as
                            “Prepare the workshop outline”.
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
        )}
      </section>
    </div>
  );
}

function ProposalCard({
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
