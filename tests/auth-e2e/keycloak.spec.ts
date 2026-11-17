import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
async function actionLink(page: Page, email: string, subject: string) {
  let text = "";
  await expect
    .poll(
      async () => {
        const response = await page.request.get(
          "http://127.0.0.1:8025/api/v1/search",
          { params: { query: `to:${email} subject:${subject}` } },
        );
        const list = await response.json();
        if (!list.messages?.length) return false;
        const result = await (
          await page.request.get(
            "http://127.0.0.1:8025/api/v1/message/" + list.messages[0].ID,
          )
        ).json();
        text = result.Text || result.HTML;
        return text.includes("/login-actions/action-token");
      },
      { timeout: 20000 },
    )
    .toBe(true);
  const match = text.match(/http:\/\/127\.0\.0\.1:8088[^\s"<>]+/);
  expect(match).not.toBeNull();
  return match![0].replaceAll("&amp;", "&");
}

test("real Keycloak registration, email verification, invite, private session, logout and recovery", async ({
  page,
}) => {
  const fixture = JSON.parse(
    readFileSync(".local/auth-e2e-fixture.json", "utf8"),
  );
  await page.goto("/app/today");
  await expect(
    page.getByRole("region", { name: "Workroom sign-in" }),
  ).toBeVisible();
  if (process.env.AUTH_SCREENSHOT_DIR)
    await page.screenshot({
      animations: "disabled",
      path: process.env.AUTH_SCREENSHOT_DIR + "/workroom-sign-in.png",
    });
  await page
    .getByRole("link", { name: "Sign in with Keycloak", exact: true })
    .click();
  await page.getByRole("link", { name: "Register", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Email", exact: true })
    .fill(fixture.email);
  await page
    .getByRole("textbox", { name: "First name", exact: true })
    .fill("Browser");
  await page
    .getByRole("textbox", { name: "Last name", exact: true })
    .fill("Fixture");
  await page.getByRole("button", { name: "Register", exact: true }).click();
  await expect(
    page.getByText(
      "You need to verify your email address to activate your account.",
      { exact: false },
    ),
  ).toBeVisible();
  await page.goto(await actionLink(page, fixture.email, "Verify"));
  await expect(
    page.getByRole("heading", { name: "Update password", exact: true }),
  ).toBeVisible();
  await page.locator('input[type="password"]').nth(0).fill(fixture.password);
  await page.locator('input[type="password"]').nth(1).fill(fixture.password);
  await page.getByRole("button", { name: "Submit", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Workspace timezone", exact: true }),
  ).toBeVisible();
  expect(
    (await (await page.request.get("/api/v1/tasks")).json()).error.code,
  ).toBe("forbidden");
  await page
    .getByLabel("Invitation code", { exact: true })
    .fill(fixture.invitation);
  await page
    .getByRole("button", { name: "Redeem invitation", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "New task", exact: true }),
  ).toBeEnabled();
  const state = await (await page.request.get("/api/v1/auth/session")).json();
  expect(state.authenticated).toBe(true);
  expect(state.has_workspace).toBe(true);
  const cookies = await page.context().cookies();
  expect(
    cookies.find((cookie) => cookie.name === "workroom_session")?.httpOnly,
  ).toBe(true);
  expect(
    await page.evaluate(() => localStorage.getItem("access_token")),
  ).toBeNull();
  const headers = {
    Origin: "http://127.0.0.1:5175",
    "X-CSRF-Token": state.csrf_token,
    "Idempotency-Key": crypto.randomUUID(),
  };
  const created = await page.request.post("/api/v1/tasks", {
    headers,
    data: { title: "Real Keycloak private fixture" },
  });
  expect(created.status()).toBe(201);
  await page.reload();
  await expect(
    page.getByText("Real Keycloak private fixture", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  const providerLogout = page.getByRole("button", {
    name: "Logout",
    exact: true,
  });
  await expect(providerLogout).toBeVisible();
  await providerLogout.click();
  await expect(
    page.getByRole("link", { name: "Sign in with Keycloak", exact: true }),
  ).toBeVisible();
  expect(
    (await (await page.request.get("/api/v1/auth/session")).json())
      .authenticated,
  ).toBe(false);
  expect((await page.request.get("/api/v1/tasks")).status()).toBe(401);
  await page
    .getByRole("link", { name: "Sign in with Keycloak", exact: true })
    .click();
  await page
    .getByRole("link", { name: "Forgot Password?", exact: false })
    .click();
  await page
    .getByRole("textbox", { name: "Email", exact: true })
    .fill(fixture.email);
  await page.getByRole("button", { name: "Submit", exact: true }).click();
  await page.goto(await actionLink(page, fixture.email, "Reset"));
  await page
    .locator('input[type="password"]')
    .nth(0)
    .fill(fixture.new_password);
  await page
    .locator('input[type="password"]')
    .nth(1)
    .fill(fixture.new_password);
  await page.getByRole("button", { name: "Submit", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "New task", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByText("Real Keycloak private fixture", { exact: true }),
  ).toBeVisible();
});
