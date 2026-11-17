import { test, expect, type Page } from "@playwright/test";
async function start(page: Page) {
  await page.goto("/app/assistant");
  const created = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/v1/conversations") &&
      r.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "New conversation", exact: true })
    .click();
  const row = await (await created).json();
  await expect(page).toHaveURL(new RegExp(row.id));
  await expect(
    page.getByRole("combobox", { name: "AI provider", exact: true }),
  ).toHaveValue("openai");
}
async function auth(page: Page) {
  const response = await page.request.post("/api/v1/dev/session", {
    headers: { "X-Local-Development": "worktracker" },
  });
  return { Authorization: "Bearer " + (await response.json()).access_token };
}

test("OpenAI quota failures show billing guidance and retain input without creating tasks", async ({
  page,
}) => {
  await start(page);
  const composer = page.getByRole("textbox", {
    name: "Paste an email or type a request",
    exact: true,
  });
  await composer.fill("Prepare synthetic curriculum [[quota]]");
  await page.getByRole("checkbox").check();
  await page
    .getByRole("button", { name: "Review proposals", exact: true })
    .click();
  await expect(page.locator(".run-label")).toContainText("quota exhausted");
  await expect(
    page.getByRole("link", { name: "OpenAI API billing", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(/waiting alone may not resolve it/),
  ).toBeVisible();
  await expect(composer).toHaveValue("Prepare synthetic curriculum [[quota]]");
  await expect(page.locator(".proposal-card")).toHaveCount(0);
  await expect(page.getByRole("checkbox")).not.toBeChecked();
});

test("selecting the local mock overrides a configured external default without consent or budget use", async ({
  page,
}) => {
  await start(page);
  const headers = await auth(page);
  const before = await (
    await page.request.get("/api/v1/ai/status", { headers })
  ).json();
  await page
    .getByRole("combobox", { name: "AI provider", exact: true })
    .selectOption("mock");
  await expect(page.getByRole("checkbox")).toHaveCount(0);
  await page
    .getByRole("textbox", {
      name: "Paste an email or type a request",
      exact: true,
    })
    .fill("Please prepare the mock fallback fixture.");
  await page
    .getByRole("button", { name: "Review proposals", exact: true })
    .click();
  await expect(page.locator(".proposal-card")).toHaveCount(1);
  await expect(page.locator(".run-label")).toContainText("deterministic-mock");
  const after = await (
    await page.request.get("/api/v1/ai/status", { headers })
  ).json();
  expect(after.requests_used).toBe(before.requests_used);
  expect(after.reserved_micro_usd).toBe(before.reserved_micro_usd);
});

test("provider selection requires fresh consent and keeps source attribution through approval", async ({
  page,
}) => {
  await start(page);
  const headers = await auth(page);
  const title = "Prepare provider fixture " + Date.now();
  const composer = page.getByRole("textbox", {
    name: "Paste an email or type a request",
    exact: true,
  });
  await composer.fill(title);
  const send = page.getByRole("button", {
    name: "Review proposals",
    exact: true,
  });
  await expect(send).toBeDisabled();
  const consent = page.getByRole("checkbox");
  await consent.check();
  await page
    .getByRole("combobox", { name: "AI provider", exact: true })
    .selectOption("gemini");
  await expect(consent).not.toBeChecked();
  await expect(send).toBeDisabled();
  await consent.check();
  await send.click();
  await expect(page.locator(".proposal-card")).toHaveCount(1);
  await expect(consent).not.toBeChecked();
  await expect(page.locator(".run-label")).toContainText("gemini-fixture");
  expect(
    (
      await (
        await page.request.get("/api/v1/tasks?q=" + encodeURIComponent(title), {
          headers,
        })
      ).json()
    ).total,
  ).toBe(0);
  await page
    .getByRole("combobox", { name: "AI provider", exact: true })
    .selectOption("mistral");
  await page
    .locator(".proposal-card")
    .getByRole("button", { name: "Approve task", exact: true })
    .click();
  await expect(page.locator(".proposal-reviewed.approved")).toHaveCount(1);
  const task = (
    await (
      await page.request.get("/api/v1/tasks?q=" + encodeURIComponent(title), {
        headers,
      })
    ).json()
  ).items[0];
  expect(
    (
      await (
        await page.request.get("/api/v1/tasks/" + task.id + "/source", {
          headers,
        })
      ).json()
    ).provider,
  ).toBe("gemini");
});

test("mobile file upload stays local until external review is consented", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await start(page);
  const headers = await auth(page);
  const before = await (
    await page.request.get("/api/v1/ai/status", { headers })
  ).json();
  await page
    .getByRole("combobox", { name: "AI provider", exact: true })
    .selectOption("gemini");
  await page.locator("summary").filter({ hasText: "Attach a file" }).click();
  await page.getByLabel("Choose a source file", { exact: true }).setInputFiles({
    name: "synthetic-provider-mobile.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Prepare the mobile provider fixture."),
  });
  await page
    .getByRole("button", { name: "Upload privately", exact: true })
    .click();
  const review = page.getByRole("button", {
    name: "Review file proposals",
    exact: true,
  });
  await expect(review).toBeDisabled();
  const uploaded = await (
    await page.request.get("/api/v1/ai/status", { headers })
  ).json();
  expect(uploaded.requests_used).toBe(before.requests_used);
  await page.getByRole("checkbox").check();
  await review.click();
  await expect(page.locator(".proposal-card")).toHaveCount(1);
  await expect(page.getByRole("checkbox")).not.toBeChecked();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("OpenRouter task requests preserve fixed scope and wait for explicit approval", async ({
  page,
}) => {
  const headers = await auth(page);
  const title = "Provider task fixture " + Date.now();
  const response = await page.request.post("/api/v1/tasks", {
    headers: { ...headers, "Idempotency-Key": crypto.randomUUID() },
    data: { title },
  });
  const task = (await response.json()).task;
  await page.goto("/app/tasks/" + task.id);
  await page
    .getByRole("button", { name: "Ask assistant", exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "AI provider", exact: true })
    .selectOption("openrouter");
  await page
    .getByRole("textbox", { name: "Ask about this task", exact: true })
    .fill("Mark this done");
  await page.getByRole("checkbox").check();
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
  ).toBe("inbox");
  if (process.env.AI_SCREENSHOT_DIR)
    await page.screenshot({
      animations: "disabled",
      path: process.env.AI_SCREENSHOT_DIR + "/workroom-ai-providers.png",
    });
  await page
    .getByRole("button", { name: "Minimize Workroom AI", exact: true })
    .click();
  await page.getByRole("button", { name: "Ask Workroom", exact: true }).click();
  await expect(page.locator(".task-update-card")).toHaveCount(1);
  await page
    .getByRole("button", { name: "Approve changes", exact: true })
    .click();
  await expect(
    page.getByText("Task update approved", { exact: true }),
  ).toBeVisible();
});

test("lost provider reply retries the original request without another budget reservation", async ({
  page,
}) => {
  await start(page);
  const headers = await auth(page);
  const before = await (
    await page.request.get("/api/v1/ai/status", { headers })
  ).json();
  await page
    .getByRole("combobox", { name: "AI provider", exact: true })
    .selectOption("deepseek");
  await page
    .getByRole("textbox", {
      name: "Paste an email or type a request",
      exact: true,
    })
    .fill("Review lost reply fixture");
  await page.getByRole("checkbox").check();
  let dropped = false;
  await page.route("**/api/v1/conversations/*/runs", async (route) => {
    if (!dropped) {
      dropped = true;
      await route.fetch();
      await route.abort("failed");
    } else await route.continue();
  });
  await page
    .getByRole("button", { name: "Review proposals", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Retry saved action", exact: true })
    .click();
  await expect(page.locator(".proposal-card")).toHaveCount(1);
  const after = await (
    await page.request.get("/api/v1/ai/status", { headers })
  ).json();
  expect(after.requests_used).toBe(before.requests_used + 1);
  await page.reload();
  await expect(page.locator(".proposal-card")).toHaveCount(1);
});
