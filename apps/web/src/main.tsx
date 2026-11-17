import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowRight,
  ArrowUpRight,
  Archive,
  CalendarDays,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  Circle,
  CircleCheck,
  Clock3,
  Flag,
  FolderKanban,
  HelpCircle,
  LayoutDashboard,
  LayoutGrid,
  Leaf,
  List,
  LoaderCircle,
  LockKeyhole,
  MoreHorizontal,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Target,
  X,
} from "lucide-react";
import * as api from "./api";
import { Capture } from "./Capture";
import { AuthGate } from "./AuthGate";
import { FloatingAssistant, type AssistantView } from "./FloatingAssistant";
import type { Profile, Task } from "./api";
import "./styles.css";
import "./readability.css";
import "./work.css";
import "./floating-assistant.css";
import { statuses, labels, isActive, Status } from "./taskMeta";
import { localDay } from "./dates";
import { Modal } from "./Modal";
import { TaskCard } from "./TaskCard";
import { TaskRow } from "./TaskRow";
import { TaskEditor } from "./TaskEditor";
import { TaskDetails } from "./TaskDetails";
import { Calendar } from "./Calendar";

const navItems = [
  { route: "today", label: "Today", icon: LayoutDashboard },
  { route: "board", label: "My board", icon: FolderKanban },
  { route: "calendar", label: "Calendar", icon: CalendarDays },
  { route: "assistant", label: "Capture", icon: Sparkles },
];
const routeFromPath = () => {
  const value = location.pathname.split("/")[2];
  return [
    "today",
    "board",
    "calendar",
    "assistant",
    "archive",
    "settings",
  ].includes(value)
    ? value
    : "today";
};

function App() {
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
  useEffect(() => {
    const pop = () => {
      setRoute(routeFromPath());
      setSelected(null);
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

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a
          className="brand"
          href="/app/today"
          onClick={(e) => {
            e.preventDefault();
            void navigate("today");
          }}
        >
          <span className="brand-mark">
            <Leaf size={22} />
          </span>
          workroom<span className="brand-dot">.</span>
        </a>
        <button
          className="workspace-switch"
          onClick={() => void navigate("settings")}
        >
          <span className="workspace-avatar">{initials.slice(0, 1)}</span>
          <span>
            <strong>{profile?.workspace_name || "Private workspace"}</strong>
            <small>Just you. All your work.</small>
          </span>
          <ChevronDown size={14} />
        </button>
        <span className="nav-heading">WORKSPACE</span>
        <nav aria-label="Main navigation">
          {navItems.map((item) => (
            <button
              key={item.route}
              className={`nav-item ${route === item.route ? "active" : ""}`}
              onClick={() => void navigate(item.route)}
            >
              <item.icon size={19} />
              <span>{item.label}</span>
              {item.route === "today" && dueToday.length > 0 && (
                <span className="nav-count">{dueToday.length}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="nav-divider" />
        <span className="nav-heading">COMING TO WORKROOM</span>
        <div className="future-item">
          <Target size={18} />
          <span>Goals</span>
          <small>M4</small>
        </div>
        <div className="future-item">
          <ArrowUpRight size={18} />
          <span>Work reports</span>
          <small>M3</small>
        </div>
        <div className="sidebar-bottom">
          <div className="quiet-card">
            <span className="quiet-icon">
              <ShieldCheck size={19} />
            </span>
            <strong>Your space to focus.</strong>
            <p>
              A private home for your tasks.
              <br />A little clarity for your day.
            </p>
            <span>
              <LockKeyhole size={11} /> Private workspace
            </span>
          </div>
          <button
            className={`nav-item ${route === "archive" ? "active" : ""}`}
            onClick={() => void navigate("archive")}
          >
            <Archive size={18} />
            Archive
          </button>
          <button
            className={`nav-item ${route === "settings" ? "active" : ""}`}
            onClick={() => void navigate("settings")}
          >
            <Settings2 size={18} />
            Settings
          </button>
          <button
            className="profile-button"
            onClick={() => void navigate("settings")}
          >
            <span className="user-avatar">{initials}</span>
            <span>
              <strong>{profile?.name || "Your workspace"}</strong>
              <small>
                {profile?.local_environment
                  ? "Local development"
                  : "Private workspace"}
              </small>
            </span>
            <MoreHorizontal size={17} />
          </button>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            Workspace <ChevronRight size={13} />
            <strong>
              {route === "board"
                ? "My board"
                : route.charAt(0).toUpperCase() + route.slice(1)}
            </strong>
          </div>
          <div className="topbar-right">
            <span className="local-badge">
              <span />{" "}
              {profile?.local_identity
                ? "Local preview"
                : profile?.local_environment
                  ? "Local sign-in"
                  : "Private workspace"}
            </span>
            <button
              className="icon-button"
              aria-label="About this build"
              onClick={() => setHelp(true)}
            >
              <HelpCircle size={19} />
            </button>
            <button
              className="user-avatar small"
              aria-label="Workspace settings"
              onClick={() => void navigate("settings")}
            >
              {initials}
            </button>
          </div>
        </header>
        <main>
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                <span /> YOUR WORK, A LITTLE CLEARER
              </div>
              <h1>
                {route === "today"
                  ? `A little focus goes a long way${String.fromCharCode(46)}`
                  : route === "board"
                    ? "Make room for progress."
                    : route === "calendar"
                      ? "See the days ahead."
                      : route === "assistant"
                        ? "From a request to a clear next step."
                        : route === "archive"
                          ? "Finished here. Kept for later."
                          : "Make yourself at home."}
              </h1>
              <p>
                {route === "today"
                  ? "Here’s what’s happening in your workspace today."
                  : route === "board"
                    ? "From the first idea to the final check. Keep every task moving."
                    : route === "calendar"
                      ? "A clear view of your deadlines, with a little space to plan."
                      : route === "assistant"
                        ? "Paste, review, and approve. Your decisions create the work."
                        : route === "archive"
                          ? "Your archived work and its full history, ready when you need it."
                          : "Your workspace, preferences, and what’s coming next."}
              </p>
            </div>
            <div className="heading-action">
              <span className="today-date">
                <CalendarDays size={15} />
                {new Intl.DateTimeFormat("en", {
                  timeZone: zone,
                  weekday: "short",
                  month: "short",
                  day: "numeric",
                }).format(new Date())}
              </span>
              {route !== "settings" && route !== "assistant" && (
                <button
                  className="primary-button"
                  onClick={() => {
                    setCreateStatus("inbox");
                    setEditor("new");
                  }}
                  disabled={!profile}
                >
                  <Plus size={17} />
                  New task
                </button>
              )}
            </div>
          </div>
          {error && (
            <div role="alert" className="error-banner">
              <span>{error}</span>
              <button onClick={() => void start()}>Retry</button>
              <button aria-label="Dismiss error" onClick={() => setError("")}>
                <X size={16} />
              </button>
            </div>
          )}
          {loading ? (
            <div className="loading-state">
              <LoaderCircle className="spin" size={26} />
              <h3>Opening your workspace…</h3>
              <p>Getting everything in order.</p>
            </div>
          ) : !profile ? (
            <AuthGate onReady={() => void start()} />
          ) : (
            <>
              {(route === "today" || route === "board") && (
                <div className="stats-grid">
                  {[
                    {
                      label: "Due today",
                      count: dueToday.length,
                      icon: CalendarDays,
                      tone: "sage",
                      text: "A good place to start",
                    },
                    {
                      label: "In progress",
                      count: inProgress.length,
                      icon: Clock3,
                      tone: "blue",
                      text: "One step at a time",
                    },
                    {
                      label: "Completed",
                      count: completed.length,
                      icon: CircleCheck,
                      tone: "green",
                      text: "Progress worth noticing",
                    },
                    {
                      label: "Needs attention",
                      count: overdue.length,
                      icon: Flag,
                      tone: "peach",
                      text: "Overdue, not overlooked",
                    },
                  ].map((stat) => (
                    <button
                      key={stat.label}
                      className="stat-card"
                      onClick={() => {
                        setSearch("");
                        setPriority("all");
                        setListMode(stat.label === "Completed");
                        setFocusFilter(
                          stat.label === "Due today"
                            ? "today"
                            : stat.label === "Needs attention"
                              ? "overdue"
                              : "all",
                        );
                        setStatusFilter(
                          stat.label === "In progress"
                            ? "in_progress"
                            : stat.label === "Completed"
                              ? "completed"
                              : "all",
                        );
                        if (stat.label === "Needs attention") {
                          setRoute("today");
                        }
                      }}
                    >
                      <div>
                        <span>{stat.label}</span>
                        <stat.icon size={18} className={stat.tone} />
                      </div>
                      <strong>{String(stat.count).padStart(2, "0")}</strong>
                      <small>{stat.text}</small>
                    </button>
                  ))}
                </div>
              )}
              {(route === "today" ||
                route === "board" ||
                route === "archive") && (
                <>
                  <div className="section-bar">
                    <div className="view-tabs">
                      <button
                        className={!listMode ? "selected" : ""}
                        onClick={() => setListMode(false)}
                      >
                        <LayoutGrid size={15} />
                        {route === "today" ? "Your focus" : "Board view"}
                      </button>
                      <button
                        className={listMode ? "selected" : ""}
                        onClick={() => setListMode(true)}
                      >
                        <List size={16} />
                        List view
                      </button>
                    </div>
                    <span className="task-total">
                      {filtered.length} tasks <span>·</span>{" "}
                      {route === "archive" ? "Archived" : "Personal workspace"}
                    </span>
                  </div>
                  <div className="toolbar">
                    <label className="search-field">
                      <Search size={17} />
                      <input
                        ref={searchRef}
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Find a task…"
                        aria-label="Search tasks"
                      />
                      <kbd>Ctrl K</kbd>
                    </label>
                    <div className="filter-group">
                      <label>
                        <SlidersHorizontal size={15} />
                        <select
                          aria-label="Filter by priority"
                          value={priority}
                          onChange={(e) => setPriority(e.target.value)}
                        >
                          <option value="all">All priorities</option>
                          {["urgent", "high", "medium", "low"].map((p) => (
                            <option key={p} value={p}>
                              {p.charAt(0).toUpperCase() + p.slice(1)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        <Circle size={13} />
                        <select
                          aria-label="Filter by status"
                          value={statusFilter}
                          onChange={(e) => setStatusFilter(e.target.value)}
                        >
                          <option value="all">All statuses</option>
                          {Object.entries(labels).map(([value, label]) => (
                            <option key={value} value={value}>
                              {label}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                  </div>
                  {focusFilter !== "all" && (
                    <div className="focus-filter">
                      Showing{" "}
                      {focusFilter === "today"
                        ? "tasks due today"
                        : "overdue tasks"}
                      <button onClick={() => setFocusFilter("all")}>
                        <X size={12} />
                        Clear
                      </button>
                    </div>
                  )}
                  {!filtered.length ? (
                    <div className="empty-state">
                      <Leaf size={30} />
                      <h2>
                        {search || priority !== "all" || statusFilter !== "all"
                          ? "No tasks match your filters"
                          : route === "archive"
                            ? "Nothing tucked away yet"
                            : "A fresh start for your work"}
                      </h2>
                      <p>
                        {search
                          ? "Try a different search or clear your filters."
                          : "Create a task when you’re ready. Small steps count."}
                      </p>
                      {route !== "archive" && (
                        <button
                          className="primary-button"
                          onClick={() => {
                            setCreateStatus("inbox");
                            setEditor("new");
                          }}
                        >
                          <Plus size={16} />
                          Create a task
                        </button>
                      )}
                    </div>
                  ) : listMode ||
                    route === "archive" ||
                    statusFilter === "cancelled" ? (
                    <div className="task-list">
                      {filtered.map((task) => (
                        <TaskRow
                          key={task.id}
                          task={task}
                          zone={zone}
                          onOpen={openTask}
                          onMove={moveTask}
                          pending={pending}
                        />
                      ))}
                    </div>
                  ) : route === "today" ? (
                    <div className="today-layout">
                      <section className="focus-panel">
                        <div className="panel-heading">
                          <h2>
                            On your radar{" "}
                            <span>{filtered.filter(isActive).length}</span>
                          </h2>
                          <span>Small steps. Real progress.</span>
                        </div>
                        {filtered
                          .filter(isActive)
                          .sort((a, b) =>
                            (a.due_at || "z").localeCompare(b.due_at || "z"),
                          )
                          .slice(0, 6)
                          .map((task) => (
                            <TaskRow
                              key={task.id}
                              task={task}
                              zone={zone}
                              onOpen={openTask}
                              onMove={moveTask}
                              pending={pending}
                            />
                          ))}
                        {!filtered.some(isActive) && (
                          <div className="empty-state compact">
                            <CheckCheck size={25} />
                            <h3>You’re all caught up.</h3>
                            <p>Take a moment to enjoy the breathing room.</p>
                          </div>
                        )}
                        <button
                          className="panel-link"
                          onClick={() => void navigate("board")}
                        >
                          See all work on your board <ArrowRight size={16} />
                        </button>
                      </section>
                      <aside className="focus-aside">
                        <div className="focus-note">
                          <div className="note-top">
                            <span>
                              <Leaf size={17} /> A MOMENT OF CLARITY
                            </span>
                            <span className="note-sun">✳</span>
                          </div>
                          <h2>
                            Less juggling.
                            <br />
                            More doing.
                          </h2>
                          <p>
                            You don’t have to do everything today. Start with
                            the next meaningful thing.
                          </p>
                          <button
                            onClick={() => {
                              setStatusFilter("in_progress");
                              searchRef.current?.focus();
                            }}
                          >
                            Find your next step <ArrowUpRight size={16} />
                          </button>
                          <div className="note-art">
                            <div />
                            <div />
                            <div />
                          </div>
                        </div>
                        <div className="progress-panel">
                          <div>
                            <h3>The bigger picture</h3>
                            <span>This workspace</span>
                          </div>
                          <div className="progress-number">
                            <strong>
                              {Math.round(
                                (completed.length / Math.max(tasks.length, 1)) *
                                  100,
                              )}
                              <small>%</small>
                            </strong>
                            <CircleCheck size={24} />
                          </div>
                          <div className="progress-track">
                            <div
                              style={{
                                width: `${(completed.length / Math.max(tasks.length, 1)) * 100}%`,
                              }}
                            />
                          </div>
                          <p>
                            {completed.length} of {tasks.length} tasks
                            completed. Keep going.
                          </p>
                        </div>
                      </aside>
                    </div>
                  ) : (
                    <div className="board-scroll">
                      <div className="board">
                        {statuses.map((status) => (
                          <section
                            key={status}
                            className={`board-column column-${status}`}
                            onDragOver={(e) => e.preventDefault()}
                            onDrop={(e) => {
                              e.preventDefault();
                              const task = tasks.find(
                                (t) =>
                                  t.id === e.dataTransfer.getData("text/plain"),
                              );
                              if (task) void moveTask(task, status);
                            }}
                            aria-label={`${labels[status]} column`}
                          >
                            <div className="column-heading">
                              <span className={`status-dot ${status}`} />
                              <h2>{labels[status]}</h2>
                              <span className="column-count">
                                {
                                  filtered.filter((t) => t.status === status)
                                    .length
                                }
                              </span>
                              <button
                                aria-label={`Add task to ${labels[status]}`}
                                className="icon-button"
                                onClick={() => {
                                  setCreateStatus(status);
                                  setEditor("new");
                                }}
                              >
                                <Plus size={16} />
                              </button>
                            </div>
                            <div className="column-cards">
                              {filtered
                                .filter((t) => t.status === status)
                                .map((task) => (
                                  <TaskCard
                                    key={task.id}
                                    task={task}
                                    zone={zone}
                                    onOpen={openTask}
                                  />
                                ))}
                              <button
                                className="add-card"
                                onClick={() => {
                                  setCreateStatus(status);
                                  setEditor("new");
                                }}
                              >
                                <Plus size={15} />
                                Add task
                              </button>
                            </div>
                          </section>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
              {route === "calendar" && (
                <Calendar
                  tasks={tasks}
                  zone={zone}
                  onOpen={openTask}
                  onChanged={taskChanged}
                />
              )}
              {route === "assistant" && (
                <section className="assistant-home">
                  <span className="assistant-home-icon">
                    <Sparkles size={30} />
                  </span>
                  <span className="eyebrow">WORKROOM AI</span>
                  <h2>A conversation, wherever work takes you.</h2>
                  <p>
                    Capture an idea, bring in a file, or pick up a task. Your
                    conversations and drafts stay with you across the workspace.
                  </p>
                  <button
                    className="primary-button"
                    onClick={() => showAi("chat")}
                  >
                    <Sparkles size={17} />
                    Open Workroom AI
                  </button>
                  <div className="assistant-home-features">
                    <span>
                      <Sparkles size={17} />
                      Saved conversations
                    </span>
                    <span>
                      <ShieldCheck size={17} />
                      You approve every change
                    </span>
                  </div>
                  <small>
                    Choose a configured provider or use the local deterministic
                    mock
                  </small>
                </section>
              )}
              {route === "settings" && (
                <div className="settings-grid">
                  <section className="settings-card">
                    <span className="card-label">
                      <Settings2 size={17} /> WORKSPACE PREFERENCES
                    </span>
                    <h2>Set your rhythm.</h2>
                    <p>
                      Dates and daily task counts follow your workspace
                      timezone.
                    </p>
                    <label className="form-field">
                      Timezone
                      <select
                        value={zone}
                        onChange={async (e) => {
                          try {
                            setProfile(await api.setTimezone(e.target.value));
                            setNotice("Timezone saved");
                          } catch (err) {
                            setError((err as Error).message);
                          }
                        }}
                      >
                        {[
                          "Asia/Kolkata",
                          "Europe/London",
                          "America/New_York",
                          "America/Los_Angeles",
                          "Asia/Singapore",
                          "UTC",
                        ].map((v) => (
                          <option key={v}>{v}</option>
                        ))}
                      </select>
                    </label>
                    <div className="privacy-line">
                      <LockKeyhole size={17} />
                      <span>
                        <strong>{profile.name}</strong>
                        <small>{profile.email}</small>
                      </span>
                    </div>
                  </section>
                  <section className="settings-card">
                    <span className="card-label">
                      <Sparkles size={17} /> BUILD CHECKPOINT
                    </span>
                    <h2>A solid foundation first.</h2>
                    <div
                      className="ai-provider-settings"
                      aria-label="AI provider availability"
                    >
                      {aiStatus?.providers.map((item) => (
                        <div key={item.id}>
                          <span>
                            {item.label}
                            <small>
                              {item.model ? ` · ${item.model}` : ""}
                            </small>
                          </span>
                          <small>
                            {item.ready
                              ? item.external
                                ? "Configured"
                                : "Available"
                              : "Needs configuration"}
                          </small>
                        </div>
                      ))}
                    </div>
                    <p>
                      Credentials stay on the server. Choose a configured
                      provider in the assistant and approve external processing
                      for each request. Account access and billing availability
                      are checked only when you send.
                    </p>
                    <p>
                      This local build includes tasks, Today, Kanban, calendar,
                      archives and immutable activity history.
                    </p>
                    <div className="build-line">
                      <Check size={16} />
                      Manual task tracking is ready
                    </div>
                    <div className="build-line">
                      <Clock3 size={16} />
                      Provider-backed capture and reviewed updates are
                      available; continuity are upcoming
                    </div>
                    <div className="build-line">
                      <Clock3 size={16} />
                      Goals, exports, and reminders · upcoming
                    </div>
                    {!profile.local_identity && (
                      <button
                        className="secondary-button signout-button"
                        onClick={() =>
                          void api
                            .signOut(profile.email)
                            .catch((e) => setError(e.message))
                        }
                      >
                        Sign out
                      </button>
                    )}
                    <div className="development-note">
                      {profile.local_identity
                        ? "Development identity · synthetic workspace only. Production sign-in and external beta are not configured."
                        : profile.local_environment
                          ? "Local Keycloak sign-in. Accounts and verification emails stay on this computer; external beta is not configured."
                          : "Identity is verified by the configured provider."}
                    </div>
                  </section>
                </div>
              )}
            </>
          )}
          <footer className="page-footer">
            <span>
              <LockKeyhole size={12} /> A private space for your work.
            </span>
            <span>
              Made for a more focused day <Leaf size={13} />
            </span>
          </footer>
        </main>
      </div>
      {profile && (
        <FloatingAssistant
          open={aiOpen}
          view={aiView}
          context={
            route === "board"
              ? "My board"
              : route === "assistant"
                ? "Capture"
                : route.charAt(0).toUpperCase() + route.slice(1)
          }
          tasks={tasks}
          zone={zone}
          aiLabel={
            selectedAI?.external
              ? `${selectedAI.label} · ${selectedAI.ready ? "configured" : "needs setup"}`
              : "deterministic mock"
          }
          externalAI={Boolean(selectedAI?.external)}
          onOpen={showAi}
          onCapture={() => {
            showAi("chat");
            setAiNewRequest((value) => value + 1);
          }}
          onClose={hideAi}
          onTask={(task) => void askAssistant(task)}
        >
          {aiMounted && (
            <Capture
              key={assistantConversation || "workspace-capture"}
              compact
              newConversationRequest={aiNewRequest}
              aiStatus={aiStatus}
              providerId={aiProvider}
              onProvider={setAIProvider}
              onUsage={refreshAI}
              zone={zone}
              ownerKey={profile.email}
              onConversation={(id) => {
                aiCurrentConversation.current = id;
                const url = new URL(location.href);
                url.searchParams.set("conversation", id);
                history.replaceState(null, "", url.pathname + url.search);
              }}
              onTask={(task) => {
                setTasks((rows) => [
                  task,
                  ...rows.filter((row) => row.id !== task.id),
                ]);
                setNotice("Approved task changes saved to your board.");
              }}
              onOpenTask={(id) => {
                hideAi();
                void api
                  .getTask(id)
                  .then(openTask)
                  .catch((e) => setError(e.message));
              }}
            />
          )}
        </FloatingAssistant>
      )}
      {editor && (
        <TaskEditor
          key={editor === "new" ? "new" : `${editor.id}:${editor.version}`}
          task={editor === "new" ? null : editor}
          zone={zone}
          initialStatus={createStatus}
          onClose={() => setEditor(null)}
          onReload={async () => {
            if (editor !== "new") {
              const latest = await api.getTask(editor.id);
              taskChanged(latest);
              setEditor(latest);
            }
          }}
          onSaved={async (task) => {
            setEditor(null);
            setFocusFilter("all");
            setStatusFilter("all");
            setSearch("");
            if (selected?.id === task.id) setSelected(task);
            try {
              await refresh();
            } catch {
              setError(
                "Task saved, but the board could not refresh. Retry loading the workspace.",
              );
            }
            setNotice("Task saved. You’re one step clearer.");
          }}
        />
      )}
      {selected && !editor && (
        <TaskDetails
          task={selected}
          zone={zone}
          pending={pending}
          onClose={closeTask}
          onEdit={() => setEditor(selected)}
          onAsk={() => void askAssistant(selected)}
          onMove={(status) => void moveTask(selected, status)}
          onArchive={() => void archive(selected)}
          onChanged={taskChanged}
          mutationError={error}
        />
      )}
      {help && (
        <Modal
          title="A quieter place for your work"
          onClose={() => setHelp(false)}
        >
          <div className="help-content">
            <span className="brand-mark">
              <Leaf size={25} />
            </span>
            <p>
              Workroom is the working identity for AI Work Tracker. This is the
              first local engineering milestone.
            </p>
            <p>
              Track tasks manually, move them across your board, and see every
              saved change in the activity history. AI, reports, and goals will
              follow in later milestones.
            </p>
            <div className="development-note">
              Local development uses synthetic identities and data. This build
              is not an external beta release.
            </div>
            <button className="primary-button" onClick={() => setHelp(false)}>
              Back to my work <ArrowRight size={16} />
            </button>
          </div>
        </Modal>
      )}
      {notice && (
        <div className="toast" role="status">
          <CircleCheck size={18} />
          {notice}
        </div>
      )}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
