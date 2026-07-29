import { describe, expect, it } from "vitest";
import {
  buildOpenSearchRequest,
  parseOpenSearchResponse,
  parseSearchListingResult,
} from "../src/modules/search/opensearch-search.store";
import {
  SearchProjectionError,
  SearchTimeoutError,
  type SearchStoreInput,
  SearchUnavailableError,
} from "../src/modules/search/search.store";

const snapshotAt = "2026-07-29T12:00:00.000Z";

function indexedSource(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    id: "81000000-0000-4000-8000-000000000001",
    type: "RENTAL",
    status: "PUBLISHED",
    locale: "en-US",
    slug: "synthetic-irvine-rental",
    title: "Synthetic Irvine rental",
    summary: "A fictional public result.",
    body: "Private-to-response searchable body that must never be returned.",
    category: {
      id: "83000000-0000-4000-8000-000000000001",
      slug: "rentals",
      path: ["housing", "rentals"],
      nameZhHans: "测试租房",
      nameEn: "Rentals",
      aliases: ["apartment"],
    },
    region: {
      id: "82000000-0000-4000-8000-000000000001",
      code: "US-CA-ORANGE-IRVINE",
      slug: "irvine",
      path: ["southern-california", "irvine"],
      nameZhHans: "测试尔湾",
      nameEn: "Irvine",
      aliases: ["尔湾"],
    },
    price: { amountMinor: 250_000, currency: "USD", unit: "MONTHLY" },
    location: {
      precision: "APPROXIMATE",
      point: { lat: 33.6846, lon: -117.8265 },
    },
    attributes: [
      { key: "bedrooms", numberValue: 2 },
      { key: "furnished", booleanValue: true },
      { key: "lease", textValue: "annual", keywordValue: "annual" },
    ],
    publisher: {
      ownerId: "84000000-0000-4000-8000-000000000001",
      displayName: "Synthetic Publisher",
      avatarUrl: null,
      organizationId: null,
      organizationSlug: null,
    },
    qualityScore: 0.9,
    isSponsored: false,
    promotion: { campaignId: "private-campaign", placementId: "private-placement" },
    publishedAt: "2026-07-28T12:00:00.000Z",
    expiresAt: "2026-08-28T12:00:00.000Z",
    updatedAt: "2026-07-28T12:00:00.000Z",
    contentVersion: 3,
    indexedAt: "2026-07-28T12:00:01.000Z",
  };
}

function input(overrides: Partial<SearchStoreInput> = {}): SearchStoreInput {
  return {
    snapshotId: "test-pit",
    snapshotAt,
    criteria: {
      q: "Irvine 公寓",
      type: "RENTAL",
      categoryId: "83000000-0000-4000-8000-000000000001",
      regionCode: "US-CA-ORANGE-IRVINE",
      latitude: 33.6846,
      longitude: -117.8265,
      radiusMiles: 25,
      minPrice: "1000",
      maxPrice: "3000.50",
      sort: "DISTANCE",
      limit: 20,
    },
    keepAliveSeconds: 120,
    timeoutMilliseconds: 1_500,
    ...overrides,
  };
}

describe("OpenSearch public search adapter", () => {
  it("builds a fixed, bounded query with public source fields and stable geo sorting", () => {
    const request = buildOpenSearchRequest(input());
    const serialized = JSON.stringify(request);
    const body = request.body as Record<string, unknown>;

    expect(request.allow_partial_search_results).toBe(false);
    expect(body).toMatchObject({
      size: 21,
      timeout: "1500ms",
      track_total_hits: false,
      pit: { id: "test-pit", keep_alive: "120s" },
    });
    expect(serialized).toContain('"status":"PUBLISHED"');
    expect(serialized).toContain('"expiresAt":{"gt":"2026-07-29T12:00:00.000Z"}');
    expect(serialized).toContain('"distance":"25mi"');
    expect(serialized).toContain('"_geo_distance"');
    expect(serialized).toContain('"price.amountMinor":{"gte":100000,"lte":300050}');
    expect(body._source).not.toContain("body");
    expect(body._source).not.toContain("qualityScore");
    expect(body._source).not.toContain("promotion");
    expect(serialized).not.toContain('"script"');
  });

  it("maps only contract-safe fields and converts minor units and geo points", () => {
    const result = parseSearchListingResult(indexedSource(), 3.25);
    expect(result).toMatchObject({
      id: indexedSource().id,
      price: { amount: "2500", currency: "USD", unit: "MONTHLY" },
      location: {
        precision: "APPROXIMATE",
        point: { latitude: 33.6846, longitude: -117.8265 },
      },
      attributes: { bedrooms: 2, furnished: true, lease: "annual" },
      distanceMiles: 3.25,
      version: 3,
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("Private-to-response");
    expect(serialized).not.toContain("private-campaign");
    expect(serialized).not.toContain("qualityScore");
    expect(serialized).not.toContain("indexedAt");
  });

  it("parses bounded hits and fixed facets while failing closed on drift or partial results", () => {
    const response = {
      took: 12,
      timed_out: false,
      _shards: { total: 1, successful: 1, failed: 0 },
      hits: {
        hits: [
          {
            _source: indexedSource(),
            sort: [3.25, 1_785_254_400_000, "81000000-0000-4000-8000-000000000001"],
          },
        ],
      },
      aggregations: {
        types: { buckets: [{ key: "RENTAL", doc_count: 1 }] },
        categories: {
          buckets: [{ key: "83000000-0000-4000-8000-000000000001", doc_count: 1 }],
        },
        regions: { buckets: [{ key: "US-CA-ORANGE-IRVINE", doc_count: 1 }] },
        priceUnits: { buckets: [{ key: "MONTHLY", doc_count: 1 }] },
      },
    };
    expect(parseOpenSearchResponse(response, true)).toMatchObject({
      tookMilliseconds: 12,
      facets: { types: [{ value: "RENTAL", count: 1 }] },
      hits: [{ result: { distanceMiles: 3.25 } }],
    });
    expect(() => parseOpenSearchResponse({ ...response, timed_out: true }, false)).toThrow(
      SearchTimeoutError,
    );
    expect(() =>
      parseOpenSearchResponse(
        { ...response, _shards: { total: 2, successful: 1, failed: 1 } },
        false,
      ),
    ).toThrow(SearchUnavailableError);
    expect(() =>
      parseSearchListingResult({ ...indexedSource(), phone: "+1-555-0100", status: "DRAFT" }, null),
    ).toThrow(SearchProjectionError);
  });
});
