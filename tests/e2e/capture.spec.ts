import { test, expect, type Page } from "@playwright/test";

async function start(page: Page) {
  await page.goto("/app/assistant");
  await page
    .getByRole("button", { name: "New conversation", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", {
      name: "Paste an email or type a request",
      exact: true,
    }),
  ).toBeVisible();
}
async function auth(page: Page) {
  const session = await page.request.post("/api/v1/dev/session", {
    headers: { "X-Local-Development": "worktracker" },
  });
  return { Authorization: "Bearer " + (await session.json()).access_token };
}

test("three proposals stay separate from tasks, edits persist, and only approval creates a sourced task", async ({
  page,
}) => {
  await start(page);
  const suffix = String(Date.now());
  const title = "Approved workshop " + suffix;
  const source = `Please prepare the workshop outline ${suffix} by Friday.\nReview the assessment draft ${suffix}.\nPlan the certification event ${suffix}.`;
  const headers = await auth(page);
  await page
    .getByRole("textbox", {
      name: "Paste an email or type a request",
      exact: true,
    })
    .fill(source);
  await page
    .getByRole("button", { name: "Review proposals", exact: true })
    .click();
  await expect(page.locator(".proposal-card")).toHaveCount(3);
  if(process.env.CAPTURE_SCREENSHOT_PATH){await page.locator('.proposal-card').first().scrollIntoViewIfNeeded();await page.screenshot({path:process.env.CAPTURE_SCREENSHOT_PATH});}
  await expect(page.locator(".proposal-question")).toContainText(
    "No deadline has been set",
  );
  expect(
    (
      await (
        await page.request.get("/api/v1/tasks?q=" + suffix, { headers })
      ).json()
    ).total,
  ).toBe(0);
  const first = page.locator(".proposal-card").first();
  await first
    .getByRole("textbox", { name: "Proposed title", exact: true })
    .fill(title);
  await first.getByRole("button", { name: "Save edits", exact: true }).click();
  await expect(
    page.locator(".proposal-card").filter({
      has: page.getByRole("textbox", { name: "Proposed title", exact: true }),
    }),
  ).toHaveCount(3);
  await page.reload();
  // Select by a saved field value, never by proposal order/UUID.
  const proposal = page
    .locator(".proposal-card")
    .filter({ has: page.locator(`input[name="title"][value="${title}"]`) });
  await expect(proposal).toBeVisible();
  await proposal
    .getByRole("button", { name: "Approve task", exact: true })
    .click();
  await expect(page.locator(".proposal-reviewed.approved")).toContainText(
    title,
  );
  for (let remaining = 2; remaining > 0; remaining--) {
    await page
      .locator(".proposal-card")
      .first()
      .getByRole("button", { name: "Reject", exact: true })
      .click();
    await expect(page.locator(".proposal-card")).toHaveCount(remaining - 1);
  }
  await expect(page.locator(".proposal-reviewed.rejected")).toHaveCount(2);
  const tasks = await (
    await page.request.get("/api/v1/tasks?q=" + suffix, { headers })
  ).json();
  expect(tasks.total).toBe(1);
  expect(tasks.items[0].title).toBe(title);
  expect(tasks.items[0].due_at).toBeNull();
  await page.getByRole("button", { name: "Open task", exact: true }).click();
  await expect(page.locator(".source-panel")).toContainText(
    "deterministic-mock",
  );
  await expect(page.locator(".timeline-event")).toHaveCount(1);
  await page
    .getByRole("link", { name: "Open saved conversation", exact: true })
    .click();
  await expect(page.locator(".proposal-reviewed.approved")).toContainText(
    title,
  );
  await expect(page.locator(".capture-message.user")).toContainText(source);
});

test("drafts survive reload and network failure without losing the retry action", async ({
  page,
}) => {
  await start(page);
  const draft = "Prepare a synthetic draft " + Date.now();
  const input = page.getByRole("textbox", {
    name: "Paste an email or type a request",
    exact: true,
  });
  await input.fill(draft);
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.locator('.composer-bottom [role="status"]')).toContainText(
    "Draft saved",
  );
  await page.reload();
  await expect(input).toHaveValue(draft);
  await page.route("**/api/v1/conversations/*/runs", (route) =>
    route.fulfill({
      status: 503,
      json: { error: { message: "Simulated capture outage" } },
    }),
  );
  await page
    .getByRole("button", { name: "Review proposals", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "Simulated capture outage",
  );
  await expect(input).toHaveValue(draft);
  await page.unroute("**/api/v1/conversations/*/runs");
  await page
    .getByRole("button", { name: "Retry saved action", exact: true })
    .click();
  await expect(page.locator(".proposal-card")).toHaveCount(1);
  await expect(page.locator(".capture-message.user")).toHaveCount(1);
});

test("lost approval response can retry without a second task or activity", async ({
  page,
}) => {
  await start(page);
  const suffix = String(Date.now());
  await page
    .getByRole("textbox", {
      name: "Paste an email or type a request",
      exact: true,
    })
    .fill("Prepare the single approval " + suffix);
  await page
    .getByRole("button", { name: "Review proposals", exact: true })
    .click();
  await expect(page.locator(".proposal-card")).toHaveCount(1);
  let interrupted = false;
  await page.route("**/api/v1/ai/proposals/*/decision", async (route) => {
    if (!interrupted) {
      interrupted = true;
      await route.fetch();
      await route.abort("failed");
    } else await route.continue();
  });
  await page.getByRole("button", { name: "Approve task", exact: true }).click();
  await expect(page.locator(".proposal-card").getByRole("alert")).toBeVisible();
  await page.getByRole("button", { name: "Approve task", exact: true }).click();
  await expect(page.locator(".proposal-reviewed.approved")).toHaveCount(1);
  const headers = await auth(page);
  const tasks = await (
    await page.request.get("/api/v1/tasks?q=" + suffix, { headers })
  ).json();
  expect(tasks.total).toBe(1);
  const history = await (
    await page.request.get(`/api/v1/tasks/${tasks.items[0].id}/events`, {
      headers,
    })
  ).json();
  expect(history).toHaveLength(1);
});

test("lost capture response reuses the saved run instead of creating duplicate proposals", async ({
  page,
}) => {
  await start(page);
  const content = "Prepare the lost-response capture " + Date.now();
  await page
    .getByRole("textbox", {
      name: "Paste an email or type a request",
      exact: true,
    })
    .fill(content);
  let interrupted = false;
  await page.route("**/api/v1/conversations/*/runs", async (route) => {
    if (!interrupted) {
      interrupted = true;
      await route.fetch();
      await route.abort("failed");
    } else await route.continue();
  });
  await page
    .getByRole("button", { name: "Review proposals", exact: true })
    .click();
  await expect(page.getByRole("alert")).toBeVisible();
  await page
    .getByRole("button", { name: "Retry saved action", exact: true })
    .click();
  await expect(page.locator(".proposal-card")).toHaveCount(1);
  await expect(page.locator(".capture-message.user")).toHaveCount(1);
  await page.reload();
  await expect(page.locator(".proposal-card")).toHaveCount(1);
});

test("zero proposals, conversation switching, and mobile review are usable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await start(page);
  await page
    .getByRole("textbox", {
      name: "Paste an email or type a request",
      exact: true,
    })
    .fill("Thank you. Looking forward to the workshop.");
  await page
    .getByRole("button", { name: "Review proposals", exact: true })
    .click();
  await expect(
    page.getByText("No actionable requests found.", { exact: false }),
  ).toBeVisible();
  await expect(page.locator(".proposal-card")).toHaveCount(0);
  await page
    .getByRole("button", { name: "New conversation", exact: true })
    .click();
  await page
    .getByRole("textbox", {
      name: "Paste an email or type a request",
      exact: true,
    })
    .fill("Review the mobile capture");
  await page
    .getByRole("button", { name: "Review proposals", exact: true })
    .click();
  await expect(page.locator(".proposal-card")).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: "Approve task", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(page.locator(".proposal-card")).toHaveCount(1);
});
