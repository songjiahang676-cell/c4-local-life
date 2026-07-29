import type { HomepageLayoutDefinition, PublicListingSummaryView } from "@socal/contracts";
import { MetricsRegistry } from "@socal/observability";
import { describe, expect, it, vi } from "vitest";
import type { HomepageDataSource } from "../src/modules/homepage/homepage-data.source";
import { HomepageService } from "../src/modules/homepage/homepage.service";
import type { HomepageLayoutService } from "../src/modules/homepage-layout/homepage-layout.service";

const now = new Date("2026-07-29T12:00:00.000Z");
const listing: PublicListingSummaryView = {
  id: "81000000-0000-4000-8000-000000000001",
  type: "JOB",
  status: "PUBLISHED",
  locale: "zh-Hans",
  title: "测试公开招聘",
  slug: "synthetic-public-job",
  summary: "仅用于模块测试的虚构公开信息。",
  price: { amount: "24.00", currency: "USD", unit: "HOURLY" },
  region: {
    id: "82000000-0000-4000-8000-000000000001",
    type: "CITY",
    code: "US-CA-IRVINE",
    slug: "irvine",
    nameZhHans: "尔湾",
    nameEn: "Irvine",
    timezone: "America/Los_Angeles",
  },
  category: {
    id: "83000000-0000-4000-8000-000000000001",
    vertical: "JOB",
    slug: "jobs",
    nameZhHans: "招聘",
    nameEn: "Jobs",
  },
  owner: {
    id: "84000000-0000-4000-8000-000000000001",
    displayName: "测试发布者",
    avatarUrl: null,
  },
  organization: null,
  location: { precision: "CITY" },
  attributes: {},
  featured: false,
  featuredUntil: null,
  publishedAt: "2026-07-28T12:00:00.000Z",
  expiresAt: "2026-08-28T12:00:00.000Z",
  updatedAt: "2026-07-28T12:00:00.000Z",
  version: 2,
};

const definition: HomepageLayoutDefinition = {
  version: 2,
  locale: "zh-Hans",
  regionCode: "US-CA-SOCAL",
  slots: [
    {
      key: "hero",
      kind: "HERO",
      enabled: true,
      source: { contentKey: "homepage.hero" },
      limit: 1,
      sponsoredDisclosure: false,
      cacheTtlSeconds: 300,
    },
    {
      key: "trends",
      kind: "HOT_SEARCHES",
      enabled: true,
      source: { window: "DAY_7", regionScoped: true },
      limit: 5,
      sponsoredDisclosure: false,
      cacheTtlSeconds: 120,
    },
    {
      key: "cities",
      kind: "CITY_CHIPS",
      enabled: true,
      source: { regionType: "CITY" },
      limit: 8,
      sponsoredDisclosure: false,
      cacheTtlSeconds: 3600,
    },
    {
      key: "jobs",
      kind: "LISTING_FEED",
      enabled: true,
      source: { listingType: "JOB", sort: "NEWEST" },
      limit: 5,
      sponsoredDisclosure: false,
      cacheTtlSeconds: 60,
    },
    {
      key: "ad",
      kind: "AD",
      enabled: true,
      source: { placementKey: "home.right" },
      limit: 1,
      sponsoredDisclosure: true,
      cacheTtlSeconds: 30,
    },
  ],
};

function layoutService(): HomepageLayoutService {
  return {
    getPublished: () =>
      Promise.resolve({
        definition,
        revision: 1,
        contentHash: "f".repeat(64),
      }),
  } as unknown as HomepageLayoutService;
}

function source(overrides: Partial<HomepageDataSource> = {}): HomepageDataSource {
  return {
    listTrending: () => Promise.resolve([{ query: "尔湾招聘", rank: 1, locale: "zh-Hans" }]),
    listCities: () =>
      Promise.resolve([
        {
          id: "82000000-0000-4000-8000-000000000001",
          code: "US-CA-IRVINE",
          slug: "irvine",
          type: "CITY",
          name: "尔湾",
        },
      ]),
    listListings: () => Promise.resolve([listing]),
    ...overrides,
  };
}

describe("homepage composition service", () => {
  it("preserves published layout order and emits only implemented real-data modules", async () => {
    const listListings = vi.fn(() => Promise.resolve([listing]));
    const dataSource = source({ listListings });
    const metrics = new MetricsRegistry();
    const service = new HomepageService(layoutService(), dataSource, metrics);
    const result = await service.get(
      {
        locale: "zh-Hans",
        regionCode: "US-CA-SOCAL",
        device: "desktop",
      },
      now,
    );

    expect(result.modules.map((module) => module.kind)).toEqual([
      "HERO",
      "HOT_SEARCHES",
      "CITY_CHIPS",
      "LISTING_FEED",
    ]);
    expect(result.modules.map((module) => module.key)).not.toContain("ad");
    expect(listListings).toHaveBeenCalledWith(
      expect.objectContaining({ listingType: "JOB", regionCode: "US-CA-SOCAL" }),
    );
    expect(result.partial).toBe(false);
    expect(result.modules.every((module) => /^[0-9a-f]{64}$/.test(module.dataVersion))).toBe(true);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("sourceCount");
    expect(serialized).not.toContain("phone");
    expect(metrics.renderPrometheus()).toContain(
      'socal_homepage_modules_total{kind="LISTING_FEED",outcome="success"} 1',
    );
  });

  it("isolates a failed module while serving independent modules and bounded telemetry", async () => {
    const metrics = new MetricsRegistry();
    const listListings = vi.fn(() => Promise.reject(new Error("private database detail")));
    const service = new HomepageService(layoutService(), source({ listListings }), metrics);
    const result = await service.get(
      {
        locale: "zh-Hans",
        regionCode: "US-CA-SOCAL",
        device: "mobile",
      },
      now,
    );

    expect(result.partial).toBe(true);
    expect(result.modules.map((module) => module.kind)).toEqual([
      "HERO",
      "HOT_SEARCHES",
      "CITY_CHIPS",
    ]);
    expect(metrics.renderPrometheus()).toContain(
      'socal_homepage_modules_total{kind="LISTING_FEED",outcome="unavailable"} 1',
    );
    expect(metrics.renderPrometheus()).not.toContain("private database detail");
  });

  it("honestly omits empty modules without marking the available response partial", async () => {
    const service = new HomepageService(
      layoutService(),
      source({
        listTrending: () => Promise.resolve([]),
        listCities: () => Promise.resolve([]),
        listListings: () => Promise.resolve([]),
      }),
    );
    const result = await service.get(
      {
        locale: "zh-Hans",
        regionCode: "US-CA-SOCAL",
        device: "tablet",
      },
      now,
    );
    expect(result.modules.map((module) => module.kind)).toEqual(["HERO"]);
    expect(result.partial).toBe(false);
  });
});
