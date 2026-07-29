import { describe, expect, it } from "vitest";
import {
  contentStatusSchema,
  createListingSchema,
  listListingsQuerySchema,
  listingSearchSchema,
  moneySchema,
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

  it("tracks complete contract enums and coerces documented search numbers", () => {
    expect(contentStatusSchema.parse("DELETED")).toBe("DELETED");
    expect(
      listingSearchSchema.parse({
        latitude: "34.05",
        longitude: "-118.24",
        radiusMiles: "25",
      }),
    ).toMatchObject({
      latitude: 34.05,
      longitude: -118.24,
      radiusMiles: 25,
      sort: "RELEVANCE",
      limit: 20,
    });
  });

  it("accepts every implemented public Listing vertical and rejects unknown values", () => {
    expect(listListingsQuerySchema.parse({})).toMatchObject({ type: "RENTAL", limit: 20 });
    for (const type of ["RENTAL", "JOB", "TRANSFER", "SECONDHAND", "SERVICE"] as const) {
      expect(listListingsQuerySchema.parse({ type })).toMatchObject({ type, limit: 20 });
    }
    expect(listListingsQuerySchema.safeParse({ type: "BUSINESS" }).success).toBe(false);
  });
});
