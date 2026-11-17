import { test, expect, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import path from "node:path";

// Screenshots of the main pages with fixed synthetic data, written to
// .local/visual/<VISUAL_LABEL>/ (git-ignored) so design changes can be diffed.
const label = process.env.VISUAL_LABEL || "current";
const outDir = path.join(".local", "visual", label);
mkdirSync(outDir, { recursive: true });

const DESKTOP = { width: 1440, height: 1000 };
const MOBILE = { width: 375, height: 812 };

async function seed(page: Page) {
  const session = await page.request.post("/api/v1/dev/session", {
    headers: { "X-Local-Development": "worktracker" },
  });
  const { access_token } = await session.json();
  const headers = { Authorization: `Bearer ${access_token}` };
  const due = (days: number | null) => {
    if (days === null) return null;
    const d = new Date();
    d.setUTCHours(19, 0, 0, 0);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString();
  };
  const rows = [
    ["Draft quarterly planning outline", "Planning", "high", "in_progress", 0],
    ["Review vendor notes", "Research", "urgent", "blocked", -2],
    ["Prepare demo checklist", "Delivery", "medium", "waiting", 3],
    ["Send weekly status update", "Comms", "medium", "in_review", 1],
    ["Tidy shared references", "Admin", "low", "inbox", null],
    ["Schedule team retrospective", "Planning", "medium", "planned", 5],
    ["Publish release notes", "Delivery", "high", "completed", -1],
  ] as const;
  for (const [title, category, priority, status, days] of rows) {
    const res = await page.request.post("/api/v1/tasks", {
      headers: { ...headers, "Idempotency-Key": crypto.randomUUID() },
      data: {
        title,
        description: "Synthetic task used for visual baselines.",
        category,
        priority,
        status,
        due_at: due(days),
      },
    });
    expect(res.ok()).toBeTruthy();
  }
  const archived = await page.request.post("/api/v1/tasks", {
    headers: { ...headers, "Idempotency-Key": crypto.randomUUID() },
    data: {
      title: "Archive old references",
      description: "Synthetic archived task.",
      category: "Admin",
      priority: "low",
      status: "completed",
      due_at: null,
    },
  });
  const task = (await archived.json()).task;
  await page.request.post(`/api/v1/tasks/${task.id}/archive`, {
    headers: { ...headers, "Idempotency-Key": crypto.randomUUID() },
    data: { expected_version: task.version },
  });
}

async function shot(page: Page, name: string, mask: string[] = []) {
  await page.waitForLoadState("networkidle");
  // Task details load their checklist asynchronously; wait so captures are stable.
  await expect(page.getByText("Loading task details")).toHaveCount(0);
  await page.screenshot({
    path: path.join(outDir, `${name}.png`),
    fullPage: false,
    animations: "disabled",
    caret: "hide",
    mask: mask.map((selector) => page.locator(selector)),
  });
}

test.describe.serial("visual baselines", () => {
  test("seed and desktop pages", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto("/app/today");
    await seed(page);

    await page.goto("/app/today");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await shot(page, "desktop-today");

    await page.goto("/app/board");
    await expect(page.locator(".task-card").first()).toBeVisible();
    await shot(page, "desktop-board");

    await page.getByRole("button", { name: "List view" }).click();
    await shot(page, "desktop-list");

    await page.goto("/app/board");
    await page
      .locator(".task-card")
      .filter({ hasText: "Draft quarterly planning outline" })
      .click();
    await expect(
      page.getByRole("button", { name: "Edit task", exact: true }),
    ).toBeVisible();
    await shot(page, "desktop-task-details", [".timeline-event"]);
    await page.getByRole("button", { name: "Close dialog", exact: true }).click();

    await page.getByRole("button", { name: "New task", exact: true }).click();
    await expect(
      page.getByRole("textbox", { name: "Task title", exact: true }),
    ).toBeVisible();
    await shot(page, "desktop-task-editor");
    await page.keyboard.press("Escape");

    await page.goto("/app/calendar");
    await expect(page.locator(".calendar-toolbar h2")).toBeVisible();
    await shot(page, "desktop-calendar");

    await page.goto("/app/archive");
    await expect(page.getByText("Archive old references")).toBeVisible();
    await shot(page, "desktop-archive");

    await page.goto("/app/settings");
    await expect(page.getByText("WORKSPACE PREFERENCES")).toBeVisible();
    await shot(page, "desktop-settings");
  });

  test("capture panel with proposals", async ({ page }) => {
    for (const [name, size] of [
      ["desktop", DESKTOP],
      ["mobile", MOBILE],
    ] as const) {
      await page.setViewportSize(size);
      await page.goto("/app/today");
      await page.getByRole("button", { name: "Ask Workroom" }).click();
      const input = page.locator("#capture-input");
      const start = page.getByRole("button", { name: "Start a capture" });
      await expect(input.or(start)).toBeVisible();
      // Always begin from an empty conversation so both sizes match.
      if (await start.isVisible()) await start.click();
      else
        await page
          .getByRole("button", { name: "New conversation", exact: true })
          .click();
      await expect(input).toBeVisible();
      await expect(input).toHaveValue("");
      await shot(page, `${name}-capture-empty`);
      await input.fill(
        "Please prepare the workshop outline by Friday.\nReview the assessment draft.",
      );
      await page.getByRole("button", { name: "Review proposals" }).click();
      await expect(page.locator(".proposal-card").first()).toBeVisible();
      await shot(page, `${name}-capture-proposals`);
    }
  });

  test("mobile pages", async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await page.goto("/app/today");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await shot(page, "mobile-today");

    await page.goto("/app/board");
    await expect(page.locator(".task-card").first()).toBeVisible();
    await shot(page, "mobile-board");

    await page
      .locator(".task-card")
      .filter({ hasText: "Draft quarterly planning outline" })
      .click();
    await expect(
      page.getByRole("button", { name: "Edit task", exact: true }),
    ).toBeVisible();
    await shot(page, "mobile-task-details", [".timeline-event"]);
    await page.getByRole("button", { name: "Close dialog", exact: true }).click();

    await page.getByRole("button", { name: "New task", exact: true }).click();
    await expect(
      page.getByRole("textbox", { name: "Task title", exact: true }),
    ).toBeVisible();
    await shot(page, "mobile-task-editor");
  });
});
