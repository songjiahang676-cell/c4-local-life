import { ListingType, Prisma, type PrismaClient } from "../../generated/prisma/client";

const metersPerMile = 1609.344;
const minimumRadiusMiles = 0.1;
const maximumRadiusMiles = 250;
const maximumResultLimit = 100;
const listingTypes = new Set<string>(Object.values(ListingType));

export type ListingRadiusQuery = {
  longitude: number;
  latitude: number;
  radiusMiles: number;
  listingType?: ListingType;
  limit?: number;
};

export type NearbyPublishedListing = {
  id: string;
  type: ListingType;
  title: string;
  slug: string;
  priceAmount: string | null;
  priceUnit: string | null;
  publishedAt: Date;
  isFeatured: boolean;
  distanceMiles: number;
};

export class InvalidGeoQueryError extends Error {
  readonly code = "INVALID_GEO_QUERY";

  constructor(message: string) {
    super(message);
    this.name = "InvalidGeoQueryError";
  }
}

type QueryClient = Pick<PrismaClient, "$queryRaw">;

function finiteNumber(name: string, value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new InvalidGeoQueryError(`${name} must be between ${minimum} and ${maximum}`);
  }
  return value;
}

function resultLimit(value: number | undefined): number {
  const limit = value ?? 25;
  if (!Number.isInteger(limit) || limit < 1 || limit > maximumResultLimit) {
    throw new InvalidGeoQueryError(`limit must be an integer between 1 and ${maximumResultLimit}`);
  }
  return limit;
}

export class ListingGeoRepository {
  constructor(private readonly client: QueryClient) {}

  findPublishedWithinRadius(input: ListingRadiusQuery): Promise<NearbyPublishedListing[]> {
    const longitude = finiteNumber("longitude", input.longitude, -180, 180);
    const latitude = finiteNumber("latitude", input.latitude, -90, 90);
    const radiusMiles = finiteNumber(
      "radiusMiles",
      input.radiusMiles,
      minimumRadiusMiles,
      maximumRadiusMiles,
    );
    const limit = resultLimit(input.limit);
    if (input.listingType && !listingTypes.has(input.listingType)) {
      throw new InvalidGeoQueryError("listingType is not supported");
    }
    const listingTypeFilter = input.listingType
      ? Prisma.sql`AND listing."type" = ${input.listingType}::"ListingType"`
      : Prisma.empty;

    return this.client.$queryRaw<NearbyPublishedListing[]>(Prisma.sql`
      WITH query_origin AS (
        SELECT ST_SetSRID(ST_MakePoint(${longitude}, ${latitude}), 4326)::geography AS point
      )
      SELECT
        listing."id"::text AS "id",
        listing."type"::text AS "type",
        listing."title",
        listing."slug",
        listing."price_amount"::text AS "priceAmount",
        listing."price_unit"::text AS "priceUnit",
        listing."published_at" AS "publishedAt",
        listing."is_featured" AS "isFeatured",
        (
          ST_Distance(listing."geo_point", query_origin.point) / ${metersPerMile}
        )::double precision AS "distanceMiles"
      FROM "listings" AS listing
      CROSS JOIN query_origin
      INNER JOIN "categories" AS category ON category."id" = listing."category_id"
        AND category."is_active" = true
      INNER JOIN "regions" AS region ON region."id" = listing."region_id"
        AND region."is_active" = true
      WHERE listing."status" = 'PUBLISHED'::"ContentStatus"
        AND listing."moderation_status" IN (
          'AUTO_APPROVED'::"ModerationStatus",
          'APPROVED'::"ModerationStatus"
        )
        AND listing."published_at" IS NOT NULL
        AND listing."deleted_at" IS NULL
        AND (listing."expires_at" IS NULL OR listing."expires_at" > CURRENT_TIMESTAMP)
        AND listing."geo_point" IS NOT NULL
        ${listingTypeFilter}
        AND ST_DWithin(
          listing."geo_point",
          query_origin.point,
          ${radiusMiles * metersPerMile}
        )
      ORDER BY
        listing."is_featured" DESC,
        ST_Distance(listing."geo_point", query_origin.point) ASC,
        listing."published_at" DESC,
        listing."id" ASC
      LIMIT ${limit}
    `);
  }
}
