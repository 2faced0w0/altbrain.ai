import { useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import type { Task } from "./api";
import { labels } from "./taskMeta";
import { localDay } from "./dates";
import { Modal } from "./Modal";
import { TaskSchedule } from "./TaskSchedule";
import { Button } from "./ui/Button";
import { Field } from "./ui/Field";

export function Calendar({
  tasks,
  zone,
  onOpen,
  onChanged,
}: {
  tasks: Task[];
  zone: string;
  onOpen: (task: Task) => void;
  onChanged: (task: Task) => void;
}) {
  const [anchor, setAnchor] = useState(
    new Date(localDay(new Date(), zone) + "T12:00:00"),
  );
  const [schedule, setSchedule] = useState<{ task: Task; date: string } | null>(
    null,
  );
  const [mode, setMode] = useState("month");
  const [calendarStatus, setCalendarStatus] = useState("all");
  const [selectedDate, setSelectedDate] = useState(localDay(new Date(), zone));
  const year = anchor.getFullYear(),
    month = anchor.getMonth();
  const first = new Date(year, month, 1);
  const start = new Date(year, month, 1 - ((first.getDay() + 6) % 7));
  const dayKey = (date: Date) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  const selectedAnchor = new Date(selectedDate + "T12:00:00");
  const weekStart = new Date(selectedAnchor);
  weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));
  const dates = Array.from(
    { length: mode === "month" ? 42 : mode === "week" ? 7 : 1 },
    (_, i) => {
      const day = new Date(
        mode === "month" ? start : mode === "week" ? weekStart : selectedAnchor,
      );
      day.setDate(day.getDate() + i);
      return day;
    },
  );
  function shift(direction: number) {
    if (mode === "month") {
      const next = new Date(year, month + direction, 1);
      setAnchor(next);
      setSelectedDate(dayKey(next));
    } else {
      const next = new Date(selectedAnchor);
      next.setDate(next.getDate() + direction * (mode === "week" ? 7 : 1));
      setSelectedDate(dayKey(next));
      setAnchor(next);
    }
  }
  return (
    <section className="calendar-panel">
      <div className="calendar-toolbar">
        <h2>
          {mode === "week"
            ? `${new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(dates[0])} – ${new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(dates[6])}, ${dates[6].getFullYear()}`
            : new Intl.DateTimeFormat("en", {
                month: "long",
                year: "numeric",
                ...(mode === "day" ? { day: "numeric" as const } : {}),
              }).format(anchor)}
        </h2>
        <div className="calendar-controls">
          <Button
            variant="secondary"
            onClick={() => {
              setAnchor(new Date(localDay(new Date(), zone) + "T12:00:00"));
              setSelectedDate(localDay(new Date(), zone));
            }}
          >
            Today
          </Button>
          <Button
            variant="icon"
            aria-label="Previous period"
            onClick={() => shift(-1)}
          >
            <ChevronLeft size={18} />
          </Button>
          <Button
            variant="icon"
            aria-label="Next period"
            onClick={() => shift(1)}
          >
            <ChevronRight size={18} />
          </Button>
          <select
            aria-label="Calendar view"
            value={mode}
            onChange={(e) => setMode(e.target.value)}
          >
            <option value="month">Month</option>
            <option value="week">Week</option>
            <option value="day">Day</option>
          </select>
          <select
            aria-label="Calendar status"
            value={calendarStatus}
            onChange={(e) => setCalendarStatus(e.target.value)}
          >
            <option value="all">All statuses</option>
            {Object.entries(labels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className={`calendar-grid ${mode === "day" ? "day-mode" : ""}`}>
        {(mode === "day"
          ? ["Your day"]
          : ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
        ).map((day) => (
          <div className="calendar-weekday" key={day}>
            {day}
          </div>
        ))}
        {dates.map((day) => {
          const key = dayKey(day);
          const due = tasks.filter(
            (t) =>
              t.due_at &&
              localDay(t.due_at, zone) === key &&
              (calendarStatus === "all"
                ? t.status !== "cancelled"
                : t.status === calendarStatus),
          );
          return (
            <div
              key={key}
              aria-label={`Schedule for ${key}`}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const task = tasks.find(
                  (t) => t.id === e.dataTransfer.getData("text/plain"),
                );
                if (task) setSchedule({ task, date: key });
              }}
              className={`calendar-cell ${day.getMonth() !== month ? "muted-day" : ""} ${key === localDay(new Date(), zone) ? "current-day" : ""}`}
            >
              <button
                className="calendar-date"
                aria-label={`View ${key}`}
                onClick={() => {
                  setSelectedDate(key);
                  setAnchor(day);
                  setMode("day");
                }}
              >
                {day.getDate()}
              </button>
              {due.map((task) => (
                <button
                  key={task.id}
                  className={`calendar-task ${task.status}`}
                  draggable
                  onDragStart={(e) =>
                    e.dataTransfer.setData("text/plain", task.id)
                  }
                  onClick={() => onOpen(task)}
                >
                  <span className={`status-dot ${task.status}`} />
                  {task.title}
                </button>
              ))}
            </div>
          );
        })}
      </div>
      <div className="calendar-footnote">
        <CalendarDays size={14} />
        Dates shown in {zone}. {tasks.filter((t) => !t.due_at).length} undated
        tasks stay on your board.
      </div>
      <div className="calendar-reschedule">
        <Field>
          Reschedule any task
          <select
            aria-label="Choose task to reschedule"
            value=""
            onChange={(e) => {
              const task = tasks.find((t) => t.id === e.target.value);
              if (task)
                setSchedule({
                  task,
                  date: task.due_at
                    ? localDay(task.due_at, zone)
                    : localDay(new Date(), zone),
                });
            }}
          >
            <option value="">Choose a task, including undated work…</option>
            {tasks
              .filter((t) => t.status !== "cancelled")
              .map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title}
                </option>
              ))}
          </select>
        </Field>
      </div>
      {schedule && (
        <Modal
          title={`Reschedule ${schedule.task.title}`}
          onClose={() => setSchedule(null)}
        >
          <div className="schedule-dialog">
            <TaskSchedule
              task={schedule.task}
              zone={zone}
              date={schedule.date}
              onChanged={onChanged}
              onSaved={() => setSchedule(null)}
            />
          </div>
        </Modal>
      )}
    </section>
  );
}
