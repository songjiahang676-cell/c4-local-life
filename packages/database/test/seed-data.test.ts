import { buildTestListing, buildTestUser } from "../src/testing/factories";
import { loadSeedData, parseSeedData } from "../src/seed/seed-data";
import { assertSyntheticSeedAllowed } from "../src/seed/seed-policy";
import { stableSeedUuid } from "../src/seed/stable-id";
import { describe, expect, it } from "vitest";

describe("seed data and test factories", () => {
  it("validates all delivered seed files and rejects an unsafe listing disclaimer", async () => {
    const seed = await loadSeedData();

    expect(seed.regions.metros[0]?.children.length).toBeGreaterThan(10);
    expect(
      seed.regions.metros[0]?.children.find((region) => region.code === "US-CA-LA")?.aliases,
    ).toEqual(expect.arrayContaining([{ locale: "und", value: "LA" }]));
    expect(seed.categories.verticals).toHaveLength(5);
    expect(seed.categories.verticals.every((category) => category.formFields.length > 0)).toBe(
      true,
    );
    expect(
      seed.categories.verticals.find((category) => category.type === "SERVICE")?.aliases,
    ).toEqual(expect.arrayContaining([{ locale: "zh-Hans", value: "找师傅" }]));
    expect(seed.listings.listings).toHaveLength(5);
    expect(seed.homepage.slots.every((slot) => !("html" in slot.source))).toBe(true);
    expect(() =>
      parseSeedData({
        ...seed,
        listings: { ...seed.listings, disclaimer: "Looks like production data." },
      }),
    ).toThrow();
    expect(() =>
      parseSeedData({
        ...seed,
        homepage: {
          ...seed.homepage,
          slots: [
            {
              ...seed.homepage.slots[0],
              source: {
                ...seed.homepage.slots[0]?.source,
                html: "<script>unsafe()</script>",
              },
            },
          ],
        },
      }),
    ).toThrow();
    expect(() =>
      parseSeedData({
        ...seed,
        regions: {
          ...seed.regions,
          country: {
            ...seed.regions.country,
            aliases: [
              { locale: "en-US", value: "U.S.A." },
              { locale: "en-US", value: "USA" },
            ],
          },
        },
      }),
    ).toThrow("Alias must be safe and unique");
  });

  it("derives stable RFC-compatible UUIDs without collisions for distinct keys", () => {
    const first = stableSeedUuid("region:US-CA-IRVINE");
    const repeated = stableSeedUuid("region:US-CA-IRVINE");
    const distinct = stableSeedUuid("region:US-CA-LA");

    expect(first).toBe(repeated);
    expect(first).not.toBe(distinct);
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("builds fictional draft fixtures with reserved example.invalid identities", () => {
    const user = buildTestUser();
    const listing = buildTestListing({
      ownerId: String(user.id),
      categoryId: "00000000-0000-4000-8000-000000000001",
      regionId: "00000000-0000-4000-8000-000000000002",
    });

    expect(user.email).toMatch(/@example\.invalid$/);
    expect(listing.status).toBe("DRAFT");
    expect(listing.title).toContain("Fictional");
    expect(listing.body).toContain("Synthetic test data only");
  });

  it("fails closed when a synthetic seed is attempted in production-like environments", () => {
    expect(() => assertSyntheticSeedAllowed("local")).not.toThrow();
    expect(() => assertSyntheticSeedAllowed("production")).toThrow("Synthetic seed is disabled");
    expect(() => assertSyntheticSeedAllowed("staging")).toThrow("Synthetic seed is disabled");
  });
});
