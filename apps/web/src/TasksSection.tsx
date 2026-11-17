import {
  ArrowRight,
  ArrowUpRight,
  CheckCheck,
  Circle,
  CircleCheck,
  LayoutGrid,
  Leaf,
  List,
  Plus,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { statuses, labels, isActive } from "./taskMeta";
import { TaskCard } from "./TaskCard";
import { TaskRow } from "./TaskRow";
import type { TrackerApp } from "./useTrackerApp";
import { Button } from "./ui/Button";
import { EmptyState } from "./ui/EmptyState";

export function TasksSection({ app }: { app: TrackerApp }) {
  const {
    route,
    tasks,
    search,
    setSearch,
    priority,
    setPriority,
    statusFilter,
    setStatusFilter,
    focusFilter,
    setFocusFilter,
    setCreateStatus,
    setEditor,
    listMode,
    setListMode,
    pending,
    searchRef,
    zone,
    completed,
    filtered,
    navigate,
    openTask,
    moveTask,
  } = app;
  return (
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
          {focusFilter === "today" ? "tasks due today" : "overdue tasks"}
          <button onClick={() => setFocusFilter("all")}>
            <X size={12} />
            Clear
          </button>
        </div>
      )}
      {!filtered.length ? (
        <EmptyState>
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
            <Button
              variant="primary"
              onClick={() => {
                setCreateStatus("inbox");
                setEditor("new");
              }}
            >
              <Plus size={16} />
              Create a task
            </Button>
          )}
        </EmptyState>
      ) : listMode || route === "archive" || statusFilter === "cancelled" ? (
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
                On your radar <span>{filtered.filter(isActive).length}</span>
              </h2>
              <span>Small steps. Real progress.</span>
            </div>
            {filtered
              .filter(isActive)
              .sort((a, b) => (a.due_at || "z").localeCompare(b.due_at || "z"))
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
              <EmptyState className="compact">
                <CheckCheck size={25} />
                <h3>You’re all caught up.</h3>
                <p>Take a moment to enjoy the breathing room.</p>
              </EmptyState>
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
                You don’t have to do everything today. Start with the next
                meaningful thing.
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
                    (completed.length / Math.max(tasks.length, 1)) * 100,
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
                {completed.length} of {tasks.length} tasks completed. Keep
                going.
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
                    (t) => t.id === e.dataTransfer.getData("text/plain"),
                  );
                  if (task) void moveTask(task, status);
                }}
                aria-label={`${labels[status]} column`}
              >
                <div className="column-heading">
                  <span className={`status-dot ${status}`} />
                  <h2>{labels[status]}</h2>
                  <span className="column-count">
                    {filtered.filter((t) => t.status === status).length}
                  </span>
                  <Button
                    variant="icon"
                    aria-label={`Add task to ${labels[status]}`}
                    onClick={() => {
                      setCreateStatus(status);
                      setEditor("new");
                    }}
                  >
                    <Plus size={16} />
                  </Button>
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
  );
}
