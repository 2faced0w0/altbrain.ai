import { CalendarDays, Plus } from "lucide-react";
import type { TrackerApp } from "./useTrackerApp";
import { Button } from "./ui/Button";

export function PageHeading({ app }: { app: TrackerApp }) {
  const { route, profile, setCreateStatus, setEditor, zone } = app;
  return (
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
          <Button
            variant="primary"
            onClick={() => {
              setCreateStatus("inbox");
              setEditor("new");
            }}
            disabled={!profile}
          >
            <Plus size={17} />
            New task
          </Button>
        )}
      </div>
    </div>
  );
}
