import { describe, expect, it } from "vitest";
import {
  searchDictionaryDefinitionSchema,
  searchSuggestionResponseSchema,
  searchSuggestionsQuerySchema,
  searchTrendingQuerySchema,
  searchTrendingResponseSchema,
} from "../src";

describe("search discovery contracts", () => {
  it("normalizes bounded suggestion queries and supports safe empty-query defaults", () => {
    expect(searchSuggestionsQuerySchema.parse({})).toEqual({
      locale: "zh-Hans",
      limit: 10,
    });
    expect(
      searchSuggestionsQuerySchema.parse({
        q: "  \uFF29\uFF52\uFF56\uFF49\uFF4E\uFF45 \u516C\u5BD3  ",
        regionCode: "US-CA-ORANGE-IRVINE",
        locale: "en-US",
        limit: "5",
      }),
    ).toEqual({
      q: "Irvine \u516C\u5BD3",
      regionCode: "US-CA-ORANGE-IRVINE",
      locale: "en-US",
      limit: 5,
    });
  });

  it("rejects unsafe, unknown, or unbounded suggestion and trending inputs", () => {
    for (const invalid of [
      { q: "   " },
      { q: "safe\u202eunsafe" },
      { q: "x".repeat(51) },
      { regionCode: "../irvine" },
      { locale: "es-US" },
      { limit: "11" },
      { offset: "0" },
    ]) {
      expect(searchSuggestionsQuerySchema.safeParse(invalid).success).toBe(false);
    }

    for (const invalid of [
      { window: "HOUR_1" },
      { regionCode: "x" },
      { limit: "0" },
      { includeCounts: "true" },
    ]) {
      expect(searchTrendingQuerySchema.safeParse(invalid).success).toBe(false);
    }

    expect(searchTrendingQuerySchema.parse({})).toEqual({
      locale: "zh-Hans",
      window: "DAY_7",
      limit: 10,
    });
  });

  it("keeps public suggestion and trending responses strict and count-free", () => {
    expect(
      searchSuggestionResponseSchema.parse({
        data: [
          {
            type: "CATEGORY",
            label: "租房",
            value: "rentals",
            locale: "zh-Hans",
          },
        ],
        generatedAt: "2026-07-29T12:00:00.000Z",
      }),
    ).toMatchObject({ data: [{ type: "CATEGORY" }] });

    expect(
      searchSuggestionResponseSchema.safeParse({
        data: [
          {
            type: "BUSINESS",
            label: "Unimplemented entity",
            value: "entity",
            locale: "en-US",
          },
        ],
        generatedAt: "2026-07-29T12:00:00.000Z",
      }).success,
    ).toBe(false);

    expect(
      searchTrendingResponseSchema.parse({
        data: [
          { query: "Irvine apartment", rank: 1, locale: "en-US" },
          { query: "Irvine jobs", rank: 2, locale: "en-US" },
        ],
        window: "DAY_7",
        generatedAt: "2026-07-29T12:00:00.000Z",
      }),
    ).toMatchObject({ window: "DAY_7" });

    expect(
      searchTrendingResponseSchema.safeParse({
        data: [{ query: "private low-frequency query", rank: 1, locale: "en-US", count: 1 }],
        window: "DAY_7",
        generatedAt: "2026-07-29T12:00:00.000Z",
      }).success,
    ).toBe(false);
    expect(
      searchTrendingResponseSchema.safeParse({
        data: [
          { query: "one", rank: 1, locale: "en-US" },
          { query: "two", rank: 1, locale: "en-US" },
        ],
        window: "DAY_7",
        generatedAt: "2026-07-29T12:00:00.000Z",
      }).success,
    ).toBe(false);
  });

  it("validates versionable synonym and blocked-term definitions without ambiguity", () => {
    const valid = {
      schemaVersion: 1,
      synonymGroups: [
        {
          key: "rental-apartment",
          locale: "en-US",
          canonical: "apartment",
          alternatives: ["apt", "rental"],
          regionCodes: ["US-CA-ORANGE"],
        },
      ],
      blockedTerms: [{ term: "private@example.com", locale: "und", reason: "PII" }],
    } as const;

    expect(searchDictionaryDefinitionSchema.parse(valid)).toEqual(valid);
    expect(
      searchDictionaryDefinitionSchema.safeParse({
        ...valid,
        synonymGroups: [
          ...valid.synonymGroups,
          {
            key: "duplicate-scope",
            locale: "en-US",
            canonical: "rental",
            alternatives: ["lease"],
            regionCodes: ["US-CA-ORANGE"],
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      searchDictionaryDefinitionSchema.safeParse({
        ...valid,
        blockedTerms: [
          ...valid.blockedTerms,
          { term: "PRIVATE@example.com", locale: "und", reason: "SCAM" },
        ],
      }).success,
    ).toBe(false);
  });
});
