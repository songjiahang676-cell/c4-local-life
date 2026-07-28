import { expect, test } from "@playwright/test";

const apiBaseUrl = "http://127.0.0.1:4100/v1";
const adminBaseUrl = "http://127.0.0.1:3101";

test("renders the localized public homepage at desktop and mobile widths", async ({ page }) => {
  const response = await page.goto("/zh-Hans");

  expect(response?.ok()).toBe(true);
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "洛杉矶华人生活 一站式服务平台",
    }),
  ).toBeVisible();
  await expect(page.getByRole("search")).toBeVisible();
  const languageLink = page.getByRole("link", { name: /中文 \/ English/ });
  await expect(languageLink).toBeVisible();
  await expect(languageLink).toHaveAttribute("href", "/en-US");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});

test("serves API health, canonical OpenAPI, and sanitized validation errors", async ({
  request,
}) => {
  const [healthResponse, contractResponse, invalidResponse] = await Promise.all([
    request.get(`${apiBaseUrl}/health/live`, {
      headers: { "x-request-id": "playwright-foundation-smoke" },
    }),
    request.get("http://127.0.0.1:4100/docs/openapi.json"),
    request.get(`${apiBaseUrl}/listings?unknown=not-allowed`),
  ]);

  expect(healthResponse.ok()).toBe(true);
  expect(healthResponse.headers()["x-request-id"]).toBe("playwright-foundation-smoke");

  const contract = (await contractResponse.json()) as {
    openapi: string;
    paths: Record<string, unknown>;
    components: { schemas: Record<string, unknown> };
  };
  expect(contractResponse.ok()).toBe(true);
  expect(contract.openapi).toMatch(/^3\.1\./);
  expect(Object.keys(contract.paths)).toHaveLength(38);
  expect(Object.keys(contract.components.schemas)).toHaveLength(75);

  const problem = (await invalidResponse.json()) as Record<string, unknown>;
  expect(invalidResponse.status()).toBe(400);
  expect(invalidResponse.headers()["content-type"]).toContain("application/problem+json");
  expect(problem).toMatchObject({
    title: "Bad Request",
    status: 400,
    detail: "Request validation failed",
  });
  expect(problem).not.toHaveProperty("stack");
});

test("renders the no-store Admin login boundary without privileged navigation", async ({
  page,
  request,
}) => {
  const response = await page.goto(`${adminBaseUrl}/admin`);

  expect(response?.ok()).toBe(true);
  expect(response?.headers()["cache-control"]).toContain("no-store");
  expect(response?.headers()["content-security-policy"]).toContain("frame-ancestors 'none'");
  await expect(page.getByRole("heading", { level: 1, name: "运营人员登录" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "工作邮箱" })).toBeVisible();
  await expect(page.getByRole("button", { name: "发送验证码" })).toBeVisible();
  await expect(page.getByRole("navigation")).toHaveCount(0);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
    "content",
    /noindex.*nofollow|nofollow.*noindex/,
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.getByRole("combobox", { name: "语言" }).selectOption("en-US");
  await expect(page.locator("html")).toHaveAttribute("lang", "en-US");
  await expect(page).toHaveTitle("Admin Console | SoCal Life");
  await expect(page.getByRole("heading", { level: 1, name: "Operator sign in" })).toBeVisible();

  const [blockedProxyResponse, blockedOtpResponse] = await Promise.all([
    request.get(`${adminBaseUrl}/v1/listings`),
    request.post(`${adminBaseUrl}/v1/auth/otp/unexpected`),
  ]);
  for (const blockedResponse of [blockedProxyResponse, blockedOtpResponse]) {
    expect(blockedResponse.status()).toBe(404);
    expect(blockedResponse.headers()["cache-control"]).toContain("no-store");
  }
});
