import { ShieldCheck, Sparkles } from "lucide-react";
import type { TrackerApp } from "./useTrackerApp";
import { Button } from "./ui/Button";

export function AssistantHome({ app }: { app: TrackerApp }) {
  const { showAi } = app;
  return (
    <section className="assistant-home">
      <span className="assistant-home-icon">
        <Sparkles size={30} />
      </span>
      <span className="eyebrow">WORKROOM AI</span>
      <h2>A conversation, wherever work takes you.</h2>
      <p>
        Capture an idea, bring in a file, or pick up a task. Your conversations
        and drafts stay with you across the workspace.
      </p>
      <Button variant="primary" onClick={() => showAi("chat")}>
        <Sparkles size={17} />
        Open Workroom AI
      </Button>
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
        Choose a configured provider or use the local deterministic mock
      </small>
    </section>
  );
}
