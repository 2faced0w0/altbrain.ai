import type { Task } from "./api";

export const statuses = [
  "inbox",
  "planned",
  "in_progress",
  "waiting",
  "blocked",
  "in_review",
  "completed",
] as const;
export type Status = Task["status"];
export const labels: Record<Status, string> = {
  inbox: "Inbox",
  planned: "Planned",
  in_progress: "In progress",
  waiting: "Waiting",
  blocked: "Blocked",
  in_review: "In review",
  completed: "Completed",
  cancelled: "Cancelled",
};
export const isActive = (task: Task) =>
  !["completed", "cancelled"].includes(task.status) && !task.archived_at;
