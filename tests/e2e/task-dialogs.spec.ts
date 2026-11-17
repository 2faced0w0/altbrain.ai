import { test, expect, type Page } from "@playwright/test";

async function createAndOpen(page: Page, title: string) {
  await page.goto("/app/board");
  await page.getByRole("button", { name: "New task", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Task title", exact: true })
    .fill(title);
  await page.getByRole("button", { name: "Create task", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("textbox", { name: "Search tasks" }).fill(title);
  await page.locator(".task-card").filter({ hasText: title }).click();
  await expect(
    page.getByRole("button", { name: "Edit task", exact: true }),
  ).toBeVisible();
}

test("the task title in the details drawer is a level 2 heading and the page keeps the only h1", async ({
  page,
}) => {
  const title = "Heading order " + Date.now();
  await createAndOpen(page, title);
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { level: 1 })).toHaveCount(0);
  await expect(
    dialog.getByRole("heading", { level: 2, name: title }),
  ).toBeVisible();
});

test("the details actions stay visible after scrolling the drawer to the bottom", async ({
  page,
}) => {
  await createAndOpen(page, "Reachable actions " + Date.now());
  await page
    .getByRole("dialog")
    .evaluate((el) => el.scrollTo(0, el.scrollHeight));
  const dialog = page.getByRole("dialog");
  for (const name of ["Edit task", "Ask assistant", "Archive"]) {
    await expect(
      dialog.getByRole("button", { name, exact: true }),
    ).toBeInViewport();
  }
});

test("the editor groups its fields and keeps the save action in view", async ({
  page,
}) => {
  await page.goto("/app/board");
  await page.getByRole("button", { name: "New task", exact: true }).click();
  const dialog = page.getByRole("dialog");
  for (const group of ["What", "When", "Context", "Progress"]) {
    await expect(dialog.getByRole("group", { name: group })).toBeVisible();
  }
  await expect(
    dialog.getByRole("group", { name: "When" }).getByLabel(/Due date/),
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Create task", exact: true }),
  ).toBeInViewport();
});
