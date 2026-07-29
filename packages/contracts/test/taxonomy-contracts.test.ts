import { describe, expect, it } from "vitest";
import {
  categoryCollectionResponseSchema,
  listCategoriesQuerySchema,
  listRegionsQuerySchema,
  regionCollectionResponseSchema,
} from "../src/index";

describe("taxonomy contracts", () => {
  it("parses active-only, REGION_GROUP, and normalized bilingual query text", () => {
    expect(
      listRegionsQuerySchema.parse({
        type: "REGION_GROUP",
        activeOnly: "true",
        q: "  Ｌ.Ａ.  ",
      }),
    ).toEqual({
      type: "REGION_GROUP",
      activeOnly: true,
      q: "L.A.",
    });
    expect(listCategoriesQuerySchema.parse({ vertical: "SERVICE" })).toEqual({
      vertical: "SERVICE",
      activeOnly: true,
    });
  });

  it("rejects ambiguous booleans, unknown pagination, malformed parents, and control text", () => {
    for (const input of [
      { activeOnly: "1" },
      { activeOnly: "false" },
      { offset: "0" },
      { parentCode: "us-ca" },
      { q: "unsafe\u202Equery" },
    ]) {
      expect(listRegionsQuerySchema.safeParse(input).success).toBe(false);
    }
    expect(listCategoriesQuerySchema.safeParse({ parentId: "not-a-uuid" }).success).toBe(false);
    expect(listCategoriesQuerySchema.safeParse({ activeOnly: "yes" }).success).toBe(false);
  });

  it("keeps recursive public taxonomy responses strict", () => {
    const shared = {
      id: "11111111-1111-4111-8111-111111111111",
      parentId: null,
      slug: "synthetic",
      name: { "zh-Hans": "测试", "en-US": "Synthetic" },
      active: true,
      aliases: [],
      children: [],
    } as const;

    expect(
      regionCollectionResponseSchema.parse({
        data: [
          {
            ...shared,
            code: "US-CA-SYNTHETIC",
            type: "CITY",
            timezone: "America/Los_Angeles",
            centroid: null,
          },
        ],
      }).data,
    ).toHaveLength(1);
    expect(
      categoryCollectionResponseSchema.parse({
        data: [
          {
            ...shared,
            vertical: "SERVICE",
            iconKey: "wrench",
            formSchemaVersion: 1,
          },
        ],
      }).data,
    ).toHaveLength(1);
    expect(
      categoryCollectionResponseSchema.safeParse({
        data: [
          {
            ...shared,
            vertical: "SERVICE",
            iconKey: null,
            formSchemaVersion: 1,
            privateRule: true,
          },
        ],
      }).success,
    ).toBe(false);
  });
});
