import { randomUUID } from "node:crypto";
import {
  ContentStatus,
  ListingType,
  ModerationStatus,
  RegionType,
  type Prisma,
} from "../generated/prisma/client";
import { ListingGeoRepository } from "../src/repositories/listing-geo.repository";
import {
  createIntegrationDatabase,
  type IntegrationDatabase,
} from "../src/testing/integration-database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const databaseUrl = process.env.DATABASE_INTEGRATION_URL ?? "";
const integration = describe.skipIf(databaseUrl.length === 0);

type GeoFixture = {
  nearbyFeaturedId: string;
  nearbyRegularId: string;
};

async function createGeoFixture(transaction: Prisma.TransactionClient): Promise<GeoFixture> {
  const fixture = {
    userId: randomUUID(),
    regionId: randomUUID(),
    categoryId: randomUUID(),
    nearbyFeaturedId: randomUUID(),
    nearbyRegularId: randomUUID(),
    farAwayId: randomUUID(),
    draftId: randomUUID(),
    expiredId: randomUUID(),
    deletedId: randomUUID(),
  };
  await transaction.user.create({
    data: { id: fixture.userId, email: `${fixture.userId}@example.invalid` },
  });
  await transaction.region.create({
    data: {
      id: fixture.regionId,
      type: RegionType.CITY,
      code: `TEST-${fixture.regionId}`,
      slug: `test-${fixture.regionId}`,
      nameZhHans: "测试地区",
      nameEn: "Test Region",
    },
  });
  await transaction.category.create({
    data: {
      id: fixture.categoryId,
      vertical: ListingType.RENTAL,
      slug: `test-${fixture.categoryId}`,
      nameZhHans: "测试分类",
      nameEn: "Test Category",
    },
  });

  const sharedListing = {
    type: ListingType.RENTAL,
    ownerId: fixture.userId,
    categoryId: fixture.categoryId,
    regionId: fixture.regionId,
    moderationStatus: ModerationStatus.APPROVED,
    body: "Deliberately fictional integration fixture.",
    publishedAt: new Date("2026-07-20T12:00:00.000Z"),
  };
  await transaction.listing.createMany({
    data: [
      {
        ...sharedListing,
        id: fixture.nearbyFeaturedId,
        title: "Featured nearby fixture",
        slug: `featured-${fixture.nearbyFeaturedId}`,
        status: ContentStatus.PUBLISHED,
        latitude: 33.6901,
        longitude: -117.835,
        isFeatured: true,
      },
      {
        ...sharedListing,
        id: fixture.nearbyRegularId,
        title: "Regular nearby fixture",
        slug: `regular-${fixture.nearbyRegularId}`,
        status: ContentStatus.PUBLISHED,
        latitude: 33.676,
        longitude: -117.812,
      },
      {
        ...sharedListing,
        id: fixture.farAwayId,
        title: "Far away fixture",
        slug: `far-${fixture.farAwayId}`,
        status: ContentStatus.PUBLISHED,
        latitude: 34.0522,
        longitude: -118.2437,
      },
      {
        ...sharedListing,
        id: fixture.draftId,
        title: "Nearby draft fixture",
        slug: `draft-${fixture.draftId}`,
        status: ContentStatus.DRAFT,
        publishedAt: null,
        latitude: 33.6846,
        longitude: -117.8265,
      },
      {
        ...sharedListing,
        id: fixture.expiredId,
        title: "Nearby expired fixture",
        slug: `expired-${fixture.expiredId}`,
        status: ContentStatus.PUBLISHED,
        expiresAt: new Date("2026-07-21T00:00:00.000Z"),
        latitude: 33.6846,
        longitude: -117.8265,
      },
      {
        ...sharedListing,
        id: fixture.deletedId,
        title: "Nearby deleted fixture",
        slug: `deleted-${fixture.deletedId}`,
        status: ContentStatus.PUBLISHED,
        deletedAt: new Date("2026-07-22T00:00:00.000Z"),
        latitude: 33.6846,
        longitude: -117.8265,
      },
    ],
  });
  return fixture;
}

integration("ListingGeoRepository with PostgreSQL/PostGIS", () => {
  let database: IntegrationDatabase;

  beforeAll(() => {
    database = createIntegrationDatabase(databaseUrl);
  });

  afterAll(async () => {
    await database?.close();
  });

  it("keeps PostGIS and pg_trgm installation idempotent and usable", async () => {
    await database.withRollback(async (transaction) => {
      await transaction.$executeRawUnsafe('CREATE EXTENSION IF NOT EXISTS "postgis"');
      await transaction.$executeRawUnsafe('CREATE EXTENSION IF NOT EXISTS "pg_trgm"');
      await transaction.$executeRawUnsafe('CREATE EXTENSION IF NOT EXISTS "postgis"');
      await transaction.$executeRawUnsafe('CREATE EXTENSION IF NOT EXISTS "pg_trgm"');

      const extensions = await transaction.$queryRaw<Array<{ extname: string }>>`
        SELECT "extname"
        FROM "pg_extension"
        WHERE "extname" IN ('postgis', 'pg_trgm')
        ORDER BY "extname"
      `;
      const similarity = await transaction.$queryRaw<Array<{ score: number }>>`
        SELECT similarity('socal life', 'socal living')::double precision AS "score"
      `;

      expect(extensions.map(({ extname }) => extname)).toEqual(["pg_trgm", "postgis"]);
      expect(similarity[0]?.score).toBeGreaterThan(0);
    });
  });

  it("returns only public, current listings inside the radius", async () => {
    await database.withRollback(async (transaction) => {
      const fixture = await createGeoFixture(transaction);
      const repository = new ListingGeoRepository(transaction);
      const results = await repository.findPublishedWithinRadius({
        longitude: -117.8265,
        latitude: 33.6846,
        radiusMiles: 5,
        listingType: ListingType.RENTAL,
        limit: 10,
      });

      expect(results.map(({ id }) => id)).toEqual([
        fixture.nearbyFeaturedId,
        fixture.nearbyRegularId,
      ]);
      expect(results.every(({ distanceMiles }) => distanceMiles < 5)).toBe(true);
      expect(results[0]).not.toHaveProperty("latitude");
      expect(results[0]).not.toHaveProperty("longitude");
    });
  });

  it("recomputes the generated geography when coordinates change", async () => {
    await database.withRollback(async (transaction) => {
      const fixture = await createGeoFixture(transaction);
      const repository = new ListingGeoRepository(transaction);
      await transaction.listing.update({
        where: { id: fixture.nearbyFeaturedId },
        data: { latitude: 34.0522, longitude: -118.2437 },
      });

      const results = await repository.findPublishedWithinRadius({
        longitude: -117.8265,
        latitude: 33.6846,
        radiusMiles: 5,
        listingType: ListingType.RENTAL,
      });
      expect(results.map(({ id }) => id)).toEqual([fixture.nearbyRegularId]);
    });
  });
});
