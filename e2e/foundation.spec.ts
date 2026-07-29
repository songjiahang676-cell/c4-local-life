import { expect, test } from "@playwright/test";

const apiBaseUrl = "http://127.0.0.1:4100/v1";
const adminBaseUrl = "http://127.0.0.1:3101";

test("renders the localized public homepage at desktop and mobile widths", async ({ page }) => {
  const response = await page.goto("/zh-Hans");

  expect(response?.ok()).toBe(true);
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "南加州华人生活，一站式本地服务",
    }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "最新租房" })).toBeVisible();
  await expect(page.getByText("Synthetic public listing")).toBeVisible();
  await expect(page.getByText("测试城市")).toBeVisible();
  await expect(page.getByText("256,893")).toHaveCount(0);
  await expect(page.getByText("鼎泰丰")).toHaveCount(0);
  await expect(page.getByText("首页广告位合作")).toHaveCount(0);
  await expect(page.getByRole("banner").getByRole("search")).toBeVisible();
  const languageLink = page.getByRole("link", { name: /中文 \/ English/ });
  await expect(languageLink).toBeVisible();
  await expect(languageLink).toHaveAttribute("href", "/en-US");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});

test("renders bilingual public Listing filters and sponsored status from SSR data", async ({
  page,
  request,
}) => {
  const ssrResponse = await request.get("/en-US/rentals?q=synthetic");
  const html = await ssrResponse.text();
  expect(ssrResponse.ok()).toBe(true);
  expect(html).toContain("Synthetic public listing");

  const response = await page.goto("/en-US/rentals?q=synthetic");
  expect(response?.ok()).toBe(true);
  await expect(page.getByRole("heading", { level: 1, name: "Rentals" })).toBeVisible();
  await expect(page.getByRole("search", { name: "Filters" })).toBeVisible();
  await expect(page.getByLabel("Keywords")).toHaveValue("synthetic");
  await expect(page.getByRole("heading", { name: "Synthetic public listing" })).toBeVisible();
  await expect(page.getByText("Sponsored")).toBeVisible();
  await expect(page.getByText("Active")).toBeVisible();
  await expect(page.getByText("Verified organization")).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex.*follow/);
  await expect(page.getByRole("link", { name: "简体中文" })).toHaveAttribute(
    "href",
    "/zh-Hans/rentals",
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});

test("renders the strict public Listing detail and generic invalid-filter recovery", async ({
  page,
}) => {
  const listingId = "91000000-0000-4000-8000-000000000001";
  const detailResponse = await page.goto(
    `/en-US/rentals/synthetic-city/synthetic-public-listing-${listingId}`,
  );
  expect(detailResponse?.ok()).toBe(true);
  await expect(
    page.getByRole("heading", { level: 1, name: "Synthetic public listing" }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "This fictional description is rendered on the server and contains no real user data.",
    ),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Safety reminder" })).toBeVisible();
  await expect(page.getByText("Sponsored")).toBeVisible();
  await expect(page.getByText("Verified organization").first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );

  const invalidResponse = await page.goto("/zh-Hans/rentals?minPrice=3000&maxPrice=1000");
  expect(invalidResponse?.ok()).toBe(true);
  await expect(page.getByRole("heading", { level: 1, name: "筛选条件无效" })).toBeVisible();
  await expect(page.getByText(/请检查价格范围/)).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex.*follow/);
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
          ruleSetVersion: 3,
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

test("completes Transfer, Secondhand, and Service forms through save and submission", async ({
  page,
}) => {
  const userId = "10000000-0000-4000-8000-000000000073";
  const regionId = "40000000-0000-4000-8000-000000000073";
  const specs = [
    {
      type: "TRANSFER" as const,
      route: "transfer",
      categoryId: "20000000-0000-4000-8000-000000000073",
      categoryZh: "零售转让",
      categoryEn: "Retail transfer",
      heading: "发布生意转让",
      fields: [
        {
          key: "businessType",
          type: "SELECT",
          label: { "zh-Hans": "业务类型", "en-US": "Business type" },
          required: true,
          filterable: true,
          searchable: true,
          visibility: "PUBLIC",
          sortOrder: 10,
          options: [{ value: "retail", label: { "zh-Hans": "零售", "en-US": "Retail" } }],
        },
        {
          key: "monthlyRent",
          type: "MONEY",
          label: { "zh-Hans": "每月租金（美元）", "en-US": "Monthly rent (USD)" },
          required: true,
          filterable: true,
          searchable: false,
          visibility: "PUBLIC",
          sortOrder: 20,
          validation: { min: 0, max: 9999999999.99 },
        },
        {
          key: "leaseRemainingMonths",
          type: "NUMBER",
          label: { "zh-Hans": "剩余租期（月）", "en-US": "Lease remaining (months)" },
          required: true,
          filterable: true,
          searchable: false,
          visibility: "PUBLIC",
          sortOrder: 30,
          validation: { min: 0, max: 1200 },
        },
        {
          key: "reasonForTransfer",
          type: "TEXTAREA",
          label: { "zh-Hans": "转让原因", "en-US": "Reason for transfer" },
          required: true,
          filterable: false,
          searchable: true,
          visibility: "PUBLIC",
          sortOrder: 40,
          validation: { minLength: 5, maxLength: 300 },
        },
        {
          key: "financialDisclaimerAcknowledged",
          type: "BOOLEAN",
          label: { "zh-Hans": "我确认经营数据由发布者提供", "en-US": "Seller-reported figures" },
          required: true,
          filterable: false,
          searchable: false,
          visibility: "OWNER_ONLY",
          sortOrder: 100,
        },
      ],
      expected: {
        price: { amount: "125000.00", currency: "USD", unit: "FIXED" },
        attributes: {
          businessType: "retail",
          monthlyRent: "2500.00",
          leaseRemainingMonths: 24,
          reasonForTransfer: "虚构业主搬迁测试",
          financialDisclaimerAcknowledged: true,
        },
      },
      fill: async () => {
        await page.getByLabel("转让类别").selectOption("20000000-0000-4000-8000-000000000073");
        await page.getByLabel("城市").selectOption("US-CA-IRVINE");
        await page.getByLabel("生意或资产名称").fill("尔湾零售店转让测试");
        await page
          .getByLabel("经营情况与转让说明")
          .fill("这是仅供端到端验证使用的虚构转让信息，不代表真实经营数据或交易承诺。");
        await page.getByLabel("转让价").fill("125000.00");
        await page.getByLabel(/业务类型/).selectOption("retail");
        await page.getByLabel(/每月租金/).fill("2500.00");
        await page.getByLabel(/剩余租期/).fill("24");
        await page.getByLabel(/转让原因/).fill("虚构业主搬迁测试");
        await page.getByLabel(/我确认经营数据由发布者提供/).check();
      },
    },
    {
      type: "SECONDHAND" as const,
      route: "secondhand",
      categoryId: "20000000-0000-4000-8000-000000000074",
      categoryZh: "二手家具",
      categoryEn: "Used furniture",
      heading: "发布二手物品",
      fields: [
        {
          key: "condition",
          type: "SELECT",
          label: { "zh-Hans": "物品成色", "en-US": "Condition" },
          required: true,
          filterable: true,
          searchable: false,
          visibility: "PUBLIC",
          sortOrder: 10,
          options: [{ value: "good", label: { "zh-Hans": "良好", "en-US": "Good" } }],
        },
        {
          key: "deliveryOptions",
          type: "MULTISELECT",
          label: { "zh-Hans": "交付方式", "en-US": "Delivery options" },
          required: true,
          filterable: true,
          searchable: false,
          visibility: "PUBLIC",
          sortOrder: 20,
          options: [{ value: "pickup", label: { "zh-Hans": "自取", "en-US": "Pickup" } }],
        },
        {
          key: "marketplacePolicyAcknowledged",
          type: "BOOLEAN",
          label: { "zh-Hans": "我确认物品合法且不属于禁售品", "en-US": "Lawful item policy" },
          required: true,
          filterable: false,
          searchable: false,
          visibility: "OWNER_ONLY",
          sortOrder: 100,
        },
      ],
      expected: {
        price: { amount: "180.00", currency: "USD", unit: "FIXED" },
        attributes: {
          condition: "good",
          deliveryOptions: ["pickup"],
          marketplacePolicyAcknowledged: true,
        },
      },
      fill: async () => {
        await page.getByLabel("二手类别").selectOption("20000000-0000-4000-8000-000000000074");
        await page.getByLabel("城市").selectOption("US-CA-IRVINE");
        await page.getByLabel("物品名称").fill("尔湾木桌二手测试");
        await page
          .getByLabel("成色、使用情况与交付说明")
          .fill("这是仅供端到端验证使用的虚构二手物品，不代表真实库存或交易承诺。");
        await page.getByLabel("价格", { exact: true }).fill("180.00");
        await page.getByLabel(/物品成色/).selectOption("good");
        await page.getByLabel("自取").check();
        await page.getByLabel(/我确认物品合法且不属于禁售品/).check();
      },
    },
    {
      type: "SERVICE" as const,
      route: "service",
      categoryId: "20000000-0000-4000-8000-000000000075",
      categoryZh: "家庭清洁",
      categoryEn: "Home cleaning",
      heading: "发布本地服务",
      fields: [
        {
          key: "serviceRadiusMiles",
          type: "NUMBER",
          label: { "zh-Hans": "服务半径（英里）", "en-US": "Service radius (miles)" },
          required: true,
          filterable: true,
          searchable: false,
          visibility: "PUBLIC",
          sortOrder: 10,
          validation: { min: 1, max: 100 },
        },
        {
          key: "availability",
          type: "MULTISELECT",
          label: { "zh-Hans": "可服务时间", "en-US": "Availability" },
          required: true,
          filterable: true,
          searchable: false,
          visibility: "PUBLIC",
          sortOrder: 20,
          options: [{ value: "weekdays", label: { "zh-Hans": "工作日", "en-US": "Weekdays" } }],
        },
        {
          key: "servicePolicyAcknowledged",
          type: "BOOLEAN",
          label: { "zh-Hans": "我确认服务声明由发布者提供", "en-US": "Provider-reported claims" },
          required: true,
          filterable: false,
          searchable: false,
          visibility: "OWNER_ONLY",
          sortOrder: 100,
        },
      ],
      expected: {
        price: { amount: "95.00", currency: "USD", unit: "HOURLY" },
        attributes: {
          serviceRadiusMiles: 20,
          availability: ["weekdays"],
          servicePolicyAcknowledged: true,
        },
      },
      fill: async () => {
        await page.getByLabel("服务类别").selectOption("20000000-0000-4000-8000-000000000075");
        await page.getByLabel("城市").selectOption("US-CA-IRVINE");
        await page.getByLabel("服务名称").fill("尔湾家庭清洁服务测试");
        await page
          .getByLabel("服务内容、经验与范围说明")
          .fill("这是仅供端到端验证使用的虚构本地服务，不代表真实资质或服务承诺。");
        await page.getByLabel("起步价或时薪").fill("95.00");
        await page.getByLabel(/服务半径/).fill("20");
        await page.getByLabel("工作日").check();
        await page.getByLabel(/我确认服务声明由发布者提供/).check();
      },
    },
  ] as const;
  let active: (typeof specs)[number] = specs[0];
  const created = new Map<string, Record<string, unknown>>();
  const submitted = new Set<string>();

  await page.route("**/v1/auth/session", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          user: { id: userId, displayName: "Synthetic Vertical Owner", avatarUrl: null },
          expiresAt: "2026-07-30T01:00:00.000Z",
          permissions: ["listing:create", "listing:submit"],
          platformRoles: [],
          organizations: [],
        },
      }),
    });
  });
  await page.route("**/v1/categories?vertical=*", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        data: [
          {
            id: active.categoryId,
            parentId: "20000000-0000-4000-8000-000000000070",
            vertical: active.type,
            slug: active.route,
            name: { "zh-Hans": active.categoryZh, "en-US": active.categoryEn },
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
            id: regionId,
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
  await page.route("**/v1/categories/*/form-schema", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        categoryId: active.categoryId,
        version: 1,
        fields: active.fields,
        publicationPolicy: {
          defaultLifetimeDays: active.type === "SERVICE" ? 90 : 45,
          manualReviewRequired: active.type === "TRANSFER",
          phoneVerificationRequired: false,
          maxMedia: 20,
          allowExactAddress: false,
        },
      }),
    });
  });
  await page.route("**/v1/listings", async (route) => {
    const input = route.request().postDataJSON() as Record<string, unknown>;
    created.set(active.type, input);
    const listingId =
      active.type === "TRANSFER"
        ? "30000000-0000-4000-8000-000000000073"
        : active.type === "SECONDHAND"
          ? "30000000-0000-4000-8000-000000000074"
          : "30000000-0000-4000-8000-000000000075";
    await route.fulfill({
      status: 201,
      headers: { etag: '"listing-v1"', "content-type": "application/json" },
      body: JSON.stringify({
        data: {
          id: listingId,
          type: active.type,
          ownerId: userId,
          organizationId: null,
          formSchemaVersion: 1,
          status: "DRAFT",
          moderationStatus: "NOT_REVIEWED",
          locale: input.locale,
          title: input.title,
          slug: `e2e-synthetic-${active.route}`,
          summary: input.summary ?? null,
          body: input.body,
          price: input.price,
          region: {
            id: regionId,
            type: "CITY",
            code: "US-CA-IRVINE",
            slug: "irvine",
            nameZhHans: "尔湾",
            nameEn: "Irvine",
            timezone: "America/Los_Angeles",
          },
          category: {
            id: active.categoryId,
            vertical: active.type,
            slug: active.route,
            nameZhHans: active.categoryZh,
            nameEn: active.categoryEn,
          },
          owner: { id: userId, displayName: "Synthetic Vertical Owner", avatarUrl: null },
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
        },
      }),
    });
  });
  await page.route("**/v1/listings/*/submit", async (route) => {
    submitted.add(active.type);
    await route.fulfill({
      status: 202,
      headers: { etag: '"listing-v3"', "content-type": "application/json" },
      body: JSON.stringify({
        data: {
          resourceId: route.request().url().split("/").at(-2),
          previousStatus: "DRAFT",
          currentStatus: active.type === "TRANSFER" ? "SUBMITTED" : "PUBLISHED",
          previousModerationStatus: "NOT_REVIEWED",
          currentModerationStatus: active.type === "TRANSFER" ? "PENDING_REVIEW" : "AUTO_APPROVED",
          riskTier: active.type === "TRANSFER" ? "MEDIUM" : "LOW",
          ruleSetVersion: 3,
          caseId: active.type === "TRANSFER" ? "50000000-0000-4000-8000-000000000073" : null,
          occurredAt: "2026-07-29T01:01:00.000Z",
          version: 3,
        },
      }),
    });
  });

  for (const spec of specs) {
    active = spec;
    const response = await page.goto(`/zh-Hans/post/${spec.route}/new`);
    expect(response?.ok()).toBe(true);
    await expect(page.getByRole("heading", { level: 1, name: spec.heading })).toBeVisible();
    await spec.fill();
    await page.getByRole("button", { name: "立即保存" }).click();
    await expect(page.getByText("已保存到服务器")).toBeVisible();
    expect(created.get(spec.type)).toMatchObject({
      type: spec.type,
      ...spec.expected,
    });
    await page.getByRole("button", { name: "提交审核" }).click();
    await expect(page.getByText(/已提交；平台会按风险规则/)).toBeVisible();
    expect(submitted.has(spec.type)).toBe(true);
    await expect(page.getByRole("link", { name: "切换到英文" })).toHaveAttribute(
      "href",
      `/en-US/post/${spec.route}/new`,
    );
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  }
});

test("renders a private capability-scoped account shell without indexing or overflow", async ({
  page,
}) => {
  await page.route("**/v1/auth/session", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          user: {
            id: "10000000-0000-4000-8000-000000000080",
            displayName: "Synthetic Account Owner",
            avatarUrl: null,
            locale: "en-US",
            status: "ACTIVE",
            verificationBadges: [],
          },
          expiresAt: "2099-07-30T01:00:00.000Z",
          permissions: ["account:listings:read", "listing:draft:create"],
          platformRoles: [],
          organizations: [
            {
              id: "20000000-0000-4000-8000-000000000080",
              type: "MERCHANT",
              displayName: "Synthetic Merchant",
              slug: "synthetic-merchant",
              role: "OWNER",
            },
          ],
        },
      }),
    });
  });

  const response = await page.goto("/en-US/account");

  expect(response?.ok()).toBe(true);
  expect(response?.headers()["cache-control"]).toContain("no-store");
  await expect(page).toHaveTitle(/Account Center/);
  await expect(
    page.getByRole("heading", { level: 1, name: "Welcome, Synthetic Account Owner" }),
  ).toBeVisible();
  const navigation = page.getByRole("navigation", { name: "Account center navigation" });
  await expect(navigation.getByRole("link", { name: "My listings" })).toHaveAttribute(
    "href",
    "/en-US/account/listings",
  );
  await expect(navigation.getByRole("link", { name: "Post a listing" })).toHaveAttribute(
    "href",
    "/en-US/post/rental/new",
  );
  await expect(navigation.getByRole("link", { name: "Notifications" })).toHaveCount(0);
  await expect(page.getByText("Synthetic Merchant")).toBeVisible();
  await expect(page.getByText("Merchant · Owner")).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
    "content",
    /noindex.*nofollow|nofollow.*noindex/,
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});

test("renders the private listing-management sign-in boundary without indexing or overflow", async ({
  page,
}) => {
  await page.route("**/v1/auth/session", async (route) => {
    await route.fulfill({
      status: 401,
      contentType: "application/problem+json",
      body: JSON.stringify({
        type: "https://socal.life/problems/unauthorized",
        title: "Unauthorized",
        status: 401,
        detail: "Authentication required",
        instance: "/v1/auth/session",
        requestId: "playwright-account-listings-guest",
      }),
    });
  });

  const response = await page.goto("/en-US/account/listings");

  expect(response?.ok()).toBe(true);
  expect(response?.headers()["cache-control"]).toContain("no-store");
  await expect(page).toHaveTitle(/My Listings/);
  await expect(page.getByRole("heading", { level: 1, name: "My listings" })).toBeVisible();
  await expect(
    page.getByRole("heading", { level: 2, name: "Sign in to manage listings" }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Sign in" })).toHaveAttribute(
    "href",
    "/en-US/auth/login?returnTo=%2Fen-US%2Faccount%2Flistings",
  );
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
    "content",
    /noindex.*nofollow|nofollow.*noindex/,
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
          user: {
            id: userId,
            displayName: "Synthetic E2E Owner",
            avatarUrl: null,
            locale: "zh-Hans",
            status: "ACTIVE",
            verificationBadges: [],
          },
          expiresAt: "2099-07-30T01:00:00.000Z",
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
  expect(response?.headers()["cache-control"]).toContain("no-store");
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
  expect(Object.keys(contract.paths)).toHaveLength(69);
  expect(Object.keys(contract.components.schemas)).toHaveLength(177);

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
