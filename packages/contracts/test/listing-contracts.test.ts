import { describe, expect, it } from "vitest";
import {
  batchListingActionSchema,
  contentStatusSchema,
  createListingSchema,
  listMyListingsQuerySchema,
  listListingsQuerySchema,
  listingCollectionSchema,
  listingSearchSchema,
  moneySchema,
  publicListingResponseSchema,
  searchResponseSchema,
  updateListingSchema,
} from "../src";

describe("listing contracts", () => {
  it("applies public creation defaults", () => {
    const parsed = createListingSchema.parse({
      type: "RENTAL",
      categoryId: "11111111-1111-4111-8111-111111111111",
      regionCode: "US-CA-ORANGE-IRVINE",
      title: "Fictional Irvine rental",
      body: "A fictional listing body long enough for contract validation.",
    });

    expect(parsed).toMatchObject({
      locale: "zh-Hans",
      attributes: {},
      mediaIds: [],
      contactMode: "IN_APP",
    });
  });

  it("enforces fixed versus non-fixed price semantics and decimal precision", () => {
    expect(moneySchema.safeParse({ amount: "12.345", currency: "USD" }).success).toBe(false);
    expect(moneySchema.parse({ amount: "12.34", currency: "USD", unit: "FIXED" })).toMatchObject({
      amount: "12.34",
      unit: "FIXED",
    });
    expect(moneySchema.parse({ amount: null, currency: "USD", unit: "FREE" })).toMatchObject({
      amount: null,
      unit: "FREE",
    });
    expect(moneySchema.safeParse({ amount: "0", currency: "USD", unit: "MONTHLY" }).success).toBe(
      false,
    );
    expect(moneySchema.safeParse({ amount: "1", currency: "USD", unit: "FREE" }).success).toBe(
      false,
    );
  });

  it("keeps draft patches strict, non-empty, and free of unsafe text controls", () => {
    expect(updateListingSchema.parse({ summary: null })).toEqual({ summary: null });
    expect(updateListingSchema.safeParse({}).success).toBe(false);
    expect(updateListingSchema.safeParse({ unknown: true }).success).toBe(false);
    expect(updateListingSchema.safeParse({ title: "Unsafe\u202etitle" }).success).toBe(false);
    expect(
      createListingSchema.safeParse({
        type: "RENTAL",
        categoryId: "11111111-1111-4111-8111-111111111111",
        regionCode: "US-CA-LA",
        title: "Safe synthetic title",
        body: "A body with an unsupported\u0000control character.",
      }).success,
    ).toBe(false);
  });

  it("keeps OpenAPI-derived defaults and nested location validation in one runtime schema", () => {
    const parsed = createListingSchema.parse({
      type: "SERVICE",
      categoryId: "11111111-1111-4111-8111-111111111111",
      regionCode: "US-CA-LA",
      title: "Fictional bilingual service",
      body: "A fictional listing body long enough for contract validation.",
      location: {
        point: { latitude: 34.05, longitude: -118.24 },
      },
    });

    expect(parsed).toMatchObject({
      locale: "zh-Hans",
      location: { precision: "CITY" },
      contactMode: "IN_APP",
      attributes: {},
      mediaIds: [],
    });
    expect(
      createListingSchema.safeParse({
        ...parsed,
        location: { point: { latitude: 91, longitude: -118.24 } },
      }).success,
    ).toBe(false);
  });

  it("normalizes bounded search text and coerces documented geo numbers", () => {
    expect(contentStatusSchema.parse("DELETED")).toBe("DELETED");
    expect(
      listingSearchSchema.parse({
        q: "  Ｉｒｖｉｎｅ 公寓  ",
        latitude: "34.05",
        longitude: "-118.24",
        radiusMiles: "25",
      }),
    ).toMatchObject({
      q: "Irvine 公寓",
      latitude: 34.05,
      longitude: -118.24,
      radiusMiles: 25,
      sort: "RELEVANCE",
      limit: 20,
    });
  });

  it("rejects unbounded, ambiguous, or unsafe public search inputs", () => {
    for (const invalidQuery of [
      { q: "   " },
      { q: "safe\u202eunsafe" },
      { q: "safe\u0000unsafe" },
      { latitude: "34.05" },
      { longitude: "-118.24" },
      { radiusMiles: "25" },
      { sort: "DISTANCE" },
      { minPrice: "10.001" },
      { minPrice: "10.01", maxPrice: "10.00" },
      { limit: "51" },
      { cursor: "a".repeat(2049) },
      { offset: "0" },
    ]) {
      expect(listingSearchSchema.safeParse(invalidQuery).success).toBe(false);
    }

    expect(
      listingSearchSchema.parse({
        latitude: "34.05",
        longitude: "-118.24",
        sort: "DISTANCE",
        minPrice: "999999999999.91",
        maxPrice: "999999999999.92",
      }),
    ).toMatchObject({
      sort: "DISTANCE",
      minPrice: "999999999999.91",
      maxPrice: "999999999999.92",
    });
  });

  it("accepts every implemented public Listing vertical and rejects unknown values", () => {
    expect(listListingsQuerySchema.parse({})).toMatchObject({ type: "RENTAL", limit: 20 });
    for (const type of ["RENTAL", "JOB", "TRANSFER", "SECONDHAND", "SERVICE"] as const) {
      expect(listListingsQuerySchema.parse({ type })).toMatchObject({ type, limit: 20 });
    }
    expect(listListingsQuerySchema.safeParse({ type: "BUSINESS" }).success).toBe(false);
  });

  it("validates strict anonymous list, detail, and search projections", () => {
    const common = {
      id: "11111111-1111-4111-8111-111111111111",
      type: "RENTAL",
      status: "PUBLISHED",
      locale: "en-US",
      title: "Synthetic public rental",
      slug: "synthetic-public-rental",
      summary: "Contract-safe fictional public content.",
      price: { amount: "2450.00", currency: "USD", unit: "MONTHLY" },
      region: {
        id: "22222222-2222-4222-8222-222222222222",
        type: "CITY",
        code: "US-CA-SYNTHETIC",
        slug: "synthetic-city",
        nameZhHans: "测试城市",
        nameEn: "Synthetic City",
        timezone: "America/Los_Angeles",
      },
      category: {
        id: "33333333-3333-4333-8333-333333333333",
        vertical: "RENTAL",
        slug: "apartments",
        nameZhHans: "公寓",
        nameEn: "Apartments",
      },
      owner: {
        id: "44444444-4444-4444-8444-444444444444",
        displayName: "Synthetic Publisher",
        avatarUrl: null,
      },
      organization: null,
      location: { precision: "CITY" },
      attributes: { bedrooms: 2 },
      featured: false,
      featuredUntil: null,
      publishedAt: "2026-07-29T12:00:00.000Z",
      expiresAt: "2026-08-29T12:00:00.000Z",
      updatedAt: "2026-07-29T12:00:00.000Z",
      version: 1,
    } as const;

    expect(
      listingCollectionSchema.parse({
        data: [common],
        page: { hasMore: false, nextCursor: null },
        generatedAt: "2026-07-29T12:01:00.000Z",
      }).data,
    ).toHaveLength(1);
    expect(
      publicListingResponseSchema.parse({
        data: {
          ...common,
          body: "A fictional public body rendered as escaped text.",
          createdAt: "2026-07-29T11:00:00.000Z",
        },
      }).data.status,
    ).toBe("PUBLISHED");
    expect(
      publicListingResponseSchema.safeParse({
        data: {
          ...common,
          body: "Owner-only fields must fail the anonymous projection boundary.",
          createdAt: "2026-07-29T11:00:00.000Z",
          ownerId: common.owner.id,
        },
      }).success,
    ).toBe(false);

    const searchRegion = {
      id: common.region.id,
      code: common.region.code,
      slug: common.region.slug,
      nameZhHans: common.region.nameZhHans,
      nameEn: common.region.nameEn,
    };
    const { featured: _featured, featuredUntil: _featuredUntil, ...searchBase } = common;
    void _featured;
    void _featuredUntil;
    expect(
      searchResponseSchema.parse({
        data: [
          {
            ...searchBase,
            region: searchRegion,
            location: { precision: "CITY", point: null },
            sponsored: false,
            distanceMiles: null,
          },
        ],
        page: { hasMore: false, nextCursor: null },
        facets: { types: [], categories: [], regions: [], priceUnits: [] },
        correctedQuery: null,
        tookMs: 5,
        generatedAt: "2026-07-29T12:01:00.000Z",
      }).data,
    ).toHaveLength(1);
    expect(
      searchResponseSchema.safeParse({
        data: [],
        page: { hasMore: true, nextCursor: null },
        facets: { types: [], categories: [], regions: [], priceUnits: [] },
        correctedQuery: null,
        tookMs: 5,
        generatedAt: "2026-07-29T12:01:00.000Z",
      }).success,
    ).toBe(false);
  });

  it("bounds private management filters, cursors, and ordered batch mutations", () => {
    const listingId = "11111111-1111-4111-8111-111111111111";
    const organizationId = "22222222-2222-4222-8222-222222222222";

    expect(
      listMyListingsQuerySchema.parse({
        bucket: "PUBLISHED",
        type: "SERVICE",
        organizationId,
        limit: "50",
      }),
    ).toMatchObject({
      bucket: "PUBLISHED",
      type: "SERVICE",
      organizationId,
      limit: 50,
    });
    for (const invalidQuery of [
      { bucket: "DELETED" },
      { cursor: "a".repeat(513) },
      { limit: "51" },
      { offset: "0" },
    ]) {
      expect(listMyListingsQuerySchema.safeParse(invalidQuery).success).toBe(false);
    }

    expect(
      batchListingActionSchema.parse({
        action: "ARCHIVE",
        items: [{ listingId, version: 1 }],
      }),
    ).toEqual({
      action: "ARCHIVE",
      items: [{ listingId, version: 1 }],
    });
    expect(
      batchListingActionSchema.safeParse({
        action: "DELETE",
        items: [
          { listingId, version: 1 },
          { listingId, version: 2 },
        ],
      }).success,
    ).toBe(false);
    expect(
      batchListingActionSchema.safeParse({
        action: "ARCHIVE",
        items: Array.from({ length: 21 }, (_, index) => ({
          listingId: `11111111-1111-4111-8111-${String(index + 1).padStart(12, "0")}`,
          version: 1,
        })),
      }).success,
    ).toBe(false);
    expect(
      batchListingActionSchema.safeParse({
        action: "ARCHIVE",
        items: [{ listingId, version: 1, ownerId: organizationId }],
      }).success,
    ).toBe(false);
  });
});
