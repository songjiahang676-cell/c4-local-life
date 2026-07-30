import { describe, expect, it } from "vitest";
import {
  homepageCacheEntryKey,
  homepageCacheLayoutVersionKey,
  homepageQuerySchema,
  homepageResponseSchema,
  webVitalReportSchema,
} from "../src";

const hash = "a".repeat(64);

describe("homepage public contracts", () => {
  it("applies bounded anonymous defaults and rejects unknown query fields", () => {
    expect(homepageQuerySchema.parse({})).toEqual({
      locale: "zh-Hans",
      regionCode: "US-CA-SOCAL",
      device: "desktop",
    });
    expect(() => homepageQuerySchema.parse({ locale: "fr", preview: true })).toThrow();
    expect(() => homepageQuerySchema.parse({ regionCode: "bad region" })).toThrow();
  });

  it("uses one encoded cross-process cache identity for every public dimension", () => {
    expect(
      homepageCacheEntryKey({
        locale: "en-US",
        regionCode: "US-CA:SOCAL",
        device: "mobile",
      }),
    ).toBe("socal:homepage:v1:en-US:US-CA%3ASOCAL:mobile");
    expect(
      homepageCacheLayoutVersionKey({
        locale: "en-US",
        regionCode: "US-CA:SOCAL",
      }),
    ).toBe("socal:homepage:v1:en-US:US-CA%3ASOCAL:layout-version");
  });

  it("accepts only bounded Core Web Vitals without identifiers or free-form fields", () => {
    expect(
      webVitalReportSchema.parse({
        name: "LCP",
        value: 2_450,
        route: "homepage",
      }),
    ).toEqual({ name: "LCP", value: 2_450, route: "homepage" });
    expect(() =>
      webVitalReportSchema.parse({
        name: "CLS",
        value: 11,
        route: "homepage",
      }),
    ).toThrow();
    expect(() =>
      webVitalReportSchema.parse({
        name: "LCP",
        value: 2_450,
        route: "homepage",
        url: "/zh-Hans?query=private",
      }),
    ).toThrow();
  });

  it("accepts strict real-data modules without provider counts or private fields", () => {
    const response = homepageResponseSchema.parse({
      layout: {
        version: 3,
        locale: "en-US",
        regionCode: "US-CA-SOCAL",
        device: "mobile",
      },
      modules: [
        {
          key: "hero",
          kind: "HERO",
          dataVersion: hash,
          cache: {
            ttlSeconds: 300,
            tags: ["homepage.config.en-US.US-CA-SOCAL.v3"],
          },
          data: {
            contentKey: "homepage.hero",
            title: "Southern California life",
            subtitle: "Real local information",
            searchPlaceholder: "Search local listings",
          },
        },
        {
          key: "hot-searches",
          kind: "HOT_SEARCHES",
          dataVersion: hash,
          cache: { ttlSeconds: 120, tags: ["homepage.search-trends"] },
          data: {
            window: "DAY_7",
            items: [{ query: "Irvine rentals", rank: 1, locale: "en-US" }],
          },
        },
      ],
      partial: false,
      generatedAt: "2026-07-29T12:00:00.000Z",
    });
    expect(response.modules).toHaveLength(2);
    expect(JSON.stringify(response)).not.toContain("sourceCount");
    expect(JSON.stringify(response)).not.toContain("phone");
  });

  it("rejects empty data modules, duplicate cache tags, and unimplemented response kinds", () => {
    const base = {
      key: "hot-searches",
      dataVersion: hash,
      cache: { ttlSeconds: 120, tags: ["homepage.search-trends"] },
    };
    expect(() =>
      homepageResponseSchema.parse({
        layout: {
          version: 1,
          locale: "zh-Hans",
          regionCode: "US-CA-SOCAL",
          device: "desktop",
        },
        modules: [
          {
            ...base,
            kind: "HOT_SEARCHES",
            data: { window: "DAY_1", items: [] },
          },
        ],
        partial: false,
        generatedAt: "2026-07-29T12:00:00.000Z",
      }),
    ).toThrow();
    expect(() =>
      homepageResponseSchema.parse({
        layout: {
          version: 1,
          locale: "zh-Hans",
          regionCode: "US-CA-SOCAL",
          device: "desktop",
        },
        modules: [
          {
            ...base,
            kind: "AD",
            cache: { ttlSeconds: 30, tags: ["ad", "ad"] },
            data: { copy: "invented" },
          },
        ],
        partial: false,
        generatedAt: "2026-07-29T12:00:00.000Z",
      }),
    ).toThrow();
  });
});
