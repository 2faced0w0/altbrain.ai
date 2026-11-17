import { useEffect, useRef, useState } from "react";
import * as api from "./api";
import type { Profile, Task } from "./api";
import type { AssistantView } from "./FloatingAssistant";
import { labels, isActive, Status } from "./taskMeta";
import { localDay } from "./dates";
import { routeFromPath, routeTitle } from "./route";

export function useTrackerApp() {
  const [route, setRoute] = useState(routeFromPath);
  const [assistantConversation, setAssistantConversation] = useState<
    string | null
  >(() => new URLSearchParams(location.search).get("conversation"));
  const [aiOpen, setAiOpen] = useState(
    () =>
      routeFromPath() === "assistant" ||
      new URLSearchParams(location.search).get("ai") === "open",
  );
  const [aiMounted, setAiMounted] = useState(aiOpen);
  const [aiNewRequest, setAiNewRequest] = useState(0);
  const [aiView, setAiView] = useState<AssistantView>("chat");
  const aiCurrentConversation = useRef(assistantConversation);
  function showAi(view: AssistantView = "chat") {
    setAiMounted(true);
    setAiView(view);
    setAiOpen(true);
    const url = new URL(location.href);
    url.searchParams.set("ai", "open");
    if (aiCurrentConversation.current)
      url.searchParams.set("conversation", aiCurrentConversation.current);
    history.replaceState(null, "", url.pathname + url.search);
  }
  function hideAi() {
    setAiOpen(false);
    const url = new URL(location.href);
    url.searchParams.delete("ai");
    history.replaceState(null, "", url.pathname + url.search);
  }
  const [profile, setProfile] = useState<Profile | null>(null);
  const [aiStatus, setAIStatus] = useState<api.AIStatus | null>(null);
  const [aiProvider, setAIProvider] = useState("mock");
  function refreshAI() {
    void api
      .aiStatus()
      .then(setAIStatus)
      .catch(() => {});
  }
  useEffect(() => {
    if (!profile) {
      setAIStatus(null);
      return;
    }
    let active = true;
    api
      .aiStatus()
      .then((status) => {
        if (active) {
          setAIStatus(status);
          setAIProvider(status.default_provider);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [profile?.email]);
  const selectedAI = aiStatus?.providers.find((item) => item.id === aiProvider);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [priority, setPriority] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [focusFilter, setFocusFilter] = useState("all");
  const [createStatus, setCreateStatus] = useState<Status>("inbox");
  const [editor, setEditor] = useState<Task | "new" | null>(null);
  const [selected, setSelected] = useState<Task | null>(null);
  const [help, setHelp] = useState(false);
  const [listMode, setListMode] = useState(false);
  const [pending, setPending] = useState(false);
  const lock = useRef(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const zone = profile?.timezone || "Asia/Kolkata";
  const today = localDay(new Date(), zone);
  const initials =
    profile?.name
      .split(/\s+/)
      .filter(Boolean)
      .map((part) => part[0])
      .slice(0, 2)
      .join("")
      .toUpperCase() || "W";
  const overdue = tasks.filter(
    (t) => isActive(t) && t.due_at && localDay(t.due_at, zone) < today,
  );
  const dueToday = tasks.filter(
    (t) => isActive(t) && t.due_at && localDay(t.due_at, zone) === today,
  );
  const inProgress = tasks.filter((t) => t.status === "in_progress");
  const completed = tasks.filter((t) => t.status === "completed");
  const filtered = tasks.filter(
    (t) =>
      (t.title + t.description + t.category)
        .toLowerCase()
        .includes(search.toLowerCase()) &&
      (priority === "all" || t.priority === priority) &&
      (statusFilter === "all" || t.status === statusFilter) &&
      (focusFilter === "all" ||
        (focusFilter === "today"
          ? dueToday.some((row) => row.id === t.id)
          : overdue.some((row) => row.id === t.id))),
  );

  async function refresh(targetRoute = route) {
    setTasks(await api.loadTasks(targetRoute === "archive"));
  }
  async function start() {
    setLoading(true);
    setError("");
    try {
      setProfile(await api.connect());
      await refresh();
      const id = location.pathname.match(/^\/app\/tasks\/([^/]+)$/)?.[1];
      if (id) setSelected(await api.getTask(id));
    } catch (e) {
      setError(e instanceof api.SignInRequired ? "" : (e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void start();
    const expired = () => {
      setProfile(null);
      setTasks([]);
      setSelected(null);
      setEditor(null);
      setAiOpen(false);
      setAiMounted(false);
      setError("Your session expired. Sign in again; your saved work is kept.");
    };
    window.addEventListener("workroom:session-expired", expired);
    return () =>
      window.removeEventListener("workroom:session-expired", expired);
  }, []);
  const routeRef = useRef(route);
  const announcedRoute = useRef(route);
  useEffect(() => {
    routeRef.current = route;
    document.title = `${routeTitle(route)} · Workroom`;
    // Move focus to the new page's heading after in-app navigation, not on first load.
    if (announcedRoute.current === route) return;
    announcedRoute.current = route;
    document.querySelector<HTMLElement>("main h1")?.focus();
  }, [route]);
  useEffect(() => {
    const pop = () => {
      const previous = routeRef.current;
      const next = routeFromPath();
      setRoute(next);
      setSelected(null);
      // The task list holds archived tasks only on the Archive route, so reload when crossing it.
      if ((next === "archive") !== (previous === "archive"))
        void refresh(next).catch((e) => setError((e as Error).message));
      const params = new URLSearchParams(location.search);
      const open =
        routeFromPath() === "assistant" || params.get("ai") === "open";
      setAiOpen(open);
      if (open) setAiMounted(true);
      const requested = params.get("conversation");
      if (requested && requested !== aiCurrentConversation.current) {
        setAssistantConversation(requested);
        aiCurrentConversation.current = requested;
        setAiNewRequest(0);
      }
    };
    const shortcut = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("popstate", pop);
    window.addEventListener("keydown", shortcut);
    return () => {
      window.removeEventListener("popstate", pop);
      window.removeEventListener("keydown", shortcut);
    };
  }, []);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 4000);
    return () => clearTimeout(timer);
  }, [notice]);
  async function navigate(next: string) {
    if (next === "assistant") showAi("chat");
    else hideAi();
    window.scrollTo(0, 0);
    setRoute(next);
    setSelected(null);
    setSearch("");
    setFocusFilter("all");
    setStatusFilter("all");
    setPriority("all");
    history.pushState(null, "", `/app/${next}`);
    if (next === "archive" || route === "archive") {
      setLoading(true);
      try {
        await refresh(next);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    }
  }
  function openTask(task: Task) {
    setSelected(task);
    history.pushState(null, "", `/app/tasks/${task.id}`);
  }
  function closeTask() {
    setSelected(null);
    history.replaceState(null, "", `/app/${route}`);
  }
  function taskChanged(task: Task) {
    setTasks((rows) => rows.map((row) => (row.id === task.id ? task : row)));
    setSelected((current) => (current?.id === task.id ? task : current));
  }
  async function askAssistant(task: Task) {
    if (lock.current) return;
    lock.current = true;
    setPending(true);
    setError("");
    setNotice("");
    try {
      const row = await api.openTaskAssistant(task.id, crypto.randomUUID());
      setSelected(null);
      setAiNewRequest(0);
      setAssistantConversation(row.id);
      aiCurrentConversation.current = row.id;
      setAiMounted(true);
      setAiView("chat");
      setAiOpen(true);
      history.replaceState(
        null,
        "",
        `/app/${route}?conversation=${row.id}&ai=open`,
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      lock.current = false;
      setPending(false);
    }
  }
  async function moveTask(task: Task, status: Status) {
    if (task.status === status || lock.current) return;
    lock.current = true;
    setPending(true);
    setError("");
    const previous = tasks;
    setTasks((rows) =>
      rows.map((t) => (t.id === task.id ? { ...t, status } : t)),
    );
    try {
      const result = await api.editTask(task, { status }, crypto.randomUUID());
      setTasks((rows) => rows.map((t) => (t.id === task.id ? result.task : t)));
      if (selected?.id === task.id) setSelected(result.task);
      setNotice(`Moved to ${labels[status]}`);
    } catch (e) {
      setTasks(previous);
      setError((e as Error).message);
      try {
        await refresh();
        if (selected?.id === task.id) setSelected(await api.getTask(task.id));
      } catch {
        /* keep the last known server state */
      }
    } finally {
      lock.current = false;
      setPending(false);
    }
  }
  async function archive(task: Task) {
    if (lock.current) return;
    lock.current = true;
    setPending(true);
    try {
      await api.archiveTask(task, crypto.randomUUID());
      await refresh();
      closeTask();
      setNotice(
        task.archived_at
          ? "Task restored to your board"
          : "Task archived. Its history is preserved.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      lock.current = false;
      setPending(false);
    }
  }

  return {
    route,
    setRoute,
    assistantConversation,
    setAssistantConversation,
    aiOpen,
    setAiOpen,
    aiMounted,
    setAiMounted,
    aiNewRequest,
    setAiNewRequest,
    aiView,
    setAiView,
    aiCurrentConversation,
    showAi,
    hideAi,
    profile,
    setProfile,
    aiStatus,
    setAIStatus,
    aiProvider,
    setAIProvider,
    refreshAI,
    selectedAI,
    tasks,
    setTasks,
    loading,
    setLoading,
    error,
    setError,
    notice,
    setNotice,
    search,
    setSearch,
    priority,
    setPriority,
    statusFilter,
    setStatusFilter,
    focusFilter,
    setFocusFilter,
    createStatus,
    setCreateStatus,
    editor,
    setEditor,
    selected,
    setSelected,
    help,
    setHelp,
    listMode,
    setListMode,
    pending,
    setPending,
    lock,
    searchRef,
    zone,
    today,
    initials,
    overdue,
    dueToday,
    inProgress,
    completed,
    filtered,
    refresh,
    start,
    navigate,
    openTask,
    closeTask,
    taskChanged,
    askAssistant,
    moveTask,
    archive,
  };
}

export type TrackerApp = ReturnType<typeof useTrackerApp>;
