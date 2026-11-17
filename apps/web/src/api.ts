import createClient from "openapi-fetch";
import type { paths, components } from "./schema";
export type Task = components["schemas"]["TaskOut"];
export type TaskCreate = components["schemas"]["TaskCreate"];
export type Changes = components["schemas"]["TaskChanges"];
export type Activity = components["schemas"]["EventOut"];
export type Profile = components["schemas"]["MeOut"];
export type Work = components["schemas"]["TaskWork"];
export type Step = components["schemas"]["StepOut"];
export type Deliverable = components["schemas"]["DeliverableOut"];
export type Conversation = components["schemas"]["ConversationOut"];
export type ConversationPage = components["schemas"]["ConversationPage"];
export type Proposal = components["schemas"]["ProposalOut"];
export type CaptureResult = components["schemas"]["CaptureResult"];
export type DecisionResult = components["schemas"]["DecisionResult"];
export type TaskUpdate = components["schemas"]["TaskUpdateOut"];
let accessToken = "";
let csrfToken = "";
export class SignInRequired extends Error {}
function privateHeaders(write = false): Record<string, string> {
  return {
    ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    ...(write && csrfToken ? { "X-CSRF-Token": csrfToken } : {}),
  };
}
export class RequestError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
const client = createClient<paths>({ baseUrl: "" });
client.use({
  onRequest({ request }) {
    for (const [key, value] of Object.entries(
      privateHeaders(!["GET", "HEAD", "OPTIONS"].includes(request.method)),
    ))
      request.headers.set(key, value);
    return request;
  },
});
function unwrap<T>(result: {
  data?: T;
  error?: unknown;
  response: Response;
}): T {
  if (result.error || result.data === undefined) {
    if (result.response.status === 401)
      window.dispatchEvent(new Event("workroom:session-expired"));
    const error = result.error as { error?: { message?: string } };
    throw new RequestError(
      error?.error?.message || `Request failed (${result.response.status})`,
      result.response.status,
    );
  }
  return result.data;
}
export async function authState() {
  const result = unwrap(await client.GET("/api/v1/auth/session"));
  csrfToken = result.csrf_token || "";
  return result;
}
export async function redeemInvitation(token: string, timezone: string) {
  return unwrap(
    await client.POST("/api/v1/invitations/redeem", {
      body: { token, timezone },
    }),
  );
}
export async function signOut(ownerEmail: string) {
  const result = unwrap(await client.POST("/api/v1/auth/logout"));
  accessToken = "";
  csrfToken = "";
  const prefix = `workroom:capture:${ownerEmail}:`;
  try {
    for (const key of Object.keys(localStorage))
      if (key.startsWith(prefix)) localStorage.removeItem(key);
  } catch {
    /* private mode may restrict storage */
  }
  window.location.assign(result.redirect_url);
}
export async function connect() {
  accessToken = "";
  const state = await authState();
  if (state.mode === "local") {
    const response = await fetch("/api/v1/dev/session", {
      method: "POST",
      headers: { "X-Local-Development": "worktracker" },
    });
    if (!response.ok)
      throw new Error("Local development session is unavailable.");
    accessToken = (await response.json()).access_token;
  } else if (!state.authenticated || !state.has_workspace)
    throw new SignInRequired(
      "Sign in or redeem an invitation to open your workspace.",
    );
  return unwrap(await client.GET("/api/v1/me"));
}
export async function loadTasks(archived = false): Promise<Task[]> {
  const items: Task[] = [];
  let offset = 0;
  while (true) {
    const page = unwrap(
      await client.GET("/api/v1/tasks", {
        params: { query: { archived, limit: 500, offset } },
      }),
    );
    items.push(...page.items);
    if (items.length >= page.total || !page.items.length) return items;
    offset += page.items.length;
  }
}
export async function getTask(id: string) {
  return unwrap(
    await client.GET("/api/v1/tasks/{task_id}", {
      params: { path: { task_id: id } },
    }),
  );
}
export async function history(id: string) {
  return unwrap(
    await client.GET("/api/v1/tasks/{task_id}/events", {
      params: { path: { task_id: id } },
    }),
  );
}
export async function addTask(body: TaskCreate, key: string) {
  return unwrap(
    await client.POST("/api/v1/tasks", {
      body,
      params: { header: { "idempotency-key": key } },
    }),
  );
}
export async function editTask(task: Task, changes: Changes, key: string) {
  return unwrap(
    await client.PATCH("/api/v1/tasks/{task_id}", {
      params: {
        path: { task_id: task.id },
        header: { "idempotency-key": key },
      },
      body: { expected_version: task.version, changes },
    }),
  );
}
export async function archiveTask(task: Task, key: string) {
  const params = {
    path: { task_id: task.id },
    header: { "idempotency-key": key },
  };
  const body = { expected_version: task.version };
  return task.archived_at
    ? unwrap(
        await client.POST("/api/v1/tasks/{task_id}/restore", { params, body }),
      )
    : unwrap(
        await client.POST("/api/v1/tasks/{task_id}/archive", { params, body }),
      );
}
export async function setTimezone(timezone: string) {
  return unwrap(
    await client.PATCH("/api/v1/workspace/preferences", { body: { timezone } }),
  );
}

export async function resolveDeadline(
  localValue: string,
  fold?: 0 | 1,
): Promise<string> {
  const [local_date, local_time] = localValue.split("T");
  return unwrap(
    await client.POST("/api/v1/workspace/resolve-deadline", {
      body: { local_date, local_time, fold },
    }),
  ).due_at;
}

export async function work(id: string): Promise<Work> {
  return unwrap(
    await client.GET("/api/v1/tasks/{task_id}/work", {
      params: { path: { task_id: id } },
    }),
  );
}
export async function writeStep(
  task: Task,
  values: Omit<components["schemas"]["StepWrite"], "expected_version">,
  key: string,
  item_id?: string,
) {
  const body = { ...values, expected_version: task.version };
  const header = { "idempotency-key": key };
  return item_id
    ? unwrap(
        await client.PATCH("/api/v1/tasks/{task_id}/steps/{item_id}", {
          body,
          params: { path: { task_id: task.id, item_id }, header },
        }),
      )
    : unwrap(
        await client.POST("/api/v1/tasks/{task_id}/steps", {
          body,
          params: { path: { task_id: task.id }, header },
        }),
      );
}
export async function writeDeliverable(
  task: Task,
  values: Omit<components["schemas"]["DeliverableWrite"], "expected_version">,
  key: string,
  item_id?: string,
) {
  const body = { ...values, expected_version: task.version };
  const header = { "idempotency-key": key };
  return item_id
    ? unwrap(
        await client.PATCH("/api/v1/tasks/{task_id}/deliverables/{item_id}", {
          body,
          params: { path: { task_id: task.id, item_id }, header },
        }),
      )
    : unwrap(
        await client.POST("/api/v1/tasks/{task_id}/deliverables", {
          body,
          params: { path: { task_id: task.id }, header },
        }),
      );
}
export async function addNote(task: Task, content: string, key: string) {
  return unwrap(
    await client.POST("/api/v1/tasks/{task_id}/notes", {
      body: { content, expected_version: task.version },
      params: {
        path: { task_id: task.id },
        header: { "idempotency-key": key },
      },
    }),
  );
}
export async function reschedule(
  task: Task,
  local_date: string,
  local_time?: string,
  fold?: 0 | 1,
  key: string = crypto.randomUUID(),
) {
  return unwrap(
    await client.POST("/api/v1/tasks/{task_id}/reschedule", {
      body: { expected_version: task.version, local_date, local_time, fold },
      params: {
        path: { task_id: task.id },
        header: { "idempotency-key": key },
      },
    }),
  );
}

export async function conversations(): Promise<Conversation[]> {
  const rows: Conversation[] = [];
  let offset = 0;
  while (true) {
    const page = unwrap(
      await client.GET("/api/v1/conversations", {
        params: { query: { offset, limit: 100 } },
      }),
    );
    rows.push(...page);
    if (page.length < 100) return rows;
    offset += page.length;
  }
}
export async function conversation(
  id: string,
  before_sequence?: number,
): Promise<ConversationPage> {
  return unwrap(
    await client.GET("/api/v1/conversations/{conversation_id}", {
      params: { path: { conversation_id: id }, query: { before_sequence } },
    }),
  );
}
export async function newConversation(key: string): Promise<Conversation> {
  return unwrap(
    await client.POST("/api/v1/conversations", {
      body: { title: "New capture" },
      params: { header: { "idempotency-key": key } },
    }),
  );
}
export async function saveDraft(
  row: Conversation,
  draft: string,
  key: string,
): Promise<Conversation> {
  return unwrap(
    await client.PATCH("/api/v1/conversations/{conversation_id}/draft", {
      body: { expected_version: row.version, draft },
      params: {
        path: { conversation_id: row.id },
        header: { "idempotency-key": key },
      },
    }),
  );
}
export async function capture(
  row: Conversation,
  content: string,
  key: string,
  selection: AISelection = {},
): Promise<CaptureResult> {
  return unwrap(
    await client.POST("/api/v1/conversations/{conversation_id}/runs", {
      body: { expected_version: row.version, content, ...selection },
      params: {
        path: { conversation_id: row.id },
        header: { "idempotency-key": key },
      },
    }),
  );
}
export async function saveProposal(
  row: Proposal,
  task: TaskCreate,
  key: string,
): Promise<Proposal> {
  return unwrap(
    await client.PATCH("/api/v1/ai/proposals/{proposal_id}", {
      body: { expected_version: row.version, task },
      params: {
        path: { proposal_id: row.id },
        header: { "idempotency-key": key },
      },
    }),
  );
}
export async function decide(
  row: Proposal,
  decision: "approve" | "reject",
  task: TaskCreate | null,
  key: string,
): Promise<DecisionResult> {
  return unwrap(
    await client.POST("/api/v1/ai/proposals/{proposal_id}/decision", {
      body: { expected_version: row.version, decision, task },
      params: {
        path: { proposal_id: row.id },
        header: { "idempotency-key": key },
      },
    }),
  );
}
export async function taskSource(task_id: string) {
  return unwrap(
    await client.GET("/api/v1/tasks/{task_id}/source", {
      params: { path: { task_id } },
    }),
  );
}

export async function openTaskAssistant(task_id: string, key: string) {
  return unwrap(
    await client.POST("/api/v1/tasks/{task_id}/assistant", {
      params: { path: { task_id }, header: { "idempotency-key": key } },
    }),
  );
}
export async function taskRun(
  row: Conversation,
  content: string,
  key: string,
  selection: AISelection = {},
) {
  return unwrap(
    await client.POST("/api/v1/conversations/{conversation_id}/task-runs", {
      body: { expected_version: row.version, content, ...selection },
      params: {
        path: { conversation_id: row.id },
        header: { "idempotency-key": key },
      },
    }),
  );
}
export async function decideTaskUpdate(
  row: TaskUpdate,
  decision: "approve" | "reject",
  changes: Changes | null,
  key: string,
) {
  return unwrap(
    await client.POST("/api/v1/ai/task-updates/{proposal_id}/decision", {
      body: { expected_version: row.version, decision, changes },
      params: {
        path: { proposal_id: row.id },
        header: { "idempotency-key": key },
      },
    }),
  );
}

export type SourceAsset = components["schemas"]["SourceOut"];
export async function uploadSource(
  conversationId: string,
  file: File,
  key: string,
): Promise<SourceAsset> {
  const response = await fetch(
    `/api/v1/conversations/${encodeURIComponent(conversationId)}/sources`,
    {
      method: "POST",
      headers: {
        ...privateHeaders(true),
        "Content-Type": "application/octet-stream",
        "X-File-Name": encodeURIComponent(file.name),
        "Idempotency-Key": key,
      },
      body: file,
    },
  );
  const data = await response.json();
  if (response.status === 401)
    window.dispatchEvent(new Event("workroom:session-expired"));
  if (!response.ok)
    throw new RequestError(
      data?.error?.message || "File upload failed",
      response.status,
    );
  return data as SourceAsset;
}
export async function sourceText(assetId: string) {
  return unwrap(
    await client.GET("/api/v1/sources/{asset_id}", {
      params: { path: { asset_id: assetId } },
    }),
  );
}
export async function downloadSource(asset: SourceAsset) {
  const response = await fetch(
    `/api/v1/sources/${encodeURIComponent(asset.id)}/download`,
    { headers: privateHeaders() },
  );
  if (!response.ok) {
    if (response.status === 401)
      window.dispatchEvent(new Event("workroom:session-expired"));
    const data = await response.json();
    throw new RequestError(
      data?.error?.message || "Download failed",
      response.status,
    );
  }
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = asset.filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
export async function captureSource(
  row: Conversation,
  assetId: string,
  key: string,
  selection: AISelection = {},
) {
  return unwrap(
    await client.POST("/api/v1/conversations/{conversation_id}/runs", {
      body: {
        expected_version: row.version,
        content: "",
        asset_id: assetId,
        ...selection,
      },
      params: {
        path: { conversation_id: row.id },
        header: { "idempotency-key": key },
      },
    }),
  );
}

export type AIStatus = components["schemas"]["AIStatus"];
export type AISelection = Pick<
  components["schemas"]["CaptureWrite"],
  "provider" | "live_consent"
>;
export async function aiStatus(): Promise<AIStatus> {
  return unwrap(await client.GET("/api/v1/ai/status"));
}
