import { test, expect, type Page } from "@playwright/test";

async function createTask(page: Page, title: string) {
  await page.goto("/app/board");
  await page.getByRole("button", { name: "New task", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Task title", exact: true })
    .fill(title);
  await page.getByRole("button", { name: "Create task", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("textbox", { name: "Search tasks" }).fill(title);
  await page.locator(".task-card").filter({ hasText: title }).click();
  const id = new URL(page.url()).pathname.split("/").pop()!;
  await page
    .getByRole("button", { name: "Ask assistant", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Selected task context" }),
  ).toContainText(title);
  return id;
}
async function auth(page: Page) {
  const response = await page.request.post("/api/v1/dev/session", {
    headers: { "X-Local-Development": "worktracker" },
  });
  return { Authorization: "Bearer " + (await response.json()).access_token };
}
async function send(page: Page, content: string) {
  await page
    .getByRole("textbox", { name: "Ask about this task", exact: true })
    .fill(content);
  await page
    .getByRole("button", { name: "Send task request", exact: true })
    .click();
}

test("task guidance is read-only, reviewed completion updates the same task, and history survives reload", async ({
  page,
}) => {
  const title = "Task assistant " + Date.now();
  const id = await createTask(page, title);
  const chat = page.url();
  const headers = await auth(page);
  await send(page, "What should I do next?");
  await expect(page.locator(".capture-message.assistant")).toContainText(title);
  await expect(page.locator(".task-update-card")).toHaveCount(0);
  expect(
    (await (await page.request.get(`/api/v1/tasks/${id}`, { headers })).json())
      .version,
  ).toBe(1);
  await send(page, "Mark this done");
  await expect(page.locator(".task-update-card")).toHaveCount(1);
  await expect(page.locator(".update-diff")).toContainText("inbox");
  await expect(page.locator(".update-diff")).toContainText("completed");
  expect(
    (await (await page.request.get(`/api/v1/tasks/${id}`, { headers })).json())
      .status,
  ).toBe("inbox");
  if (process.env.ASSISTANT_SCREENSHOT_PATH) {
    await page.locator(".task-update-card").scrollIntoViewIfNeeded();
    await page.screenshot({ path: process.env.ASSISTANT_SCREENSHOT_PATH });
  }
  await page
    .getByRole("button", { name: "Approve changes", exact: true })
    .click();
  await expect(
    page.getByText("Task update approved", { exact: true }),
  ).toBeVisible();
  const current = await (
    await page.request.get(`/api/v1/tasks/${id}`, { headers })
  ).json();
  expect(current.id).toBe(id);
  expect(current.status).toBe("completed");
  expect(current.version).toBe(2);
  expect(
    (
      await (
        await page.request.get("/api/v1/tasks?q=" + encodeURIComponent(title), {
          headers,
        })
      ).json()
    ).total,
  ).toBe(1);
  await page
    .getByRole("button", { name: "Open selected task", exact: true })
    .click();
  await expect(page.locator(".timeline-event")).toHaveCount(2);
  await expect(page.locator(".timeline-event").first()).toContainText(
    "task updated from proposal",
  );
  await page
    .getByRole("button", { name: "Ask assistant", exact: true })
    .click();
  await expect(page).toHaveURL(chat);
  await page.reload();
  await expect(
    page.getByRole("region", { name: "Selected task context" }),
  ).toContainText(title);
  await expect(
    page.getByText("Task update approved", { exact: true }),
  ).toBeVisible();
});

test("a stale proposal cannot overwrite a concurrent task edit and a fresh request preserves that edit", async ({
  page,
}) => {
  const id = await createTask(page, "Stale assistant " + Date.now());
  const headers = await auth(page);
  await send(page, "Mark this done");
  await expect(page.locator(".task-update-card")).toHaveCount(1);
  const edit = await page.request.patch(`/api/v1/tasks/${id}`, {
    headers: { ...headers, "Idempotency-Key": crypto.randomUUID() },
    data: { expected_version: 1, changes: { priority: "urgent" } },
  });
  expect(edit.ok()).toBeTruthy();
  await page
    .getByRole("button", { name: "Approve changes", exact: true })
    .click();
  await expect(
    page.locator(".task-update-card").getByRole("alert"),
  ).toContainText("changed after");
  await page
    .locator(".task-update-card")
    .getByRole("button", { name: "Refresh task context", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Approve changes", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Reject update", exact: true })
    .click();
  await expect(
    page.getByText("Task update rejected", { exact: true }),
  ).toBeVisible();
  await send(page, "Mark this done");
  await expect(page.locator(".task-update-card")).toHaveCount(1);
  await page
    .getByRole("button", { name: "Approve changes", exact: true })
    .click();
  await expect(
    page.getByText("Task update approved", { exact: true }),
  ).toBeVisible();
  const current = await (
    await page.request.get(`/api/v1/tasks/${id}`, { headers })
  ).json();
  expect(current.status).toBe("completed");
  expect(current.priority).toBe("urgent");
  expect(current.version).toBe(3);
});

test("lost update approval responses replay exactly once on the existing task", async ({
  page,
}) => {
  const id = await createTask(page, "Replay update " + Date.now());
  const headers = await auth(page);
  await send(page, "Set priority high");
  await expect(page.locator(".task-update-card")).toHaveCount(1);
  let interrupted = false;
  await page.route("**/api/v1/ai/task-updates/*/decision", async (route) => {
    if (!interrupted) {
      interrupted = true;
      await route.fetch();
      await route.abort("failed");
    } else await route.continue();
  });
  await page
    .getByRole("button", { name: "Approve changes", exact: true })
    .click();
  await expect(
    page.locator(".task-update-card").getByRole("alert"),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Approve changes", exact: true })
    .click();
  await expect(
    page.getByText("Task update approved", { exact: true }),
  ).toBeVisible();
  expect(
    (await (await page.request.get(`/api/v1/tasks/${id}`, { headers })).json())
      .version,
  ).toBe(2);
  expect(
    await (
      await page.request.get(`/api/v1/tasks/${id}/events`, { headers })
    ).json(),
  ).toHaveLength(2);
});

test("uncertain deadlines need exact user input and rejection has no progress effects", async ({
  page,
}) => {
  const id = await createTask(page, "Precise update " + Date.now());
  const headers = await auth(page);
  await send(page, "Move deadline to Friday");
  await expect(page.locator(".proposal-question")).toContainText(
    "No date has been inferred",
  );
  await expect(
    page.getByRole("button", { name: "Approve changes", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("combobox", { name: "Deadline action", exact: true })
    .selectOption("set");
  await page
    .locator('.task-update-card input[type="datetime-local"]')
    .fill("2026-10-30T09:30");
  await page
    .getByRole("button", { name: "Approve changes", exact: true })
    .click();
  await expect(
    page.getByText("Task update approved", { exact: true }),
  ).toBeVisible();
  expect(
    (await (await page.request.get(`/api/v1/tasks/${id}`, { headers })).json())
      .due_at,
  ).toBe("2026-10-30T04:00:00Z");
  await send(page, "Set progress 60%");
  await expect(page.locator(".task-update-card")).toHaveCount(1);
  await expect(
    page.getByRole("spinbutton", {
      name: "Proposed manual progress (%)",
      exact: true,
    }),
  ).toHaveValue("60");
  await page
    .getByRole("button", { name: "Reject update", exact: true })
    .click();
  await expect(
    page.getByText("Task update rejected", { exact: true }),
  ).toBeVisible();
  const current = await (
    await page.request.get(`/api/v1/tasks/${id}`, { headers })
  ).json();
  expect(current.manual_progress).toBe(0);
  expect(current.version).toBe(2);
});

test("mobile conversation switching retains the correct fixed task context", async ({
  page,
}) => {
  const firstTitle = "Context A " + Date.now();
  const first = await createTask(page, firstTitle);
  const firstUrl = page.url();
  await send(page, "Mark this done");
  await expect(page.locator(".task-update-card")).toHaveCount(1);
  const secondTitle = "Context B " + Date.now();
  const second = await createTask(page, secondTitle);
  const secondUrl = page.url();
  expect(secondUrl).not.toBe(firstUrl);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("region", { name: "Selected task context" }),
  ).toContainText(secondTitle);
  await expect(page.locator(".task-update-card")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Conversations", exact: false })
    .click();
  await page
    .locator(".conversation-item")
    .filter({ hasText: firstTitle })
    .click();
  await expect(
    page.getByRole("region", { name: "Selected task context" }),
  ).toContainText(firstTitle);
  await expect(page.locator(".task-update-card")).toHaveCount(1);
  await page
    .getByRole("button", { name: "Approve changes", exact: true })
    .click();
  await expect(
    page.getByText("Task update approved", { exact: true }),
  ).toBeVisible();
  const headers = await auth(page);
  expect(
    (
      await (
        await page.request.get(`/api/v1/tasks/${first}`, { headers })
      ).json()
    ).status,
  ).toBe("completed");
  expect(
    (
      await (
        await page.request.get(`/api/v1/tasks/${second}`, { headers })
      ).json()
    ).status,
  ).toBe("inbox");
  await page.reload();
  await expect(
    page.getByRole("region", { name: "Selected task context" }),
  ).toContainText(firstTitle);
  await expect(
    page.getByText("Task update approved", { exact: true }),
  ).toBeVisible();
});
