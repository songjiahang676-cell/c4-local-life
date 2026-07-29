import { parseApiEnvironment } from "@socal/config";
import { MetricsRegistry } from "@socal/observability";
import { describe, expect, it } from "vitest";
import { SearchService } from "../src/modules/search/search.service";
import {
  SearchCursorExpiredError,
  SearchCursorInvalidError,
} from "../src/modules/search/search-cursor";
import { type SearchStoreHit, SearchTimeoutError } from "../src/modules/search/search.store";
import {
  MemorySearchStore,
  searchStoreResult,
  syntheticSearchResult,
} from "./support/memory-search.store";

const environment = parseApiEnvironment({
  NODE_ENV: "test",
  APP_ENV: "test",
  PUBLIC_WEB_URL: "http://web.example.invalid",
  PUBLIC_ADMIN_URL: "http://admin.example.invalid",
  DATABASE_URL: "postgresql://example.invalid/socal",
  REDIS_URL: "redis://localhost:6379/0",
  OPENSEARCH_NODE: "http://localhost:9200",
  SESSION_SECRET: "search-service-session-secret-with-32-bytes",
  OTP_SECRET: "search-service-otp-secret-with-more-than-32-bytes",
  MFA_SECRET: "search-service-mfa-secret-with-more-than-32-bytes",
  PASSWORD_PEPPER: "search-service-password-pepper-more-than-32-bytes",
  CSRF_SECRET: "search-service-csrf-secret-with-more-than-32-bytes",
});

function hit(sequence: number): SearchStoreHit {
  return {
    result: syntheticSearchResult({
      id: `81000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`,
      title: `Synthetic result ${sequence}`,
    }),
    sort: [
      100 - sequence,
      `2026-07-${String(30 - sequence).padStart(2, "0")}T12:00:00.000Z`,
      sequence,
    ],
  } as const;
}

describe("SearchService", () => {
  it("uses one PIT and stable search_after values across cursor pages", async () => {
    const store = new MemorySearchStore();
    const metrics = new MetricsRegistry();
    store.results.push(
      searchStoreResult([hit(1), hit(2), hit(3)], {
        facets: {
          types: [{ value: "RENTAL", count: 3 }],
          categories: [],
          regions: [],
          priceUnits: [],
        },
      }),
      searchStoreResult([hit(3)]),
    );
    const service = new SearchService(environment, store, metrics);
    const now = new Date("2026-07-29T12:00:00.000Z");

    const first = await service.search({ q: "Irvine 公寓", sort: "RELEVANCE", limit: 2 }, now);
    expect(first.data.map((item) => item.title)).toEqual([
      "Synthetic result 1",
      "Synthetic result 2",
    ]);
    expect(first.page).toMatchObject({ hasMore: true });
    expect(first.page.nextCursor).not.toContain("Irvine");
    expect(store.opened).toEqual([120]);
    expect(store.closed).toEqual([]);

    const second = await service.search(
      {
        q: "Irvine 公寓",
        sort: "RELEVANCE",
        limit: 2,
        cursor: first.page.nextCursor ?? undefined,
      },
      new Date("2026-07-29T12:00:30.000Z"),
    );
    expect(second.page).toEqual({ nextCursor: null, hasMore: false });
    expect(store.opened).toHaveLength(1);
    expect(store.searched[1]).toMatchObject({
      snapshotId: "memory-pit-1",
      snapshotAt: now.toISOString(),
      searchAfter: hit(2).sort,
    });
    expect(store.closed).toEqual(["memory-pit-1"]);
    expect(metrics.renderPrometheus()).toContain(
      'socal_search_queries_total{outcome="success",sort="RELEVANCE",geo="false"} 2',
    );
  });

  it("rejects tampering, filter replay, and expired cursors before querying the backend", async () => {
    const store = new MemorySearchStore();
    store.results.push(searchStoreResult([hit(1), hit(2)]));
    const service = new SearchService(environment, store);
    const now = new Date("2026-07-29T12:00:00.000Z");
    const first = await service.search({ q: "rental", limit: 1 }, now);
    const cursor = first.page.nextCursor ?? "";

    await expect(
      service.search({ q: "different", limit: 1, cursor }, new Date(now.getTime() + 1_000)),
    ).rejects.toBeInstanceOf(SearchCursorInvalidError);
    await expect(
      service.search(
        { q: "rental", limit: 1, cursor: `${cursor.slice(0, -1)}x` },
        new Date(now.getTime() + 1_000),
      ),
    ).rejects.toBeInstanceOf(SearchCursorInvalidError);
    await expect(
      service.search({ q: "rental", limit: 1, cursor }, new Date(now.getTime() + 121_000)),
    ).rejects.toBeInstanceOf(SearchCursorExpiredError);
    expect(store.searched).toHaveLength(1);
  });

  it("closes the PIT and records a bounded timeout outcome when OpenSearch times out", async () => {
    const store = new MemorySearchStore();
    const metrics = new MetricsRegistry();
    store.errors.push(new SearchTimeoutError());
    const service = new SearchService(environment, store, metrics);

    await expect(service.search({ sort: "NEWEST", limit: 20 })).rejects.toBeInstanceOf(
      SearchTimeoutError,
    );
    expect(store.closed).toEqual(["memory-pit-1"]);
    expect(metrics.renderPrometheus()).toContain(
      'socal_search_queries_total{outcome="timeout",sort="NEWEST",geo="false"} 1',
    );
  });
});
