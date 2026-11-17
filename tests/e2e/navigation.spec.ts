import { test, expect } from "@playwright/test";
import { seeder } from "./seed";

test("Back from Archive shows the active tasks again, not the archived ones", async ({
  page,
}) => {
  await page.goto("/app/board");
  const { create, archive } = await seeder(page);
  const stamp = Date.now();
  const active = `Active ${stamp}`;
  const archived = `Archived ${stamp}`;
  await create(active);
  await archive(await create(archived));

  await page.goto("/app/board");
  await expect(
    page.getByRole("heading", { name: active, exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Archive", exact: true }).click();
  await expect(page.getByText(archived)).toBeVisible();

  await page.goBack();
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Make room for progress",
  );
  await expect(
    page.getByRole("heading", { name: active, exact: true }),
  ).toBeVisible();
  await expect(page.getByText(archived)).toHaveCount(0);
});

test("the Needs attention card opens Today with the overdue filter and updates the URL", async ({
  page,
}) => {
  await page.goto("/app/board");
  const { create } = await seeder(page);
  const title = `Overdue ${Date.now()}`;
  await create(title, {
    status: "in_progress",
    due_at: new Date(Date.now() - 3 * 86400000).toISOString(),
  });

  await page.goto("/app/board");
  const card = page.getByRole("button", { name: /Needs attention/ });
  await card.click();
  await expect(page).toHaveURL(/\/app\/today$/);
  await expect(page.getByText("Showing overdue tasks")).toBeVisible();
  await expect(card).toHaveAttribute("aria-pressed", "true");
});

test("task filter controls are at least 24px tall (WCAG 2.2 target size)", async ({
  page,
}) => {
  await page.goto("/app/board");
  for (const control of [
    page.getByRole("textbox", { name: "Search tasks" }),
    page.getByRole("combobox", { name: "Filter by priority" }),
    page.getByRole("combobox", { name: "Filter by status" }),
  ]) {
    const box = await control.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(24);
  }
});

test("navigation marks the current page, updates the title and moves focus to the heading", async ({
  page,
}) => {
  await page.goto("/app/today");
  await expect(page.getByRole("button", { name: /^Today/ })).toHaveAttribute(
    "aria-current",
    "page",
  );

  await page.getByRole("button", { name: /^My board/ }).click();
  await expect(page.getByRole("button", { name: /^My board/ })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(
    page.getByRole("button", { name: /^Today/ }),
  ).not.toHaveAttribute("aria-current", "page");
  await expect(page).toHaveTitle(/My board/);
  await expect(page.getByRole("heading", { level: 1 })).toBeFocused();
});
