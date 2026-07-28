import { categoryFormSchemaSchema, getCategoryFormSchemaQuerySchema } from "../src/index";
import { describe, expect, it } from "vitest";

const categoryId = "72000000-0000-4000-8000-000000000001";
const validField = {
  key: "condition",
  type: "SELECT",
  label: { "zh-Hans": "成色", "en-US": "Condition" },
  required: true,
  filterable: true,
  searchable: false,
  options: [
    { value: "new", label: { "zh-Hans": "全新", "en-US": "New" } },
    { value: "good", label: { "zh-Hans": "良好", "en-US": "Good" } },
  ],
  visibility: "PUBLIC",
  sortOrder: 10,
} as const;

describe("category form schema contracts", () => {
  it("accepts a bounded bilingual definition and coerces an optional historical version", () => {
    expect(
      categoryFormSchemaSchema.parse({
        categoryId,
        version: 2,
        fields: [validField],
        publicationPolicy: {
          defaultLifetimeDays: 45,
          manualReviewRequired: false,
          maxMedia: 10,
          allowExactAddress: false,
        },
      }),
    ).toMatchObject({ categoryId, version: 2 });
    expect(getCategoryFormSchemaQuerySchema.parse({ version: "2" })).toEqual({ version: 2 });
    expect(getCategoryFormSchemaQuerySchema.safeParse({ version: "0" }).success).toBe(false);
  });

  it("rejects unsafe regex, duplicate keys/options and executable or over-posted config", () => {
    const hostile = [
      {
        ...validField,
        validation: { pattern: "(a+)+$" },
      },
      {
        ...validField,
        options: [...validField.options, validField.options[0]],
      },
    ];
    expect(
      categoryFormSchemaSchema.safeParse({
        categoryId,
        version: 2,
        fields: hostile,
        script: "fetch('https://example.invalid')",
      }).success,
    ).toBe(false);
    expect(
      categoryFormSchemaSchema.safeParse({
        categoryId,
        version: 2,
        fields: [validField, { ...validField, sortOrder: 20 }],
      }).success,
    ).toBe(false);
  });

  it("keeps phone and email fields private and outside search/filter indexes", () => {
    for (const type of ["PHONE", "EMAIL"] as const) {
      expect(
        categoryFormSchemaSchema.safeParse({
          categoryId,
          version: 1,
          fields: [
            {
              key: `${type.toLowerCase()}Value`,
              type,
              label: { "zh-Hans": "联系方式", "en-US": "Contact" },
              required: false,
              filterable: false,
              searchable: false,
              visibility: "PUBLIC",
              sortOrder: 10,
            },
          ],
        }).success,
      ).toBe(false);
    }
  });
});
