import { z } from "zod";
import type { components, operations, paths } from "./generated/openapi";

export type OpenApiComponents = components;
export type OpenApiOperations = operations;
export type OpenApiPaths = paths;
export type Locale = components["schemas"]["CreateListingRequest"]["locale"];
export type ListingType = components["schemas"]["ListingType"];
export type ContentStatus = components["schemas"]["ContentStatus"];
export type Money = components["schemas"]["Money"];
export type CreateListingInput = components["schemas"]["CreateListingRequest"];
export type ListingSearchInput = NonNullable<operations["searchContent"]["parameters"]["query"]>;
export type ListListingsQuery = NonNullable<operations["listListings"]["parameters"]["query"]>;
export type ProblemDetails = components["schemas"]["ProblemDetails"];

export const localeSchema: z.ZodType<Locale> = z.enum(["zh-Hans", "en-US"]);
export const listingTypeSchema: z.ZodType<ListingType> = z.enum([
  "JOB",
  "RENTAL",
  "TRANSFER",
  "SECONDHAND",
  "SERVICE",
]);
export const contentStatusSchema: z.ZodType<ContentStatus> = z.enum([
  "DRAFT",
  "SUBMITTED",
  "PUBLISHED",
  "EXPIRED",
  "ARCHIVED",
  "SUSPENDED",
  "DELETED",
]);

export const moneySchema: z.ZodType<Money> = z
  .object({
    amount: z.string().regex(/^\d+(\.\d{1,2})?$/),
    currency: z.literal("USD"),
    unit: z
      .enum([
        "FIXED",
        "HOURLY",
        "DAILY",
        "WEEKLY",
        "MONTHLY",
        "YEARLY",
        "SQFT",
        "NEGOTIABLE",
        "FREE",
      ])
      .nullish(),
  })
  .strict();

const geoPointSchema = z
  .object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
  })
  .strict();

export const createListingSchema: z.ZodType<CreateListingInput> = z
  .object({
    type: listingTypeSchema,
    locale: localeSchema.default("zh-Hans"),
    categoryId: z.uuid(),
    regionCode: z.string().min(2).max(80),
    title: z.string().trim().min(5).max(120),
    summary: z.string().trim().max(240).optional(),
    body: z.string().trim().min(20).max(10_000),
    price: moneySchema.optional(),
    location: z
      .object({
        precision: z.enum(["CITY", "NEIGHBORHOOD", "APPROXIMATE", "EXACT"]).default("CITY"),
        point: geoPointSchema.optional(),
      })
      .strict()
      .optional(),
    attributes: z.record(z.string(), z.unknown()).default({}),
    mediaIds: z.array(z.uuid()).max(20).default([]),
    contactMode: z.enum(["IN_APP", "PHONE_REVEAL", "EMAIL_REVEAL"]).default("IN_APP"),
  })
  .strict();

export const listingSearchSchema: z.ZodType<ListingSearchInput> = z
  .object({
    q: z.string().trim().max(120).optional(),
    type: listingTypeSchema.optional(),
    categoryId: z.uuid().optional(),
    regionCode: z.string().max(80).optional(),
    latitude: z.coerce.number().min(-90).max(90).optional(),
    longitude: z.coerce.number().min(-180).max(180).optional(),
    radiusMiles: z.coerce.number().int().min(1).max(100).optional(),
    minPrice: z.coerce.number().nonnegative().optional(),
    maxPrice: z.coerce.number().nonnegative().optional(),
    sort: z
      .enum(["RELEVANCE", "NEWEST", "PRICE_ASC", "PRICE_DESC", "DISTANCE"])
      .default("RELEVANCE"),
    cursor: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();

export const listListingsQuerySchema: z.ZodType<ListListingsQuery> = z
  .object({
    type: listingTypeSchema.optional(),
    categoryId: z.uuid().optional(),
    regionCode: z.string().optional(),
    status: contentStatusSchema.optional(),
    cursor: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
  })
  .strict();

export const problemDetailsSchema: z.ZodType<ProblemDetails> = z
  .object({
    type: z.string(),
    title: z.string(),
    status: z.number().int().min(400).max(599),
    detail: z.string(),
    instance: z.string(),
    requestId: z.string(),
    errors: z.record(z.string(), z.array(z.string())).optional(),
  })
  .strict();
