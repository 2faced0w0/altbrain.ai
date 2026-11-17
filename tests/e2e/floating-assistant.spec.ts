import { test, expect } from "@playwright/test";

test("launcher opens over the current page, traps focus, and preserves drafts across minimize and navigation", async ({
  page,
}) => {
  await page.goto("/app/today");
  const launcher = page.getByRole("button", {
    name: "Ask Workroom",
    exact: true,
  });
  await expect(launcher).toBeVisible();
  const heading = page.getByRole("heading", {
    name: "A little focus goes a long way.",
    exact: true,
  });
  await page.evaluate(() => document.fonts.ready);
  const before = await heading.boundingBox();
  if (process.env.ISLAND_SCREENSHOT_DIR)
    await page.screenshot({
      animations: "disabled",
      path: process.env.ISLAND_SCREENSHOT_DIR + "/workroom-island-today.png",
    });
  await launcher.hover();
  await expect(
    page.getByRole("button", { name: "Capture a task", exact: true }),
  ).toBeVisible();
  expect(await heading.boundingBox()).toEqual(before);
  await launcher.click();
  const dialog = page.getByRole("dialog", { name: "Workroom AI", exact: true });
  await expect(dialog).toBeVisible();
  expect(new URL(page.url()).pathname).toBe("/app/today");
  await page
    .getByRole("button", { name: "New conversation", exact: true })
    .click();
  const composer = page.getByRole("textbox", {
    name: "Paste an email or type a request",
    exact: true,
  });
  await composer.fill("Prepare an island draft " + Date.now());
  const draft = await composer.inputValue();
  await page
    .getByRole("button", { name: "Minimize Workroom AI", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await expect(launcher).toBeFocused();
  await launcher.click();
  await expect(composer).toHaveValue(draft);
  await page
    .getByRole("button", { name: "Close Workroom AI", exact: true })
    .focus();
  await page.keyboard.press("Tab");
  expect(
    await page.evaluate(() => !!document.activeElement?.closest("dialog")),
  ).toBe(true);
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(launcher).toBeFocused();
  await page.getByRole("button", { name: "Calendar", exact: true }).click();
  await launcher.click();
  expect(new URL(page.url()).pathname).toBe("/app/calendar");
  await expect(dialog.locator(".ai-dialog-header")).toContainText(
    "Calendar context",
  );
  await expect(composer).toHaveValue(draft);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "My board", exact: true }).click();
  await launcher.hover();
  if (process.env.ISLAND_SCREENSHOT_DIR)
    await page.screenshot({
      animations: "disabled",
      path: process.env.ISLAND_SCREENSHOT_DIR + "/workroom-island-board.png",
    });
  const created = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/v1/conversations") &&
      response.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Capture a task", exact: true })
    .click();
  const row = await (await created).json();
  await expect(page).toHaveURL(new RegExp(row.id));
  await expect(composer).toHaveValue("");
  expect(new URL(page.url()).pathname).toBe("/app/board");
});

test("calendar snapshot uses real tasks and task changes remain proposals until approval", async ({
  page,
}) => {
  await page.goto("/app/calendar");
  const response = await page.request.post("/api/v1/dev/session", {
    headers: { "X-Local-Development": "worktracker" },
  });
  const headers = {
    Authorization: "Bearer " + (await response.json()).access_token,
    "Idempotency-Key": crypto.randomUUID(),
  };
  const title = "Island calendar fixture " + Date.now();
  const result = await page.request.post("/api/v1/tasks", {
    headers,
    data: { title, status: "planned", due_at: new Date().toISOString() },
  });
  const task = (await result.json()).task;
  await page.reload();
  const launcher = page.getByRole("button", {
    name: "Ask Workroom",
    exact: true,
  });
  await launcher.focus();
  await page
    .getByRole("button", { name: "Ask about calendar", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Workroom AI", exact: true });
  await expect(
    page.getByRole("region", { name: "Current page snapshot" }),
  ).toContainText(title);
  if (process.env.ISLAND_SCREENSHOT_DIR)
    await page.screenshot({
      animations: "disabled",
      path: process.env.ISLAND_SCREENSHOT_DIR + "/workroom-island-calendar.png",
    });
  await page.locator(".ai-context-task").filter({ hasText: title }).click();
  await expect(
    page.getByRole("region", { name: "Selected task context" }),
  ).toContainText(title);
  expect(new URL(page.url()).pathname).toBe("/app/calendar");
  await page
    .getByRole("textbox", { name: "Ask about this task", exact: true })
    .fill("Mark this done");
  await page
    .getByRole("button", { name: "Send task request", exact: true })
    .click();
  await expect(page.locator(".task-update-card")).toHaveCount(1);
  expect(
    (
      await (
        await page.request.get("/api/v1/tasks/" + task.id, { headers })
      ).json()
    ).status,
  ).toBe("planned");
  await page
    .getByRole("button", { name: "Minimize Workroom AI", exact: true })
    .click();
  await launcher.click();
  await expect(page.locator(".task-update-card")).toHaveCount(1);
  await page
    .getByRole("button", { name: "Approve changes", exact: true })
    .click();
  await expect(
    page.getByText("Task update approved", { exact: true }),
  ).toBeVisible();
  expect(
    (
      await (
        await page.request.get("/api/v1/tasks/" + task.id, { headers })
      ).json()
    ).status,
  ).toBe("completed");
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
});

test("mobile sheet supports reduced motion and the composer stays inside the viewport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/app/today");
  await page.getByRole("button", { name: "Ask Workroom", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Workroom AI", exact: true });
  await page
    .getByRole("button", { name: "New conversation", exact: true })
    .click();
  const composer = page.getByRole("textbox", {
    name: "Paste an email or type a request",
    exact: true,
  });
  await expect(composer).toBeVisible();
  const bounds = await dialog.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  const input = await composer.boundingBox();
  expect(input!.y + input!.height).toBeLessThan(844);
  expect(
    await dialog.evaluate((element) => getComputedStyle(element).animationName),
  ).toBe("none");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await composer.fill("Review the mobile island fixture");
  await page
    .getByRole("button", { name: "Review proposals", exact: true })
    .click();
  await expect(page.locator(".proposal-card")).toHaveCount(1);
  if (process.env.ISLAND_SCREENSHOT_DIR)
    await page.screenshot({
      animations: "disabled",
      path: process.env.ISLAND_SCREENSHOT_DIR + "/workroom-island-mobile.png",
    });
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Ask Workroom", exact: true }).click();
  await expect(page.locator(".proposal-card")).toHaveCount(1);
});
