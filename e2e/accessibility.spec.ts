import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const adminBaseUrl = "http://127.0.0.1:3101";
const listingId = "91000000-0000-4000-8000-000000000001";
const wcagTags = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] as const;

interface AxeViolationSummary {
  readonly id: string;
  readonly impact: string | null;
  readonly nodes: readonly string[];
}

async function expectNoWcagViolations(page: Page, scope: string): Promise<void> {
  const result = await new AxeBuilder({ page }).withTags([...wcagTags]).analyze();
  const summaries: readonly AxeViolationSummary[] = result.violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact ?? null,
    nodes: violation.nodes.map((node) => node.target.join(" ")),
  }));

  expect(
    summaries,
    `${scope} WCAG 2.2 AA violations:\n${JSON.stringify(summaries, null, 2)}`,
  ).toEqual([]);
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
}

async function installAuthenticatedRentalFixture(page: Page): Promise<void> {
  await page.route("**/v1/auth/session", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          user: {
            id: "10000000-0000-4000-8000-000000000099",
            displayName: "Synthetic accessibility owner",
            avatarUrl: null,
          },
          expiresAt: "2099-01-01T00:00:00.000Z",
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
            id: "20000000-0000-4000-8000-000000000099",
            parentId: null,
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
            id: "40000000-0000-4000-8000-000000000099",
            parentId: null,
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
}

test("keeps public discovery templates axe-clean at WCAG 2.2 AA", async ({ page }) => {
  const routes = [
    "/zh-Hans",
    "/en-US/rentals?q=synthetic",
    `/en-US/rentals/synthetic-city/synthetic-public-listing-${listingId}`,
  ] as const;

  for (const route of routes) {
    const response = await page.goto(route);
    expect(response?.ok()).toBe(true);
    await expectNoWcagViolations(page, route);
    await expectNoHorizontalOverflow(page);
  }
});

test("supports skip navigation, visible keyboard focus, and narrow reflow", async ({ page }) => {
  const response = await page.goto("/en-US/rentals");
  expect(response?.ok()).toBe(true);

  await page.keyboard.press("Tab");
  const skipLink = page.getByRole("link", { name: "Skip to main content" });
  await expect(skipLink).toBeFocused();
  await expect(skipLink).toBeVisible();
  await expect(skipLink).toHaveCSS("outline-style", "solid");

  await page.keyboard.press("Enter");
  await expect(page.locator("#main-content")).toBeFocused();

  await page.setViewportSize({ width: 320, height: 720 });
  await expectNoHorizontalOverflow(page);
  await expectNoWcagViolations(page, "public listing at 320 CSS pixels");

  await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
  await page.reload();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to main content" })).toBeFocused();
  await expectNoWcagViolations(page, "forced colors and reduced motion");
});

test("associates form errors and moves focus without color-only status", async ({ page }) => {
  await installAuthenticatedRentalFixture(page);
  const response = await page.goto("/en-US/post/rental/new");
  expect(response?.ok()).toBe(true);
  await expect(page.getByRole("heading", { level: 1, name: "Post a rental" })).toBeVisible();
  await expectNoWcagViolations(page, "rental form initial state");

  await page.getByRole("button", { name: "Save now" }).click();
  const errorSummary = page.locator(".draftErrorSummary");
  await expect(errorSummary).toContainText("Fix these items before saving");

  const firstInvalid = page.locator("[aria-invalid='true']").first();
  await expect(firstInvalid).toBeFocused();
  const errorId = await firstInvalid.getAttribute("aria-describedby");
  expect(errorId).toBeTruthy();
  await expect(page.locator(`#${errorId ?? "missing-error"}`)).toBeVisible();
  await expectNoWcagViolations(page, "rental form validation state");

  await page.setViewportSize({ width: 320, height: 720 });
  await expectNoHorizontalOverflow(page);
});

test("keeps private-account and Admin boundaries axe-clean", async ({ page }) => {
  await page.route("**/v1/auth/session", async (route) => {
    await route.fulfill({
      status: 401,
      contentType: "application/problem+json",
      body: JSON.stringify({
        type: "https://errors.socal-life.example/authentication-required",
        title: "Authentication required",
        status: 401,
        detail: "Sign in to continue.",
        instance: "/v1/auth/session",
      }),
    });
  });

  const accountResponse = await page.goto("/en-US/account");
  expect(accountResponse?.ok()).toBe(true);
  await expectNoWcagViolations(page, "private account boundary");

  const adminResponse = await page.goto(`${adminBaseUrl}/admin`);
  expect(adminResponse?.ok()).toBe(true);
  await expectNoWcagViolations(page, "Admin authentication boundary");
  await expectNoHorizontalOverflow(page);
});
