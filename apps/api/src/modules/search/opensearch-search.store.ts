import { type OnModuleDestroy } from "@nestjs/common";
import {
  Client,
  errors,
  type ClientOptions,
  type RequestParams,
} from "@opensearch-project/opensearch";
import type { ApiEnvironment } from "@socal/config";
import type { SearchListingResult } from "@socal/contracts";
import {
  SearchProjectionError,
  SearchSnapshotExpiredError,
  type SearchFacetBucket,
  type SearchFacets,
  type SearchSortValue,
  type SearchStore,
  type SearchStoreHit,
  type SearchStoreInput,
  type SearchStoreResult,
  SearchTimeoutError,
  SearchUnavailableError,
} from "./search.store";

const listingTypes = new Set(["RENTAL", "JOB", "TRANSFER", "SECONDHAND", "SERVICE"]);
const locales = new Set(["zh-Hans", "en-US"]);
const locationPrecisions = new Set(["CITY", "NEIGHBORHOOD", "APPROXIMATE"]);
const verificationStatuses = new Set(["UNVERIFIED", "PENDING", "VERIFIED", "REJECTED", "EXPIRED"]);
const priceUnits = new Set([
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
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const publicSourceFields = [
  "id",
  "type",
  "status",
  "locale",
  "slug",
  "title",
  "summary",
  "category.id",
  "category.slug",
  "category.nameZhHans",
  "category.nameEn",
  "region.id",
  "region.code",
  "region.slug",
  "region.nameZhHans",
  "region.nameEn",
  "price.amountMinor",
  "price.currency",
  "price.unit",
  "location.precision",
  "location.point",
  "attributes.key",
  "attributes.keywordValue",
  "attributes.textValue",
  "attributes.numberValue",
  "attributes.booleanValue",
  "publisher.ownerId",
  "publisher.displayName",
  "publisher.avatarUrl",
  "publisher.organizationId",
  "publisher.organizationSlug",
  "publisher.organizationVerification",
  "isSponsored",
  "publishedAt",
  "expiresAt",
  "updatedAt",
  "contentVersion",
] as const;

type JsonObject = Record<string, unknown>;

function isRecord(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requiredRecord(value: unknown): JsonObject {
  if (!isRecord(value)) throw new SearchProjectionError();
  return value;
}

function requiredString(value: unknown, maximumLength: number): string {
  if (typeof value !== "string" || value.length < 1 || value.length > maximumLength) {
    throw new SearchProjectionError();
  }
  return value;
}

function nullableString(value: unknown, maximumLength: number): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" || value.length > maximumLength) {
    throw new SearchProjectionError();
  }
  return value;
}

function uuid(value: unknown): string {
  const parsed = requiredString(value, 36);
  if (!uuidPattern.test(parsed)) throw new SearchProjectionError();
  return parsed;
}

function dateTime(value: unknown): string {
  const parsed = requiredString(value, 40);
  const instant = new Date(parsed);
  if (!Number.isFinite(instant.getTime()) || instant.toISOString() !== parsed) {
    throw new SearchProjectionError();
  }
  return parsed;
}

function finiteNumber(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new SearchProjectionError();
  return value;
}

function safePositiveInteger(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) throw new SearchProjectionError();
  return value as number;
}

function optionalUrl(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const candidate = requiredString(value, 2_048);
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new SearchProjectionError();
    }
  } catch (error: unknown) {
    if (error instanceof SearchProjectionError) throw error;
    throw new SearchProjectionError();
  }
  return candidate;
}

function decimalAmount(amountMinor: number): string {
  const whole = Math.floor(amountMinor / 100);
  const fraction = amountMinor % 100;
  return fraction === 0 ? String(whole) : `${whole}.${String(fraction).padStart(2, "0")}`;
}

function publicPrice(value: unknown): SearchListingResult["price"] {
  const price = requiredRecord(value);
  if (price.currency !== "USD" || typeof price.unit !== "string" || !priceUnits.has(price.unit)) {
    throw new SearchProjectionError();
  }
  const unit = price.unit as NonNullable<SearchListingResult["price"]>["unit"];
  const amountMinor = price.amountMinor;
  if (unit === "FREE" || unit === "NEGOTIABLE") {
    if (amountMinor !== null && amountMinor !== undefined) throw new SearchProjectionError();
    return { amount: null, currency: "USD", unit };
  }
  if (!Number.isSafeInteger(amountMinor) || (amountMinor as number) <= 0) {
    throw new SearchProjectionError();
  }
  if ((amountMinor as number) > 99_999_999_999_999) throw new SearchProjectionError();
  return {
    amount: decimalAmount(amountMinor as number),
    currency: "USD",
    unit,
  };
}

function publicAttributes(value: unknown): Readonly<Record<string, string | number | boolean>> {
  if (!Array.isArray(value) || value.length > 100) throw new SearchProjectionError();
  const result: Record<string, string | number | boolean> = {};
  for (const rawAttribute of value) {
    const attribute = requiredRecord(rawAttribute);
    const key = requiredString(attribute.key, 120);
    if (key in result) throw new SearchProjectionError();
    const textValue = attribute.textValue;
    const keywordValue = attribute.keywordValue;
    const numberValue = attribute.numberValue;
    const booleanValue = attribute.booleanValue;
    if (typeof textValue === "string") {
      if (
        textValue.length > 1_000 ||
        (keywordValue !== undefined && keywordValue !== textValue) ||
        numberValue !== undefined ||
        booleanValue !== undefined
      ) {
        throw new SearchProjectionError();
      }
      result[key] = textValue;
    } else if (typeof keywordValue === "string") {
      if (keywordValue.length > 1_000 || numberValue !== undefined || booleanValue !== undefined) {
        throw new SearchProjectionError();
      }
      result[key] = keywordValue;
    } else if (typeof numberValue === "number" && Number.isFinite(numberValue)) {
      if (booleanValue !== undefined) throw new SearchProjectionError();
      result[key] = numberValue;
    } else if (typeof booleanValue === "boolean") {
      result[key] = booleanValue;
    } else {
      throw new SearchProjectionError();
    }
  }
  return result;
}

function publicLocation(value: unknown): SearchListingResult["location"] {
  const location = requiredRecord(value);
  if (typeof location.precision !== "string" || !locationPrecisions.has(location.precision)) {
    throw new SearchProjectionError();
  }
  let point: SearchListingResult["location"]["point"] = null;
  if (location.point !== undefined && location.point !== null) {
    const rawPoint = requiredRecord(location.point);
    const latitude = finiteNumber(rawPoint.lat);
    const longitude = finiteNumber(rawPoint.lon);
    if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
      throw new SearchProjectionError();
    }
    point = { latitude, longitude };
  }
  return {
    precision: location.precision as SearchListingResult["location"]["precision"],
    point,
  };
}

function publicOrganization(value: JsonObject): SearchListingResult["organization"] {
  const id = value.organizationId;
  const slug = value.organizationSlug;
  const verification = value.organizationVerification;
  if (id === null || id === undefined) {
    if (
      (slug !== null && slug !== undefined) ||
      (verification !== null && verification !== undefined)
    ) {
      throw new SearchProjectionError();
    }
    return null;
  }
  if (
    typeof verification !== "string" ||
    !verificationStatuses.has(verification) ||
    typeof slug !== "string"
  ) {
    throw new SearchProjectionError();
  }
  return {
    id: uuid(id),
    slug: requiredString(slug, 120),
    verificationStatus: verification as NonNullable<
      SearchListingResult["organization"]
    >["verificationStatus"],
  };
}

export function parseSearchListingResult(
  value: unknown,
  distanceMiles: number | null,
): SearchListingResult {
  const source = requiredRecord(value);
  if (
    source.status !== "PUBLISHED" ||
    typeof source.type !== "string" ||
    !listingTypes.has(source.type) ||
    typeof source.locale !== "string" ||
    !locales.has(source.locale)
  ) {
    throw new SearchProjectionError();
  }
  const type = source.type as SearchListingResult["type"];
  const category = requiredRecord(source.category);
  const region = requiredRecord(source.region);
  const publisher = requiredRecord(source.publisher);
  if (typeof source.isSponsored !== "boolean") throw new SearchProjectionError();
  return {
    id: uuid(source.id),
    type,
    status: "PUBLISHED",
    locale: source.locale as SearchListingResult["locale"],
    slug: requiredString(source.slug, 180),
    title: requiredString(source.title, 180),
    summary: nullableString(source.summary, 600),
    price: publicPrice(source.price),
    region: {
      id: uuid(region.id),
      code: requiredString(region.code, 40),
      slug: requiredString(region.slug, 120),
      nameZhHans: requiredString(region.nameZhHans, 160),
      nameEn: requiredString(region.nameEn, 160),
    },
    category: {
      id: uuid(category.id),
      vertical: type,
      slug: requiredString(category.slug, 120),
      nameZhHans: requiredString(category.nameZhHans, 160),
      nameEn: requiredString(category.nameEn, 160),
    },
    owner: {
      id: uuid(publisher.ownerId),
      displayName: requiredString(publisher.displayName, 120),
      avatarUrl: optionalUrl(publisher.avatarUrl),
    },
    organization: publicOrganization(publisher),
    location: publicLocation(source.location),
    attributes: publicAttributes(source.attributes),
    sponsored: source.isSponsored,
    distanceMiles,
    publishedAt: dateTime(source.publishedAt),
    expiresAt: dateTime(source.expiresAt),
    updatedAt: dateTime(source.updatedAt),
    version: safePositiveInteger(source.contentVersion),
  };
}

function decimalMinor(value: string): number {
  const [whole = "0", fraction = ""] = value.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}

function searchFilters(input: SearchStoreInput): JsonObject[] {
  const filters: JsonObject[] = [
    { term: { status: "PUBLISHED" } },
    { range: { expiresAt: { gt: input.snapshotAt } } },
  ];
  const { criteria } = input;
  if (criteria.type) filters.push({ term: { type: criteria.type } });
  if (criteria.categoryId) filters.push({ term: { "category.id": criteria.categoryId } });
  if (criteria.regionCode) {
    filters.push({ term: { "region.code": criteria.regionCode.toLowerCase() } });
  }
  if (criteria.minPrice !== undefined || criteria.maxPrice !== undefined) {
    filters.push({
      range: {
        "price.amountMinor": {
          ...(criteria.minPrice === undefined ? {} : { gte: decimalMinor(criteria.minPrice) }),
          ...(criteria.maxPrice === undefined ? {} : { lte: decimalMinor(criteria.maxPrice) }),
        },
      },
    });
  }
  if (
    criteria.radiusMiles !== undefined &&
    criteria.latitude !== undefined &&
    criteria.longitude !== undefined
  ) {
    filters.push({
      geo_distance: {
        distance: `${criteria.radiusMiles}mi`,
        "location.point": {
          lat: criteria.latitude,
          lon: criteria.longitude,
        },
      },
    });
  }
  return filters;
}

function textQuery(query: string): JsonObject {
  return {
    bool: {
      minimum_should_match: 1,
      should: [
        {
          multi_match: {
            query,
            type: "best_fields",
            operator: "and",
            fields: [
              "title^5",
              "category.nameZhHans^4",
              "category.nameEn^4",
              "category.aliases^3",
              "region.nameZhHans^4",
              "region.nameEn^4",
              "region.aliases^3",
              "summary^2",
              "body",
            ],
          },
        },
        {
          nested: {
            path: "attributes",
            score_mode: "max",
            query: {
              multi_match: {
                query,
                fields: ["attributes.textValue^2", "attributes.keywordValue"],
              },
            },
          },
        },
      ],
    },
  };
}

function searchQuery(input: SearchStoreInput): JsonObject {
  const baseQuery = {
    bool: {
      filter: searchFilters(input),
      ...(input.criteria.q ? { must: [textQuery(input.criteria.q)] } : {}),
    },
  };
  if (input.criteria.sort !== "RELEVANCE") return baseQuery;
  return {
    function_score: {
      query: baseQuery,
      score_mode: "sum",
      boost_mode: "sum",
      max_boost: 20,
      functions: [
        {
          field_value_factor: {
            field: "qualityScore",
            factor: 0.1,
            missing: 0,
            modifier: "none",
          },
        },
        {
          gauss: {
            publishedAt: {
              origin: input.snapshotAt,
              scale: "30d",
              offset: "1d",
              decay: 0.5,
            },
          },
          weight: 2,
        },
      ],
    },
  };
}

function searchSort(input: SearchStoreInput): readonly unknown[] {
  switch (input.criteria.sort) {
    case "NEWEST":
      return [{ publishedAt: { order: "desc" } }, { id: { order: "asc" } }];
    case "PRICE_ASC":
      return [
        { "price.amountMinor": { order: "asc", missing: 100_000_000_000_000 } },
        { publishedAt: { order: "desc" } },
        { id: { order: "asc" } },
      ];
    case "PRICE_DESC":
      return [
        { "price.amountMinor": { order: "desc", missing: -1 } },
        { publishedAt: { order: "desc" } },
        { id: { order: "asc" } },
      ];
    case "DISTANCE":
      return [
        {
          _geo_distance: {
            "location.point": {
              lat: input.criteria.latitude,
              lon: input.criteria.longitude,
            },
            order: "asc",
            unit: "mi",
            mode: "min",
            distance_type: "arc",
            ignore_unmapped: false,
          },
        },
        { publishedAt: { order: "desc" } },
        { id: { order: "asc" } },
      ];
    default:
      return [{ _score: { order: "desc" } }, { publishedAt: { order: "desc" } }, { id: "asc" }];
  }
}

export function buildOpenSearchRequest(input: SearchStoreInput): RequestParams.Search<JsonObject> {
  return {
    allow_partial_search_results: false,
    body: {
      size: (input.criteria.limit ?? 20) + 1,
      timeout: `${input.timeoutMilliseconds}ms`,
      track_total_hits: false,
      _source: [...publicSourceFields],
      pit: {
        id: input.snapshotId,
        keep_alive: `${input.keepAliveSeconds}s`,
      },
      query: searchQuery(input),
      sort: searchSort(input),
      ...(input.searchAfter ? { search_after: input.searchAfter } : {}),
      aggs: {
        types: { terms: { field: "type", size: 5, order: [{ _count: "desc" }, { _key: "asc" }] } },
        categories: {
          terms: {
            field: "category.id",
            size: 50,
            order: [{ _count: "desc" }, { _key: "asc" }],
          },
        },
        regions: {
          terms: {
            field: "region.code",
            size: 50,
            order: [{ _count: "desc" }, { _key: "asc" }],
          },
        },
        priceUnits: {
          terms: {
            field: "price.unit",
            size: 20,
            order: [{ _count: "desc" }, { _key: "asc" }],
          },
        },
      },
    },
  };
}

function sortValues(value: unknown): readonly SearchSortValue[] {
  if (
    !Array.isArray(value) ||
    value.length < 1 ||
    value.length > 8 ||
    !value.every(
      (entry) =>
        entry === null ||
        typeof entry === "string" ||
        (typeof entry === "number" && Number.isFinite(entry)),
    )
  ) {
    throw new SearchProjectionError();
  }
  return value as readonly SearchSortValue[];
}

function facetBuckets(value: unknown, maximum: number): readonly SearchFacetBucket[] {
  const aggregation = requiredRecord(value);
  if (!Array.isArray(aggregation.buckets) || aggregation.buckets.length > maximum) {
    throw new SearchProjectionError();
  }
  return aggregation.buckets.map((rawBucket) => {
    const bucket = requiredRecord(rawBucket);
    if (
      typeof bucket.key !== "string" ||
      bucket.key.length > 120 ||
      !Number.isSafeInteger(bucket.doc_count) ||
      (bucket.doc_count as number) < 0
    ) {
      throw new SearchProjectionError();
    }
    return { value: bucket.key, count: bucket.doc_count as number };
  });
}

function parseFacets(value: unknown): SearchFacets {
  const aggregations = requiredRecord(value);
  return {
    types: facetBuckets(aggregations.types, 5),
    categories: facetBuckets(aggregations.categories, 50),
    regions: facetBuckets(aggregations.regions, 50),
    priceUnits: facetBuckets(aggregations.priceUnits, 20),
  };
}

export function parseOpenSearchResponse(value: unknown, distanceSort: boolean): SearchStoreResult {
  const body = requiredRecord(value);
  if (body.timed_out !== false) {
    if (body.timed_out === true) throw new SearchTimeoutError();
    throw new SearchProjectionError();
  }
  const shards = requiredRecord(body._shards);
  if (!Number.isSafeInteger(shards.failed) || shards.failed !== 0) {
    throw new SearchUnavailableError();
  }
  if (!Number.isSafeInteger(body.took) || (body.took as number) < 0) {
    throw new SearchProjectionError();
  }
  const hitsContainer = requiredRecord(body.hits);
  if (!Array.isArray(hitsContainer.hits) || hitsContainer.hits.length > 51) {
    throw new SearchProjectionError();
  }
  const hits: SearchStoreHit[] = hitsContainer.hits.map((rawHit) => {
    const hit = requiredRecord(rawHit);
    const sort = sortValues(hit.sort);
    const distance =
      distanceSort && typeof sort[0] === "number" && Number.isFinite(sort[0])
        ? Math.max(0, sort[0])
        : null;
    return {
      result: parseSearchListingResult(hit._source, distance),
      sort,
    };
  });
  return {
    hits,
    facets: parseFacets(body.aggregations),
    tookMilliseconds: body.took as number,
  };
}

function mapOpenSearchError(error: unknown, snapshotSearch: boolean): Error {
  if (
    error instanceof errors.TimeoutError ||
    (error instanceof errors.ResponseError &&
      (error.statusCode === 408 || error.statusCode === 504))
  ) {
    return new SearchTimeoutError();
  }
  if (snapshotSearch && error instanceof errors.ResponseError && error.statusCode === 404) {
    return new SearchSnapshotExpiredError();
  }
  return new SearchUnavailableError();
}

export class OpenSearchSearchStore implements SearchStore, OnModuleDestroy {
  readonly #client: Client;
  readonly #readAlias: string;

  constructor(environment: ApiEnvironment) {
    const options: ClientOptions = {
      node: environment.OPENSEARCH_NODE,
      requestTimeout: environment.SEARCH_QUERY_TIMEOUT_MS + 500,
      maxRetries: 1,
    };
    if (environment.OPENSEARCH_USERNAME && environment.OPENSEARCH_PASSWORD) {
      options.auth = {
        username: environment.OPENSEARCH_USERNAME,
        password: environment.OPENSEARCH_PASSWORD.reveal(),
      };
    }
    this.#client = new Client(options);
    this.#readAlias = `${environment.OPENSEARCH_INDEX_PREFIX}_listings_read`;
  }

  async openSnapshot(keepAliveSeconds: number): Promise<string> {
    try {
      const response = await this.#client.createPit<{ pit_id?: unknown }>({
        index: this.#readAlias,
        keep_alive: `${keepAliveSeconds}s`,
        allow_partial_pit_creation: false,
      });
      return requiredString(response.body.pit_id, 1_024);
    } catch (error: unknown) {
      if (error instanceof SearchProjectionError) throw error;
      throw mapOpenSearchError(error, false);
    }
  }

  async search(input: SearchStoreInput): Promise<SearchStoreResult> {
    try {
      const request = buildOpenSearchRequest(input);
      const response = await this.#client.search<unknown>(request, {
        requestTimeout: input.timeoutMilliseconds + 500,
        maxRetries: 0,
      });
      return parseOpenSearchResponse(response.body, input.criteria.sort === "DISTANCE");
    } catch (error: unknown) {
      if (
        error instanceof SearchProjectionError ||
        error instanceof SearchTimeoutError ||
        error instanceof SearchUnavailableError
      ) {
        throw error;
      }
      throw mapOpenSearchError(error, true);
    }
  }

  async closeSnapshot(snapshotId: string): Promise<void> {
    try {
      await this.#client.deletePit({
        body: { pit_id: [snapshotId] },
      });
    } catch (error: unknown) {
      if (
        error instanceof errors.ResponseError &&
        (error.statusCode === 404 || error.statusCode === 400)
      ) {
        return;
      }
      throw mapOpenSearchError(error, false);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.#client.close();
  }
}
