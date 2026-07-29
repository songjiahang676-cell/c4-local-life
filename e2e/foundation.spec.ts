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

test("completes the bilingual rental form and recovers its account-scoped autosave", async ({
  page,
}) => {
  const userId = "10000000-0000-4000-8000-000000000071";
  const categoryId = "20000000-0000-4000-8000-000000000071";
  const listingId = "30000000-0000-4000-8000-000000000071";
  let ownerListing: Record<string, unknown> | null = null;

  await page.route("**/v1/auth/session", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          user: { id: userId, displayName: "Synthetic E2E Owner", avatarUrl: null },
          expiresAt: "2026-07-30T01:00:00.000Z",
          permissions: ["listing:create"],
          platformRoles: [],
          organizations: [],
        },
      }),
    });
  });
  await page.route("**/v1/categories?vertical=RENTAL", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        data: [
          {
            id: categoryId,
            parentId: "20000000-0000-4000-8000-000000000070",
            vertical: "RENTAL",
            slug: "apartment",
            name: { "zh-Hans": "公寓", "en-US": "Apartment" },
            iconKey: null,
            formSchemaVersion: 1,
            children: [],
          },
        ],
      }),
    });
  });
  await page.route("**/v1/regions?type=CITY", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        data: [
          {
            id: "40000000-0000-4000-8000-000000000071",
            parentId: "40000000-0000-4000-8000-000000000070",
            code: "US-CA-IRVINE",
            type: "CITY",
            slug: "irvine",
            name: { "zh-Hans": "尔湾", "en-US": "Irvine" },
            timezone: "America/Los_Angeles",
            centroid: null,
            children: [],
          },
        ],
      }),
    });
  });
  await page.route(`**/v1/categories/${categoryId}/form-schema`, async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        categoryId,
        version: 1,
        fields: [
          {
            key: "bedrooms",
            type: "NUMBER",
            label: { "zh-Hans": "卧室数", "en-US": "Bedrooms" },
            required: true,
            filterable: true,
            searchable: false,
            visibility: "PUBLIC",
            sortOrder: 10,
            validation: { min: 0, max: 20 },
          },
        ],
        publicationPolicy: {
          defaultLifetimeDays: 30,
          manualReviewRequired: false,
          phoneVerificationRequired: false,
          maxMedia: 20,
          allowExactAddress: false,
        },
      }),
    });
  });
  await page.route("**/v1/listings", async (route) => {
    const input = route.request().postDataJSON() as Record<string, unknown>;
    ownerListing = {
      id: listingId,
      type: "RENTAL",
      ownerId: userId,
      organizationId: null,
      formSchemaVersion: 1,
      status: "DRAFT",
      moderationStatus: "NOT_REVIEWED",
      locale: input.locale,
      title: input.title,
      slug: "e2e-synthetic-rental",
      summary: input.summary ?? null,
      body: input.body,
      price: input.price,
      region: {
        id: "40000000-0000-4000-8000-000000000071",
        type: "CITY",
        code: "US-CA-IRVINE",
        slug: "irvine",
        nameZhHans: "尔湾",
        nameEn: "Irvine",
        timezone: "America/Los_Angeles",
      },
      category: {
        id: categoryId,
        vertical: "RENTAL",
        slug: "apartment",
        nameZhHans: "公寓",
        nameEn: "Apartment",
      },
      owner: { id: userId, displayName: "Synthetic E2E Owner", avatarUrl: null },
      organization: null,
      location: { precision: "CITY" },
      contactMode: "IN_APP",
      attributes: input.attributes,
      mediaIds: [],
      isFeatured: false,
      featuredUntil: null,
      publishedAt: null,
      expiresAt: null,
      createdAt: "2026-07-29T01:00:00.000Z",
      updatedAt: "2026-07-29T01:00:00.000Z",
      version: 1,
    };
    await route.fulfill({
      status: 201,
      headers: { etag: '"listing-v1"', "content-type": "application/json" },
      body: JSON.stringify({ data: ownerListing }),
    });
  });
  await page.route(`**/v1/listings/${listingId}`, async (route) => {
    if (!ownerListing) {
      await route.fulfill({ status: 404 });
      return;
    }
    if (route.request().method() === "PATCH") {
      const input = route.request().postDataJSON() as Record<string, unknown>;
      ownerListing = {
        ...ownerListing,
        ...input,
        summary: input.summary ?? null,
        version: 2,
        updatedAt: "2026-07-29T01:01:00.000Z",
      };
    }
    await route.fulfill({
      headers: {
        etag: route.request().method() === "PATCH" ? '"listing-v2"' : '"listing-v1"',
        "content-type": "application/json",
      },
      body: JSON.stringify({ data: ownerListing }),
    });
  });

  const response = await page.goto("/zh-Hans/post/rental/new");
  expect(response?.ok()).toBe(true);
  await expect(page.getByRole("heading", { level: 1, name: "发布出租房源" })).toBeVisible();
  await page.getByLabel("房屋类型").selectOption(categoryId);
  await page.getByLabel("城市").selectOption("US-CA-IRVINE");
  await page.getByLabel("标题").fill("尔湾公寓出租测试");
  await page
    .getByLabel("详细说明")
    .fill("这是仅供端到端自动保存验证使用的虚构房源内容，不是真实生产信息。");
  await page.getByLabel("租金").fill("2450.00");
  await page.getByLabel("卧室数").fill("2");
  await page.getByRole("button", { name: "立即保存" }).click();
  await expect(page.getByText("已保存到服务器")).toBeVisible();
  expect(ownerListing).toMatchObject({
    title: "尔湾公寓出租测试",
    attributes: { bedrooms: 2 },
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );

  await page.reload();
  await expect(page.getByText("已恢复此账号在本机保存的内容。")).toBeVisible();
  await expect(page.getByLabel("标题")).toHaveValue("尔湾公寓出租测试");
  await expect(page.getByRole("link", { name: "Switch to English" })).toHaveAttribute(
    "href",
    "/en-US/post/rental/new",
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
  expect(Object.keys(contract.paths)).toHaveLength(46);
  expect(Object.keys(contract.components.schemas)).toHaveLength(108);

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
