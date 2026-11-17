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
  const card = page.locator(".task-card").filter({ hasText: title });
  await expect(card).toBeVisible();
  return card;
}

test("failed drag rolls back without a phantom event, then successful drag persists", async ({
  page,
}) => {
  const title = "Rollback " + Date.now();
  const card = await createTask(page, title);
  await card.click();
  const taskId = new URL(page.url()).pathname.split("/").pop()!;
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await page.route(`**/api/v1/tasks/${taskId}`, async (route) => {
    if (route.request().method() === "PATCH")
      await route.fulfill({
        status: 503,
        json: { error: { message: "Simulated update failure" } },
      });
    else await route.continue();
  });
  const inbox = page.getByRole("region", { name: "Inbox column" });
  const planned = page.getByRole("region", { name: "Planned column" });
  await card.dragTo(planned);
  await expect(page.getByRole("alert")).toContainText(
    "Simulated update failure",
  );
  await expect(
    inbox.getByRole("heading", { name: title, exact: true }),
  ).toBeVisible();
  await expect(
    planned.getByRole("heading", { name: title, exact: true }),
  ).toHaveCount(0);
  await page.unroute(`**/api/v1/tasks/${taskId}`);
  await card.click();
  await expect(page.locator(".timeline-event")).toHaveCount(1);
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await card.dragTo(planned);
  await expect(
    planned.getByRole("heading", { name: title, exact: true }),
  ).toBeVisible();
  await page.reload();
  await page.getByRole("textbox", { name: "Search tasks" }).fill(title);
  await expect(
    page
      .getByRole("region", { name: "Planned column" })
      .getByRole("heading", { name: title, exact: true }),
  ).toBeVisible();
});

test("concurrent edits preserve the draft and require an explicit reload", async ({
  page,
  context,
}) => {
  const title = "Concurrent " + Date.now();
  await (await createTask(page, title)).click();
  const url = page.url();
  await page.getByRole("button", { name: "Edit task", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Task title", exact: true })
    .fill(title + " local draft");
  const other = await context.newPage();
  await other.goto(url);
  await other.getByRole("button", { name: "Edit task", exact: true }).click();
  await other
    .getByRole("textbox", { name: "Task title", exact: true })
    .fill(title + " saved elsewhere");
  await other
    .getByRole("button", { name: "Save changes", exact: true })
    .click();
  await expect(
    other.getByRole("heading", {
      name: title + " saved elsewhere",
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(
    "changed in another session",
  );
  await expect(
    page.getByRole("textbox", { name: "Task title", exact: true }),
  ).toHaveValue(title + " local draft");
  await page
    .getByRole("button", {
      name: "Reload latest task (discard draft)",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Task title", exact: true }),
  ).toHaveValue(title + " saved elsewhere");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.locator(".timeline-event")).toHaveCount(2);
});

test("keyboard checklist, notes, deliverables and independent manual progress survive reload", async ({
  page,
}) => {
  const title = "Details " + Date.now();
  await (await createTask(page, title)).click();
  await page
    .getByRole("textbox", { name: "New checklist step", exact: true })
    .fill("Review the draft");
  await page.getByRole("button", { name: "Add step", exact: true }).click();
  const checkbox = page.getByRole("checkbox", {
    name: "Review the draft",
    exact: true,
  });
  await expect(checkbox).toBeEnabled();
  await checkbox.focus();
  await page.keyboard.press("Space");
  await expect(checkbox).toBeChecked();
  await expect(
    page.getByText("100% · From checklist", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("textbox", { name: "New deliverable", exact: true })
    .fill("Review summary");
  await page
    .getByRole("button", { name: "Add deliverable", exact: true })
    .click();
  await expect(
    page.getByRole("checkbox", { name: "Review summary", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("checkbox", { name: "Review summary", exact: true })
    .check();
  await page
    .getByRole("textbox", { name: "New note", exact: true })
    .fill("Synthetic review note");
  await page.getByRole("button", { name: "Add note", exact: true }).click();
  await expect(page.locator(".work-note")).toContainText(
    "Synthetic review note",
  );
  await page.getByRole("button", { name: "Edit task", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Progress source", exact: true })
    .selectOption("manual");
  await page
    .getByRole("spinbutton", { name: "Manual progress (%)", exact: true })
    .fill("35");
  await page
    .getByRole("textbox", { name: "Blocker or waiting reason", exact: true })
    .fill("Waiting for review");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(
    page
      .getByRole("region", { name: "Task work" })
      .getByText("35% · Manual", { exact: true }),
  ).toBeVisible();
  const again = page.getByRole("checkbox", {
    name: "Review the draft",
    exact: true,
  });
  await expect(again).toBeEnabled();
  await again.uncheck();
  await expect(
    page.getByRole("button", { name: "Edit task", exact: true }),
  ).toBeEnabled();
  await expect(
    page
      .getByRole("region", { name: "Task work" })
      .getByText("35% · Manual", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("checkbox", { name: "Review the draft", exact: true }),
  ).not.toBeChecked();
  await expect(
    page.getByRole("checkbox", { name: "Review summary", exact: true }),
  ).toBeChecked();
  await expect(
    page
      .getByRole("region", { name: "Task work" })
      .getByText("35% · Manual", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".work-note")).toContainText(
    "Synthetic review note",
  );
  await expect(page.locator(".blocker-panel")).toContainText(
    "Waiting for review",
  );
  await page.getByRole("button", { name: "Close dialog", exact: true }).focus();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.keyboard.press("Control+k");
  await expect(
    page.getByRole("textbox", { name: "Search tasks" }),
  ).toBeFocused();
});

test("calendar drag reviews a workspace-time deadline and keeps undated work separate", async ({
  page,
}) => {
  const undated = "Undated " + Date.now();
  await createTask(page, undated);
  const title = "Calendar " + Date.now();
  await (await createTask(page, title)).click();
  await page.getByLabel("New due date", { exact: true }).fill("2026-10-25");
  await page.getByLabel("New due time", { exact: true }).fill("09:30");
  await page
    .getByRole("button", { name: "Save deadline", exact: true })
    .click();
  await expect(page.locator('.schedule-form [role="status"]')).toContainText(
    "Deadline saved",
  );
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await page.getByRole("button", { name: "Calendar", exact: true }).click();
  // The test calendar is navigated through its visible month controls, independent of today's month.
  for (
    let attempt = 0;
    attempt < 120 &&
    (await page.locator(".calendar-toolbar h2").innerText()) !== "October 2026";
    attempt++
  ) {
    const heading = await page.locator(".calendar-toolbar h2").innerText();
    const shown = new Date(heading + " 1");
    await page
      .getByRole("button", {
        name:
          shown > new Date("2026-10-01") ? "Previous period" : "Next period",
        exact: true,
      })
      .click();
  }
  await expect(page.locator(".calendar-toolbar h2")).toHaveText("October 2026");
  const source = page
    .locator('.calendar-cell[aria-label="Schedule for 2026-10-25"]')
    .getByRole("button", { name: title, exact: true });
  const target = page.locator(
    '.calendar-cell[aria-label="Schedule for 2026-10-26"]',
  );
  await expect(
    page.locator(".calendar-task").filter({ hasText: undated }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("option", { name: undated, exact: true }),
  ).toHaveCount(1);
  await source.dragTo(target);
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByLabel("New due time", { exact: true })).toHaveValue(
    "09:30",
  );
  await page
    .getByRole("button", { name: "Save deadline", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    target.getByRole("button", { name: title, exact: true }),
  ).toBeVisible();
  await page
    .getByRole("combobox", { name: "Calendar status", exact: true })
    .selectOption("completed");
  await expect(
    target.getByRole("button", { name: title, exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("combobox", { name: "Calendar status", exact: true })
    .selectOption("inbox");
  await expect(
    target.getByRole("button", { name: title, exact: true }),
  ).toBeVisible();
  await page
    .getByRole("combobox", { name: "Calendar status", exact: true })
    .selectOption("all");
  await page
    .getByRole("combobox", { name: "Calendar view" })
    .selectOption("week");
  await expect(page.locator(".calendar-cell")).toHaveCount(7);
  await page
    .getByRole("combobox", { name: "Calendar view" })
    .selectOption("day");
  await expect(page.locator(".calendar-cell")).toHaveCount(1);
});

test("new task deadlines use the workspace timezone even when the device differs", async ({
  page,
}) => {
  const title = "Workspace deadline " + Date.now();
  await page.goto("/app/board");
  await page.getByRole("button", { name: "New task", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Task title", exact: true })
    .fill(title);
  await page.locator('input[name="due_at"]').fill("2026-10-26T09:30");
  const response = page.waitForResponse(
    (r) => r.url().endsWith("/api/v1/tasks") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Create task", exact: true }).click();
  expect((await (await response).json()).task.due_at).toBe(
    "2026-10-26T04:00:00Z",
  );
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("a committed note with a lost response retries exactly once", async ({
  page,
}) => {
  const title = "Uncertain write " + Date.now();
  await (await createTask(page, title)).click();
  let interrupted = false;
  await page.route("**/api/v1/tasks/*/notes", async (route) => {
    if (!interrupted) {
      interrupted = true;
      await route.fetch();
      await route.abort("failed");
    } else await route.continue();
  });
  await page
    .getByRole("textbox", { name: "New note", exact: true })
    .fill("Exactly one note");
  await page.getByRole("button", { name: "Add note", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Task work" }).getByRole("alert"),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Add note", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Add note", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "New note", exact: true }),
  ).toHaveValue("");
  await expect(page.locator(".work-note")).toHaveCount(1);
  await page.reload();
  await expect(page.locator(".work-note")).toHaveCount(1);
  await expect(page.locator(".timeline-event")).toHaveCount(2);
});
