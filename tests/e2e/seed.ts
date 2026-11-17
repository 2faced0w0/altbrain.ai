import { expect, type Page } from "@playwright/test";

// Seeds tasks through the app's own API so each test controls its data.
export async function seeder(page: Page) {
  const session = await page.request.post("/api/v1/dev/session", {
    headers: { "X-Local-Development": "worktracker" },
  });
  const { access_token } = await session.json();
  const headers = { Authorization: `Bearer ${access_token}` };
  const create = async (title: string, extra: Record<string, unknown> = {}) => {
    const res = await page.request.post("/api/v1/tasks", {
      headers: { ...headers, "Idempotency-Key": crypto.randomUUID() },
      data: {
        title,
        description: "Seeded test task",
        category: "Test",
        priority: "medium",
        status: "planned",
        due_at: null,
        ...extra,
      },
    });
    expect(res.ok()).toBeTruthy();
    return (await res.json()).task as { id: string; version: number };
  };
  const archive = async (task: { id: string; version: number }) => {
    const res = await page.request.post(`/api/v1/tasks/${task.id}/archive`, {
      headers: { ...headers, "Idempotency-Key": crypto.randomUUID() },
      data: { expected_version: task.version },
    });
    expect(res.ok()).toBeTruthy();
  };
  return { create, archive };
}
