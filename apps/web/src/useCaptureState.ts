import { useEffect, useRef, useState } from "react";
import * as api from "./api";
import type {
  Conversation,
  ConversationPage,
  Proposal,
  Task,
  TaskUpdate,
} from "./api";

export type CaptureProps = {
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
};

export function useCaptureState({
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
}: CaptureProps) {
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

  return {
    zone,
    ownerKey,
    onTask,
    onOpenTask,
    compact,
    newConversationRequest,
    onConversation,
    aiStatus,
    providerId,
    onProvider,
    onUsage,
    liveConsent,
    setLiveConsent,
    provider,
    external,
    canSend,
    selection,
    handledNewRequest,
    showHistory,
    setShowHistory,
    rows,
    setRows,
    page,
    setPage,
    draft,
    setDraft,
    busy,
    setBusy,
    loading,
    setLoading,
    error,
    setError,
    saved,
    setSaved,
    guard,
    activeId,
    loadSequence,
    recoveryPaused,
    retry,
    storageKey,
    backup,
    initialDraft,
    replaceConversation,
    select,
    perform,
    create,
    saveDraft,
    send,
    upload,
    reviewFile,
    older,
    proposalChanged,
    updateChanged,
  };
}

export type CaptureApp = ReturnType<typeof useCaptureState>;
