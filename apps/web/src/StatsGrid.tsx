import { CalendarDays, CircleCheck, Clock3, Flag } from "lucide-react";
import type { TrackerApp } from "./useTrackerApp";

export function StatsGrid({ app }: { app: TrackerApp }) {
  const {
    setRoute,
    setSearch,
    setPriority,
    setStatusFilter,
    setFocusFilter,
    setListMode,
    overdue,
    dueToday,
    inProgress,
    completed,
  } = app;
  return (
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
  );
}
