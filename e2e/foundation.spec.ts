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

test("completes the bilingual Job wage and employment-policy path through submission", async ({
  page,
}) => {
  const userId = "10000000-0000-4000-8000-000000000072";
  const categoryId = "20000000-0000-4000-8000-000000000072";
  const listingId = "30000000-0000-4000-8000-000000000072";
  let createdInput: Record<string, unknown> | null = null;
  let submitted = false;

  await page.route("**/v1/auth/session", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          user: { id: userId, displayName: "Synthetic Job Owner", avatarUrl: null },
          expiresAt: "2026-07-30T01:00:00.000Z",
          permissions: ["listing:create", "listing:submit"],
          platformRoles: [],
          organizations: [],
        },
      }),
    });
  });
  await page.route("**/v1/categories?vertical=JOB", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        data: [
          {
            id: categoryId,
            parentId: "20000000-0000-4000-8000-000000000070",
            vertical: "JOB",
            slug: "restaurant",
            name: { "zh-Hans": "餐饮服务", "en-US": "Restaurant & Food Service" },
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
            id: "40000000-0000-4000-8000-000000000072",
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
            key: "employerName",
            type: "TEXT",
            label: { "zh-Hans": "雇主或公司名称", "en-US": "Employer or company" },
            required: true,
            filterable: false,
            searchable: true,
            visibility: "PUBLIC",
            sortOrder: 10,
            validation: { minLength: 2, maxLength: 160 },
          },
          {
            key: "employmentType",
            type: "SELECT",
            label: { "zh-Hans": "雇佣类型", "en-US": "Employment type" },
            required: true,
            filterable: true,
            searchable: true,
            visibility: "PUBLIC",
            sortOrder: 20,
            options: [{ value: "full-time", label: { "zh-Hans": "全职", "en-US": "Full time" } }],
          },
          {
            key: "experienceLevel",
            type: "SELECT",
            label: { "zh-Hans": "经验要求", "en-US": "Experience level" },
            required: true,
            filterable: true,
            searchable: true,
            visibility: "PUBLIC",
            sortOrder: 30,
            options: [
              {
                value: "entry",
                label: { "zh-Hans": "入门/无需经验", "en-US": "Entry / no experience" },
              },
            ],
          },
          {
            key: "remoteType",
            type: "SELECT",
            label: { "zh-Hans": "办公方式", "en-US": "Work arrangement" },
            required: true,
            filterable: true,
            searchable: true,
            visibility: "PUBLIC",
            sortOrder: 40,
            options: [{ value: "onsite", label: { "zh-Hans": "现场", "en-US": "On-site" } }],
          },
          {
            key: "wageMax",
            type: "MONEY",
            label: { "zh-Hans": "最高薪资（美元）", "en-US": "Maximum wage (USD)" },
            required: true,
            filterable: true,
            searchable: false,
            visibility: "PUBLIC",
            sortOrder: 50,
            validation: { min: 0.01, max: 99999999.99 },
          },
          {
            key: "schedule",
            type: "TEXT",
            label: { "zh-Hans": "工作时间", "en-US": "Schedule" },
            required: true,
            filterable: false,
            searchable: true,
            visibility: "PUBLIC",
            sortOrder: 60,
            validation: { minLength: 2, maxLength: 160 },
          },
          {
            key: "employmentPolicyAcknowledged",
            type: "BOOLEAN",
            label: {
              "zh-Hans": "我确认职位条件和薪资信息真实，不含歧视性要求",
              "en-US":
                "I confirm the job terms and wage information are truthful and contain no discriminatory requirements",
            },
            required: true,
            filterable: false,
            searchable: false,
            visibility: "OWNER_ONLY",
            sortOrder: 100,
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
    createdInput = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({
      status: 201,
      headers: { etag: '"listing-v1"', "content-type": "application/json" },
      body: JSON.stringify({
        data: {
          id: listingId,
          type: "JOB",
          ownerId: userId,
          organizationId: null,
          formSchemaVersion: 1,
          status: "DRAFT",
          moderationStatus: "NOT_REVIEWED",
          locale: createdInput.locale,
          title: createdInput.title,
          slug: "e2e-synthetic-job",
          summary: createdInput.summary ?? null,
          body: createdInput.body,
          price: createdInput.price,
          region: {
            id: "40000000-0000-4000-8000-000000000072",
            type: "CITY",
            code: "US-CA-IRVINE",
            slug: "irvine",
            nameZhHans: "尔湾",
            nameEn: "Irvine",
            timezone: "America/Los_Angeles",
          },
          category: {
            id: categoryId,
            vertical: "JOB",
            slug: "restaurant",
            nameZhHans: "餐饮服务",
            nameEn: "Restaurant & Food Service",
          },
          owner: { id: userId, displayName: "Synthetic Job Owner", avatarUrl: null },
          organization: null,
          location: { precision: "CITY" },
          contactMode: "IN_APP",
          attributes: createdInput.attributes,
          mediaIds: [],
          isFeatured: false,
          featuredUntil: null,
          publishedAt: null,
          expiresAt: null,
          createdAt: "2026-07-29T01:00:00.000Z",
          updatedAt: "2026-07-29T01:00:00.000Z",
          version: 1,
        },
      }),
    });
  });
  await page.route(`**/v1/listings/${listingId}/submit`, async (route) => {
    submitted = true;
    await route.fulfill({
      status: 202,
      headers: { etag: '"listing-v3"', "content-type": "application/json" },
      body: JSON.stringify({
        data: {
          resourceId: listingId,
          previousStatus: "DRAFT",
          currentStatus: "PUBLISHED",
          previousModerationStatus: "NOT_REVIEWED",
          currentModerationStatus: "AUTO_APPROVED",
          riskTier: "LOW",
          ruleSetVersion: 2,
          caseId: null,
          occurredAt: "2026-07-29T01:01:00.000Z",
          version: 3,
        },
      }),
    });
  });

  const response = await page.goto("/zh-Hans/post/job/new");
  expect(response?.ok()).toBe(true);
  await expect(page.getByRole("heading", { level: 1, name: "发布招聘信息" })).toBeVisible();
  await page.getByLabel("招聘类别").selectOption(categoryId);
  await page.getByLabel("城市").selectOption("US-CA-IRVINE");
  await page.getByLabel("岗位名称").fill("尔湾餐厅厨房职位测试");
  await page
    .getByLabel("岗位说明与任职要求")
    .fill("这是仅供端到端验证使用的虚构招聘信息，不代表真实职位或招聘承诺。");
  await page.getByLabel("最低薪资").fill("24.00");
  await page.getByLabel(/雇主或公司名称/).fill("虚构测试雇主");
  await page.getByLabel(/雇佣类型/).selectOption("full-time");
  await page.getByLabel(/经验要求/).selectOption("entry");
  await page.getByLabel(/办公方式/).selectOption("onsite");
  await page.getByLabel(/最高薪资/).fill("31.50");
  await page.getByLabel(/工作时间/).fill("周一至周五测试班次");
  await page.getByLabel(/我确认职位条件和薪资信息真实/).check();
  await page.getByRole("button", { name: "立即保存" }).click();
  await expect(page.getByText("已保存到服务器")).toBeVisible();
  expect(createdInput).toMatchObject({
    type: "JOB",
    price: { amount: "24.00", currency: "USD", unit: "HOURLY" },
    attributes: {
      employerName: "虚构测试雇主",
      employmentType: "full-time",
      experienceLevel: "entry",
      remoteType: "onsite",
      wageMax: "31.50",
      employmentPolicyAcknowledged: true,
    },
  });

  await page.getByRole("button", { name: "提交审核" }).click();
  await expect(page.getByText(/已提交；平台会按风险规则/)).toBeVisible();
  expect(submitted).toBe(true);
  await expect(page.getByRole("link", { name: "Switch to English" })).toHaveAttribute(
    "href",
    "/en-US/post/job/new",
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});

test("renders and updates the private bilingual notification center", async ({ page }) => {
  const userId = "10000000-0000-4000-8000-000000000081";
  const notificationId = "20000000-0000-4000-8000-000000000081";
  const listingId = "30000000-0000-4000-8000-000000000081";
  let status: "UNREAD" | "READ" = "UNREAD";
  let readAt: string | null = null;

  await page.route("**/v1/auth/session", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          user: { id: userId, displayName: "Synthetic E2E Owner", avatarUrl: null },
          expiresAt: "2026-07-30T01:00:00.000Z",
          permissions: ["notification:read", "notification:update"],
          platformRoles: [],
          organizations: [],
        },
      }),
    });
  });
  await page.route("**/v1/notifications?**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        data: [
          {
            id: notificationId,
            templateKey: "listing.published",
            templateVersion: 1,
            locale: "zh-Hans",
            title: "信息已发布",
            body: "您的出租信息已公开。",
            resource: { type: "LISTING", id: listingId },
            status,
            createdAt: "2026-07-29T01:00:00.000Z",
            readAt,
          },
        ],
        pageInfo: { hasMore: false, nextCursor: null },
        unreadCount: status === "UNREAD" ? 1 : 0,
        generatedAt: "2026-07-29T01:01:00.000Z",
      }),
    });
  });
  await page.route(`**/v1/notifications/${notificationId}/read`, async (route) => {
    status = "READ";
    readAt = "2026-07-29T01:02:00.000Z";
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          id: notificationId,
          templateKey: "listing.published",
          templateVersion: 1,
          locale: "zh-Hans",
          title: "信息已发布",
          body: "您的出租信息已公开。",
          resource: { type: "LISTING", id: listingId },
          status,
          createdAt: "2026-07-29T01:00:00.000Z",
          readAt,
        },
      }),
    });
  });

  const response = await page.goto("/zh-Hans/account/notifications");
  expect(response?.ok()).toBe(true);
  await expect(page.getByRole("heading", { level: 1, name: "站内通知" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "信息已发布" })).toBeVisible();
  await expect(page.getByText("1 条未读")).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
    "content",
    /noindex.*nofollow|nofollow.*noindex/,
  );

  await page.getByRole("button", { name: "标记为已读" }).click();
  await expect(page.getByText("0 条未读")).toBeVisible();
  await expect(page.getByRole("button", { name: "标记为已读" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Switch to English" })).toHaveAttribute(
    "href",
    "/en-US/account/notifications",
  );
  await expect(page.locator('[data-locale="zh-Hans"]')).toHaveAttribute("lang", "zh-Hans");
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
  expect(Object.keys(contract.paths)).toHaveLength(57);
  expect(Object.keys(contract.components.schemas)).toHaveLength(123);

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
