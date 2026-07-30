import {
  homepageResponseSchema,
  type HomepageResponse,
  type ValidatedHomepageQuery,
} from "@socal/contracts";
import { MetricsRegistry } from "@socal/observability";
import { describe, expect, it, vi } from "vitest";
import {
  homepageCompositeTtlSeconds,
  InvalidHomepageCacheEntryError,
  RedisHomepageCache,
  type HomepageCache,
} from "../src/modules/homepage/homepage-cache";
import type { HomepageDataSource } from "../src/modules/homepage/homepage-data.source";
import { HomepageService } from "../src/modules/homepage/homepage.service";
import type { HomepageLayoutService } from "../src/modules/homepage-layout/homepage-layout.service";

const query: ValidatedHomepageQuery = {
  locale: "en-US",
  regionCode: "US-CA-SOCAL",
  device: "mobile",
};

function response(overrides: Partial<HomepageResponse> = {}): HomepageResponse {
  return homepageResponseSchema.parse({
    layout: {
      version: 3,
      locale: query.locale,
      regionCode: query.regionCode,
      device: query.device,
    },
    modules: [
      {
        key: "hero",
        kind: "HERO",
        dataVersion: "a".repeat(64),
        cache: {
          ttlSeconds: 120,
          tags: ["homepage.config.en-US.US-CA-SOCAL.v3"],
        },
        data: {
          contentKey: "homepage.hero",
          title: "Southern California life",
          subtitle: "Real local information",
          searchPlaceholder: "Search local listings",
        },
      },
    ],
    partial: false,
    generatedAt: "2026-07-29T12:00:00.000Z",
    ...overrides,
  });
}

describe("homepage shared cache", () => {
  it("strictly validates the cached projection and uses the bounded composite TTL", async () => {
    const values = new Map<string, string>();
    const setExpiring = vi.fn((key: string, value: string) => {
      values.set(key, value);
      return Promise.resolve();
    });
    const cache = new RedisHomepageCache({
      get: (key) => Promise.resolve(values.get(key) ?? null),
      setExpiring,
      delete: (key) => {
        values.delete(key);
        return Promise.resolve();
      },
    });

    await cache.write(query, response(), 120);
    await expect(cache.read(query)).resolves.toEqual(response());
    expect(setExpiring).toHaveBeenCalledWith(
      "socal:homepage:v1:en-US:US-CA-SOCAL:mobile",
      expect.any(String),
      120,
    );
    expect(homepageCompositeTtlSeconds(response())).toBe(120);
    expect(homepageCompositeTtlSeconds(response({ partial: true }))).toBe(0);
  });

  it("deletes and rejects poisoned, mismatched, or oversized cache values", async () => {
    let value = JSON.stringify({
      ...response(),
      layout: { ...response().layout, regionCode: "US-CA-OTHER" },
    });
    const deleteEntry = vi.fn(() => {
      value = "";
      return Promise.resolve();
    });
    const cache = new RedisHomepageCache({
      get: () => Promise.resolve(value),
      setExpiring: () => Promise.resolve(),
      delete: deleteEntry,
    });
    await expect(cache.read(query)).rejects.toBeInstanceOf(InvalidHomepageCacheEntryError);
    expect(deleteEntry).toHaveBeenCalledOnce();
  });

  it("coalesces one in-flight canonical composition and stores only complete responses", async () => {
    let releaseLayout: (() => void) | undefined;
    const waitForLayout = new Promise<void>((resolve) => {
      releaseLayout = resolve;
    });
    const getPublished = vi.fn(async () => {
      await waitForLayout;
      return {
        definition: {
          version: 3,
          locale: query.locale,
          regionCode: query.regionCode,
          slots: [
            {
              key: "hero",
              kind: "HERO",
              enabled: true,
              source: { contentKey: "homepage.hero" },
              limit: 1,
              sponsoredDisclosure: false,
              cacheTtlSeconds: 120,
            },
          ],
        },
        revision: 1,
        contentHash: "a".repeat(64),
      };
    });
    const readCache = vi.fn(() => Promise.resolve(null));
    const writeCache = vi.fn(() => Promise.resolve());
    const cache: HomepageCache = {
      read: readCache,
      write: writeCache,
    };
    const dataSource: HomepageDataSource = {
      listTrending: () => Promise.resolve([]),
      listCities: () => Promise.resolve([]),
      listListings: () => Promise.resolve([]),
    };
    const metrics = new MetricsRegistry();
    const service = new HomepageService(
      { getPublished } as unknown as HomepageLayoutService,
      dataSource,
      metrics,
      cache,
    );

    const first = service.get(query, new Date("2026-07-29T12:00:00.000Z"));
    const second = service.get(query, new Date("2026-07-29T12:00:01.000Z"));
    await vi.waitFor(() => expect(readCache).toHaveBeenCalledTimes(2));
    releaseLayout?.();
    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(firstResult).toBe(secondResult);
    expect(getPublished).toHaveBeenCalledOnce();
    expect(writeCache).toHaveBeenCalledOnce();
    expect(metrics.renderPrometheus()).toContain(
      'socal_homepage_cache_operations_total{outcome="coalesced"} 1',
    );
    expect(metrics.renderPrometheus()).toContain(
      'socal_homepage_cache_operations_total{outcome="stored"} 1',
    );
  });

  it("fails open to canonical composition when Redis read and write operations fail", async () => {
    const cache: HomepageCache = {
      read: () => Promise.reject(new Error("redis private detail")),
      write: () => Promise.reject(new Error("redis private detail")),
    };
    const metrics = new MetricsRegistry();
    const service = new HomepageService(
      {
        getPublished: () =>
          Promise.resolve({
            definition: {
              version: 3,
              locale: query.locale,
              regionCode: query.regionCode,
              slots: [
                {
                  key: "hero",
                  kind: "HERO",
                  enabled: true,
                  source: { contentKey: "homepage.hero" },
                  limit: 1,
                  sponsoredDisclosure: false,
                  cacheTtlSeconds: 120,
                },
              ],
            },
            revision: 1,
            contentHash: "a".repeat(64),
          }),
      } as unknown as HomepageLayoutService,
      {
        listTrending: () => Promise.resolve([]),
        listCities: () => Promise.resolve([]),
        listListings: () => Promise.resolve([]),
      },
      metrics,
      cache,
    );

    await expect(service.get(query)).resolves.toMatchObject({ partial: false });
    const rendered = metrics.renderPrometheus();
    expect(rendered).toContain('socal_homepage_cache_operations_total{outcome="failed"} 2');
    expect(rendered).not.toContain("redis private detail");
  });
});
