import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { z } from "zod";

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

const regionNodeSchema = z
  .object({
    code: z.string().regex(/^[A-Z0-9-]{2,80}$/),
    type: z.enum(["REGION_GROUP", "CITY"]),
    name: localizedNameSchema,
    centroid: centroidSchema.optional(),
    timezone: z.string().min(1).max(64).default("America/Los_Angeles"),
  })
  .strict();

const regionsSchema = z
  .object({
    version: z.literal(1),
    note: z.string().min(1),
    country: z.object({ code: z.literal("US"), name: localizedNameSchema }).strict(),
    state: z
      .object({
        code: z.literal("US-CA"),
        name: localizedNameSchema,
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
  })
  .strict();

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
