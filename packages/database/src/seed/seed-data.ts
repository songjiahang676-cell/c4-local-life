import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { normalizeTaxonomyAlias } from "../taxonomy/alias-normalization";

const localizedNameSchema = z
  .object({
    "zh-Hans": z.string().min(1).max(120),
    "en-US": z.string().min(1).max(120),
  })
  .strict();

const centroidSchema = z
  .object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
  })
  .strict();

const taxonomyAliasesSchema = z
  .array(
    z
      .object({
        locale: z.enum(["zh-Hans", "en-US", "und"]),
        value: z.string().trim().min(1).max(120),
      })
      .strict(),
  )
  .max(20)
  .default([])
  .superRefine((aliases, context) => {
    const seen = new Set<string>();
    for (const [index, alias] of aliases.entries()) {
      const normalized = normalizeTaxonomyAlias(alias.value);
      const key = `${alias.locale}\0${normalized}`;
      if (!normalized || seen.has(key)) {
        context.addIssue({
          code: "custom",
          path: [index, "value"],
          message: "Alias must be safe and unique after normalization within its locale",
        });
      }
      seen.add(key);
    }
  });

const regionNodeSchema = z
  .object({
    code: z.string().regex(/^[A-Z0-9-]{2,80}$/),
    type: z.enum(["REGION_GROUP", "CITY"]),
    name: localizedNameSchema,
    aliases: taxonomyAliasesSchema,
    centroid: centroidSchema.optional(),
    timezone: z.string().min(1).max(64).default("America/Los_Angeles"),
  })
  .strict();

const regionsSchema = z
  .object({
    version: z.literal(1),
    note: z.string().min(1),
    country: z
      .object({
        code: z.literal("US"),
        name: localizedNameSchema,
        aliases: taxonomyAliasesSchema,
      })
      .strict(),
    state: z
      .object({
        code: z.literal("US-CA"),
        name: localizedNameSchema,
        aliases: taxonomyAliasesSchema,
        timezone: z.literal("America/Los_Angeles"),
      })
      .strict(),
    metros: z.array(
      regionNodeSchema.extend({
        type: z.literal("REGION_GROUP"),
        children: z.array(regionNodeSchema.extend({ type: z.literal("CITY") })).min(1),
      }),
    ),
  })
  .strict();

const categoryNodeSchema = z
  .object({
    slug: z.string().regex(/^[a-z0-9-]{1,120}$/),
    name: localizedNameSchema,
    aliases: taxonomyAliasesSchema,
  })
  .strict();

const formOptionSchema = z
  .object({
    value: z
      .string()
      .min(1)
      .max(80)
      .regex(/^[a-z0-9][a-zA-Z0-9_-]*$/),
    label: localizedNameSchema,
  })
  .strict();

const seedFormFieldSchema = z
  .object({
    key: z
      .string()
      .min(2)
      .max(80)
      .regex(/^[a-z][a-zA-Z0-9_]{1,79}$/),
    type: z.enum([
      "TEXT",
      "TEXTAREA",
      "NUMBER",
      "MONEY",
      "SELECT",
      "MULTISELECT",
      "BOOLEAN",
      "DATE",
      "LOCATION",
      "PHONE",
      "EMAIL",
    ]),
    label: localizedNameSchema,
    helpText: localizedNameSchema.optional(),
    required: z.boolean(),
    filterable: z.boolean(),
    searchable: z.boolean(),
    options: z.array(formOptionSchema).min(1).max(100).optional(),
    validation: z
      .object({
        min: z.number().finite().optional(),
        max: z.number().finite().optional(),
        minLength: z.number().int().min(0).max(10_000).optional(),
        maxLength: z.number().int().min(1).max(10_000).optional(),
        pattern: z.string().min(1).max(256).optional(),
      })
      .strict()
      .optional(),
    visibility: z.enum(["PUBLIC", "OWNER_ONLY", "MODERATOR_ONLY"]),
    sortOrder: z.number().int().min(0),
  })
  .strict()
  .superRefine((field, context) => {
    const selectable = field.type === "SELECT" || field.type === "MULTISELECT";
    if (selectable && (!field.options || field.options.length === 0)) {
      context.addIssue({
        code: "custom",
        path: ["options"],
        message: "Selectable seed fields require options",
      });
    }
    if (!selectable && field.options !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["options"],
        message: "Only selectable seed fields may define options",
      });
    }
    if (
      field.filterable &&
      !["NUMBER", "MONEY", "SELECT", "MULTISELECT", "BOOLEAN", "DATE"].includes(field.type)
    ) {
      context.addIssue({
        code: "custom",
        path: ["filterable"],
        message: "Seed field type is not eligible for normalized filtering",
      });
    }
    if (
      (field.type === "PHONE" || field.type === "EMAIL") &&
      (field.visibility === "PUBLIC" || field.filterable || field.searchable)
    ) {
      context.addIssue({
        code: "custom",
        path: ["visibility"],
        message: "Seed contact fields must remain private and unindexed",
      });
    }
    const optionValues = new Set<string>();
    for (const [index, option] of (field.options ?? []).entries()) {
      if (optionValues.has(option.value)) {
        context.addIssue({
          code: "custom",
          path: ["options", index, "value"],
          message: "Seed option values must be unique",
        });
      }
      optionValues.add(option.value);
    }
  });

const seedFormFieldsSchema = z
  .array(seedFormFieldSchema)
  .max(100)
  .superRefine((fields, context) => {
    const keys = new Set<string>();
    for (const [index, field] of fields.entries()) {
      if (keys.has(field.key)) {
        context.addIssue({
          code: "custom",
          path: [index, "key"],
          message: "Seed field keys must be unique",
        });
      }
      keys.add(field.key);
    }
  });

const listingTypeSchema = z.enum(["JOB", "RENTAL", "TRANSFER", "SECONDHAND", "SERVICE"]);
const priceUnitSchema = z.enum([
  "FIXED",
  "HOURLY",
  "DAILY",
  "WEEKLY",
  "MONTHLY",
  "YEARLY",
  "SQFT",
  "NEGOTIABLE",
  "FREE",
]);

const categoriesSchema = z
  .object({
    version: z.literal(1),
    verticals: z
      .array(
        categoryNodeSchema.extend({
          type: listingTypeSchema,
          lifetimeDays: z.number().int().min(1).max(365),
          manualReview: z.enum(["risk_based", "always"]),
          formFields: seedFormFieldsSchema,
          children: z.array(categoryNodeSchema).min(1),
        }),
      )
      .length(5),
    communityCategories: z.array(categoryNodeSchema),
  })
  .strict();

const sampleListingsSchema = z
  .object({
    version: z.literal(1),
    disclaimer: z.literal("Synthetic development data only."),
    listings: z.array(
      z
        .object({
          type: listingTypeSchema,
          categorySlug: z.string().regex(/^[a-z0-9-]{1,120}$/),
          regionCode: z.string().regex(/^[A-Z0-9-]{2,80}$/),
          title: z.string().min(3).max(115),
          summary: z.string().min(3).max(240),
          body: z.string().min(10).max(10_000),
          price: z
            .object({
              amount: z.string().regex(/^\d{1,12}(?:\.\d{2})$/),
              currency: z.literal("USD"),
              unit: priceUnitSchema,
            })
            .strict(),
          attributes: z.record(z.string(), z.unknown()),
        })
        .strict(),
    ),
  })
  .strict();

const homepageSchema = z
  .object({
    version: z.literal(1),
    locale: z.literal("zh-Hans"),
    regionCode: z.string().regex(/^[A-Z0-9-]{2,80}$/),
    slots: z.array(
      z
        .object({
          key: z.string().regex(/^[a-z0-9-]{1,80}$/),
          kind: z.string().regex(/^[A-Z_]{2,80}$/),
          enabled: z.boolean(),
          source: z.record(z.string(), z.unknown()),
          limit: z.number().int().min(1).max(100),
          sponsoredDisclosure: z.boolean().optional(),
          cacheTtlSeconds: z.number().int().min(1).max(86_400),
        })
        .strict(),
    ),
  })
  .strict();

export type SeedRegions = z.infer<typeof regionsSchema>;
export type SeedCategories = z.infer<typeof categoriesSchema>;
export type SeedListings = z.infer<typeof sampleListingsSchema>;
export type SeedHomepage = z.infer<typeof homepageSchema>;

export type SeedData = {
  regions: SeedRegions;
  categories: SeedCategories;
  listings: SeedListings;
  homepage: SeedHomepage;
};

export function parseSeedData(input: {
  regions: unknown;
  categories: unknown;
  listings: unknown;
  homepage: unknown;
}): SeedData {
  return {
    regions: regionsSchema.parse(input.regions),
    categories: categoriesSchema.parse(input.categories),
    listings: sampleListingsSchema.parse(input.listings),
    homepage: homepageSchema.parse(input.homepage),
  };
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8")) as unknown;
}

export async function loadSeedData(seedDirectory?: string): Promise<SeedData> {
  const directory = seedDirectory ?? fileURLToPath(new URL("../../../../seed/", import.meta.url));
  const [regions, categories, listings, homepage] = await Promise.all([
    readJson(`${directory}/regions.socal.json`),
    readJson(`${directory}/categories.zh-Hans.json`),
    readJson(`${directory}/sample-listings.json`),
    readJson(`${directory}/homepage.zh-Hans.json`),
  ]);

  return parseSeedData({ regions, categories, listings, homepage });
}
