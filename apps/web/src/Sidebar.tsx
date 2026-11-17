import {
  ArrowUpRight,
  Archive,
  CalendarDays,
  ChevronDown,
  FolderKanban,
  LayoutDashboard,
  Leaf,
  LockKeyhole,
  MoreHorizontal,
  Settings2,
  ShieldCheck,
  Sparkles,
  Target,
} from "lucide-react";
import type { TrackerApp } from "./useTrackerApp";

const navItems = [
  { route: "today", label: "Today", icon: LayoutDashboard },
  { route: "board", label: "My board", icon: FolderKanban },
  { route: "calendar", label: "Calendar", icon: CalendarDays },
  { route: "assistant", label: "Capture", icon: Sparkles },
];

export function Sidebar({ app }: { app: TrackerApp }) {
  const { route, profile, initials, dueToday, navigate } = app;
  return (
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
            aria-current={route === item.route ? "page" : undefined}
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
          aria-current={route === "archive" ? "page" : undefined}
          onClick={() => void navigate("archive")}
        >
          <Archive size={18} />
          Archive
        </button>
        <button
          className={`nav-item ${route === "settings" ? "active" : ""}`}
          aria-current={route === "settings" ? "page" : undefined}
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
  );
}
