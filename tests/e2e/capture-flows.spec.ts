import { test, expect, type Page } from "@playwright/test";
import { seeder } from "./seed";

async function startCapture(page: Page) {
  await page.getByRole("button", { name: "Ask Workroom" }).click();
  const input = page.locator("#capture-input");
  const start = page.getByRole("button", { name: "Start a capture" });
  await expect(input.or(start)).toBeVisible();
  if (await start.isVisible()) await start.click();
  else
    await page
      .getByRole("button", { name: "New conversation", exact: true })
      .click();
  await expect(input).toBeVisible();
  await expect(input).toHaveValue("");
  return input;
}

test("Back from Capture returns to the previous page without reopening the assistant", async ({
  page,
}) => {
  await page.goto("/app/today");
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("button", { name: /^Capture/ })
    .click();
  await expect(page).toHaveURL(/\/app\/assistant/);

  await page.goBack();
  await expect(page).toHaveURL(/\/app\/today$/);
  await expect(page.getByRole("dialog", { name: "Workroom AI" })).toBeHidden();
});

test("approving a Capture proposal on the Archive page does not add it to the archived list", async ({
  page,
}) => {
  await page.goto("/app/board");
  const { create, archive } = await seeder(page);
  const stamp = Date.now();
  await archive(await create(`Archived ${stamp}`));

  await page.goto("/app/archive");
  await expect(page.getByText(`Archived ${stamp}`)).toBeVisible();
  const input = await startCapture(page);
  await input.fill(`Please prepare the archive check ${stamp} by Friday.`);
  await page.getByRole("button", { name: "Review proposals" }).click();
  await page.getByRole("button", { name: "Approve task" }).click();
  await expect(page.locator(".toast")).toContainText("Approved task changes");

  await expect(
    page.locator(".task-list").getByText(new RegExp(`archive check ${stamp}`)),
  ).toHaveCount(0);
  await expect(
    page.locator(".task-list").getByText(`Archived ${stamp}`),
  ).toBeVisible();
});

test("asking the assistant about the same task again reopens that task's conversation", async ({
  page,
}) => {
  await page.goto("/app/board");
  const { create } = await seeder(page);
  const title = `Twice ${Date.now()}`;
  await create(title);
  await page.goto("/app/board");

  const context = page.getByRole("region", { name: "Selected task context" });
  const ask = async () => {
    await page.locator(".task-card").filter({ hasText: title }).click();
    await page
      .getByRole("button", { name: "Ask assistant", exact: true })
      .click();
    await expect(context).toContainText(title);
  };
  await ask();
  await page
    .getByRole("button", { name: "New conversation", exact: true })
    .click();
  await expect(context).toHaveCount(0);
  await page.getByRole("button", { name: "Close Workroom AI" }).click();

  await ask();
});
