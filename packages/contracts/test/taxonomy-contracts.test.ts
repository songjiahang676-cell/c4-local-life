import { describe, expect, it } from "vitest";
import { listCategoriesQuerySchema, listRegionsQuerySchema } from "../src/index";

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
});
