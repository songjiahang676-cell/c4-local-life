import { describe, expect, it } from "vitest";
import { contentStatusSchema, createListingSchema, listingSearchSchema, moneySchema } from "../src";

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

  it("rejects money with more than two decimal places", () => {
    expect(moneySchema.safeParse({ amount: "12.345", currency: "USD" }).success).toBe(false);
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
});
