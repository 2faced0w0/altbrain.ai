import React from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowRight,
  ChevronRight,
  CircleCheck,
  HelpCircle,
  Leaf,
  LoaderCircle,
  LockKeyhole,
  X,
} from "lucide-react";
import * as api from "./api";
import { Capture } from "./Capture";
import { AuthGate } from "./AuthGate";
import { FloatingAssistant } from "./FloatingAssistant";
import "./tokens.css";
import "./styles.css";
import "./readability.css";
import "./work.css";
import "./floating-assistant.css";
import { Modal } from "./Modal";
import { TaskEditor } from "./TaskEditor";
import { TaskDetails } from "./TaskDetails";
import { Calendar } from "./Calendar";
import { Sidebar } from "./Sidebar";
import { PageHeading } from "./PageHeading";
import { StatsGrid } from "./StatsGrid";
import { TasksSection } from "./TasksSection";
import { AssistantHome } from "./AssistantHome";
import { SettingsPage } from "./SettingsPage";
import { useTrackerApp } from "./useTrackerApp";
import { Banner } from "./ui/Banner";
import { Button } from "./ui/Button";

function App() {
  const app = useTrackerApp();
  const {
    route,
    assistantConversation,
    aiOpen,
    aiMounted,
    aiNewRequest,
    setAiNewRequest,
    aiView,
    aiCurrentConversation,
    showAi,
    hideAi,
    profile,
    aiStatus,
    aiProvider,
    setAIProvider,
    refreshAI,
    selectedAI,
    tasks,
    setTasks,
    loading,
    error,
    setError,
    notice,
    setNotice,
    setSearch,
    setStatusFilter,
    setFocusFilter,
    createStatus,
    editor,
    setEditor,
    selected,
    setSelected,
    help,
    setHelp,
    pending,
    zone,
    initials,
    refresh,
    start,
    navigate,
    openTask,
    closeTask,
    taskChanged,
    askAssistant,
    moveTask,
    archive,
  } = app;

  return (
    <div className="app-shell">
      <Sidebar app={app} />
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
            <Button
              variant="icon"
              aria-label="About this build"
              onClick={() => setHelp(true)}
            >
              <HelpCircle size={19} />
            </Button>
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
          <PageHeading app={app} />
          {error && (
            <Banner>
              <span>{error}</span>
              <button onClick={() => void start()}>Retry</button>
              <button aria-label="Dismiss error" onClick={() => setError("")}>
                <X size={16} />
              </button>
            </Banner>
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
                <StatsGrid app={app} />
              )}
              {(route === "today" ||
                route === "board" ||
                route === "archive") && <TasksSection app={app} />}
              {route === "calendar" && (
                <Calendar
                  tasks={tasks}
                  zone={zone}
                  onOpen={openTask}
                  onChanged={taskChanged}
                />
              )}
              {route === "assistant" && <AssistantHome app={app} />}
              {route === "settings" && (
                <SettingsPage app={app} profile={profile} />
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
            <Button variant="primary" onClick={() => setHelp(false)}>
              Back to my work <ArrowRight size={16} />
            </Button>
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
