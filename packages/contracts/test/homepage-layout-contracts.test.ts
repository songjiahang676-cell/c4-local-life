import { describe, expect, it } from "vitest";
import { homepageLayoutDefinitionSchema } from "../src";

const validLayout = {
  version: 1,
  locale: "zh-Hans",
  regionCode: "US-CA-SOCAL",
  slots: [
    {
      key: "hero",
      kind: "HERO",
      enabled: true,
      source: { contentKey: "homepage.hero", imageAssetKey: "homepage/hero-socal" },
      limit: 1,
      cacheTtlSeconds: 300,
    },
    {
      key: "jobs-latest",
      kind: "LISTING_FEED",
      enabled: true,
      source: { listingType: "JOB", sort: "NEWEST" },
      limit: 5,
      cacheTtlSeconds: 60,
    },
    {
      key: "homepage-right-ad",
      kind: "AD",
      enabled: true,
      source: { placementKey: "home.right-rail" },
      limit: 1,
      sponsoredDisclosure: true,
      cacheTtlSeconds: 30,
    },
  ],
} as const;

describe("homepage layout contracts", () => {
  it("parses only implemented slot/source pairs and applies bounded defaults", () => {
    expect(homepageLayoutDefinitionSchema.parse(validLayout)).toMatchObject({
      version: 1,
      locale: "zh-Hans",
      slots: [
        { kind: "HERO", sponsoredDisclosure: false },
        { kind: "LISTING_FEED", sponsoredDisclosure: false },
        { kind: "AD", sponsoredDisclosure: true },
      ],
    });
  });

  it("rejects arbitrary source fields and kind/source mismatches", () => {
    expect(() =>
      homepageLayoutDefinitionSchema.parse({
        ...validLayout,
        slots: [
          {
            ...validLayout.slots[0],
            source: {
              contentKey: "homepage.hero",
              html: "<script>alert(1)</script>",
            },
          },
        ],
      }),
    ).toThrow();
    expect(() =>
      homepageLayoutDefinitionSchema.parse({
        ...validLayout,
        slots: [
          {
            ...validLayout.slots[1],
            kind: "HOT_SEARCHES",
          },
        ],
      }),
    ).toThrow();
  });

  it("requires stable unique slot keys and explicit disclosure for enabled ads", () => {
    expect(() =>
      homepageLayoutDefinitionSchema.parse({
        ...validLayout,
        slots: [
          validLayout.slots[0],
          {
            ...validLayout.slots[1],
            key: validLayout.slots[0].key,
          },
        ],
      }),
    ).toThrow("Homepage slot keys must be unique");
    expect(() =>
      homepageLayoutDefinitionSchema.parse({
        ...validLayout,
        slots: [
          {
            ...validLayout.slots[2],
            sponsoredDisclosure: false,
          },
        ],
      }),
    ).toThrow("Enabled ad slots require sponsored disclosure");
  });

  it("rejects unbounded and non-whitelisted configuration values", () => {
    expect(() =>
      homepageLayoutDefinitionSchema.parse({
        ...validLayout,
        regionCode: "bad region",
      }),
    ).toThrow();
    expect(() =>
      homepageLayoutDefinitionSchema.parse({
        ...validLayout,
        slots: [
          {
            key: "metrics",
            kind: "PRICE_METRIC",
            enabled: true,
            source: { metricKeys: ["UNREVIEWED_REVENUE"] },
            limit: 1,
          },
        ],
      }),
    ).toThrow();
  });
});
