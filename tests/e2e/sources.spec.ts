import { test, expect, type Page } from "@playwright/test";
async function start(page: Page) {
  await page.goto("/app/assistant");
  const created = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/v1/conversations") &&
      response.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "New conversation", exact: true })
    .click();
  const conversation = await (await created).json();
  await expect(page).toHaveURL(new RegExp(conversation.id));
  await page.locator(".island-file-drawer > summary").click();
  await expect(
    page.getByRole("region", { name: "Private source files" }),
  ).toBeVisible();
}
async function auth(page: Page) {
  const session = await page.request.post("/api/v1/dev/session", {
    headers: { "X-Local-Development": "worktracker" },
  });
  return { Authorization: "Bearer " + (await session.json()).access_token };
}

test("upload, inspect, review and approve a sourced task without preapproval effects", async ({
  page,
}) => {
  await start(page);
  const suffix = String(Date.now());
  const filename = `synthetic-${suffix}.txt`;
  const content = `Prepare the synthetic outline ${suffix} by Friday.\nReview the assessment ${suffix}.\n<script>window.injected=1</script>`;
  const headers = await auth(page);
  const composer = page.getByRole("textbox", {
    name: "Paste an email or type a request",
    exact: true,
  });
  await composer.fill("Keep my separate typed draft");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Draft saved");
  await page.getByLabel("Choose a source file", { exact: true }).setInputFiles({
    name: filename,
    mimeType: "text/plain",
    buffer: Buffer.from(content),
  });
  await page
    .getByRole("button", { name: "Upload privately", exact: true })
    .click();
  const asset = page.getByRole("article", {
    name: `Source file: ${filename}`,
    exact: true,
  });
  await expect(asset).toContainText("Text ready");
  await expect(page.locator(".proposal-card")).toHaveCount(0);
  expect(
    (
      await (
        await page.request.get("/api/v1/tasks?q=" + suffix, { headers })
      ).json()
    ).total,
  ).toBe(0);
  await asset
    .getByRole("button", { name: "View extracted text", exact: true })
    .click();
  await expect(asset.locator("pre")).toHaveText(content);
  await expect(asset.locator("script")).toHaveCount(0);
  const downloadEvent = page.waitForEvent("download");
  await asset
    .getByRole("button", { name: "Download original", exact: true })
    .click();
  expect((await downloadEvent).suggestedFilename()).toBe(filename);
  await asset
    .getByRole("button", { name: "Review file proposals", exact: true })
    .click();
  await expect(page.locator(".proposal-card")).toHaveCount(2);
  await expect(page.locator(".source-file-reference")).toContainText(filename);
  await expect(composer).toHaveValue("Keep my separate typed draft");
  expect(
    (
      await (
        await page.request.get("/api/v1/tasks?q=" + suffix, { headers })
      ).json()
    ).total,
  ).toBe(0);
  if (process.env.SOURCES_SCREENSHOT_PATH)
    await page.screenshot({ path: process.env.SOURCES_SCREENSHOT_PATH });
  await page
    .locator(".proposal-card")
    .first()
    .getByRole("button", { name: "Approve task", exact: true })
    .click();
  await expect(page.locator(".proposal-reviewed.approved")).toHaveCount(1);
  await page.getByRole("button", { name: "Open task", exact: true }).click();
  await expect(page.locator(".source-panel")).toContainText(filename);
  await page
    .getByRole("link", { name: "Open saved conversation", exact: true })
    .click();
  await expect(
    page.getByRole("article", {
      name: `Source file: ${filename}`,
      exact: true,
    }),
  ).toContainText("Text ready");
  await expect(page.locator(".proposal-reviewed.approved")).toHaveCount(1);
});

test("lost upload and file capture replies replay once after retry", async ({
  page,
}) => {
  await start(page);
  const filename = `retry-${Date.now()}.md`;
  let lostUpload = false,
    lostRun = false;
  await page.route("**/api/v1/conversations/*/sources", async (route) => {
    if (!lostUpload && route.request().method() === "POST") {
      lostUpload = true;
      await route.fetch();
      await route.abort("failed");
    } else await route.continue();
  });
  await page.getByLabel("Choose a source file", { exact: true }).setInputFiles({
    name: filename,
    mimeType: "text/markdown",
    buffer: Buffer.from("Prepare a retry fixture."),
  });
  await page
    .getByRole("button", { name: "Upload privately", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Retry saved action", exact: true })
    .click();
  await expect(page.locator(".source-file")).toHaveCount(1);
  await page.route("**/api/v1/conversations/*/runs", async (route) => {
    if (!lostRun && route.request().method() === "POST") {
      lostRun = true;
      await route.fetch();
      await route.abort("failed");
    } else await route.continue();
  });
  await page
    .getByRole("button", { name: "Review file proposals", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Retry saved action", exact: true })
    .click();
  await expect(page.locator(".proposal-card")).toHaveCount(1);
  await expect(page.locator(".capture-message.user")).toHaveCount(1);
  await page.reload();
  await expect(page.locator(".source-file")).toHaveCount(1);
  await expect(page.locator(".proposal-card")).toHaveCount(1);
});

test("mobile upload limits and quarantined email failures are clear", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await start(page);
  const picker = page.getByLabel("Choose a source file", { exact: true });
  await picker.setInputFiles({
    name: "oversize.txt",
    mimeType: "text/plain",
    buffer: Buffer.alloc(262145, 120),
  });
  await expect(page.getByRole("alert")).toContainText("up to 256 KB");
  await expect(
    page.getByRole("button", { name: "Upload privately", exact: true }),
  ).toBeDisabled();
  await picker.setInputFiles({
    name: "html.eml",
    mimeType: "message/rfc822",
    buffer: Buffer.from(
      "Subject: Synthetic\nContent-Type: text/html\n\n<p>Prepare a test</p>",
    ),
  });
  await page
    .getByRole("button", { name: "Upload privately", exact: true })
    .click();
  await expect(page.locator(".source-file")).toContainText("Extraction failed");
  await expect(page.locator(".source-file")).toContainText("quarantined");
  await expect(
    page.getByRole("button", { name: "Download original", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Review file proposals", exact: true }),
  ).toHaveCount(0);
  await expect(page.locator(".proposal-card")).toHaveCount(0);
  await page.reload();
  await expect(page.locator(".source-file")).toContainText("Extraction failed");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
