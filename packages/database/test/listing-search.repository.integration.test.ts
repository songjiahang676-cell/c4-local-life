import { randomUUID } from "node:crypto";
import {
  ContentStatus,
  ListingType,
  ModerationStatus,
  RegionType,
} from "../generated/prisma/client";
import { ListingSearchRepository } from "../src/repositories/listing-search.repository";
import {
  createIntegrationDatabase,
  type IntegrationDatabase,
} from "../src/testing/integration-database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const databaseUrl = process.env.DATABASE_INTEGRATION_URL ?? "";
const integration = describe.skipIf(databaseUrl.length === 0);

integration("ListingSearchRepository with PostgreSQL", () => {
  let database: IntegrationDatabase;

  beforeAll(() => {
    database = createIntegrationDatabase(databaseUrl);
  });

  afterAll(async () => {
    await database?.close();
  });

  it("loads only the current authorized public projection and converts exact geo to city precision", async () => {
    const ownerId = randomUUID();
    const parentCategoryId = randomUUID();
    const categoryId = randomUUID();
    const parentRegionId = randomUUID();
    const regionId = randomUUID();
    const listingId = randomUUID();
    const now = new Date("2026-07-29T18:00:00.000Z");
    const repository = new ListingSearchRepository(database.client);
    try {
      await database.client.user.create({
        data: {
          id: ownerId,
          email: `${ownerId}@example.invalid`,
          profile: {
            create: {
              displayName: "Synthetic Public Publisher",
              avatarUrl: "https://cdn.example.invalid/public-avatar.webp",
            },
          },
        },
      });
      await database.client.region.create({
        data: {
          id: parentRegionId,
          type: RegionType.COUNTY,
          code: `SEARCH-COUNTY-${parentRegionId}`,
          slug: `search-county-${parentRegionId}`,
          nameZhHans: "测试县",
          nameEn: "Synthetic County",
        },
      });
      await database.client.region.create({
        data: {
          id: regionId,
          parentId: parentRegionId,
          type: RegionType.CITY,
          code: `SEARCH-CITY-${regionId}`,
          slug: `search-city-${regionId}`,
          nameZhHans: "测试城",
          nameEn: "Synthetic City",
          latitude: "34.123400",
          longitude: "-118.432100",
          aliases: {
            create: {
              locale: "zh-Hans",
              value: "测试城市别名",
              normalizedValue: "测试城市别名",
            },
          },
        },
      });
      await database.client.category.create({
        data: {
          id: parentCategoryId,
          slug: `search-parent-${parentCategoryId}`,
          nameZhHans: "测试父分类",
          nameEn: "Synthetic Parent",
        },
      });
      await database.client.category.create({
        data: {
          id: categoryId,
          parentId: parentCategoryId,
          vertical: ListingType.RENTAL,
          slug: `search-child-${categoryId}`,
          nameZhHans: "测试租房",
          nameEn: "Synthetic Rentals",
          aliases: {
            create: {
              locale: "en-US",
              value: "Synthetic apartment",
              normalizedValue: "synthetic apartment",
            },
          },
          formSchemaVersions: {
            create: {
              version: 1,
              definition: {
                categoryId,
                version: 1,
                fields: [
                  { key: "bedrooms", visibility: "PUBLIC" },
                  { key: "privateContact", visibility: "OWNER_ONLY" },
                ],
              },
              contentHash: "1".repeat(64),
              publishedAt: new Date("2026-07-01T00:00:00.000Z"),
            },
          },
        },
      });
      await database.client.listing.create({
        data: {
          id: listingId,
          type: ListingType.RENTAL,
          ownerId,
          categoryId,
          regionId,
          status: ContentStatus.PUBLISHED,
          moderationStatus: ModerationStatus.APPROVED,
          locale: "zh-Hans",
          title: "Synthetic searchable rental",
          slug: `synthetic-search-${listingId}`,
          summary: "Public synthetic summary",
          body: "Public synthetic body",
          priceAmount: "3250.00",
          currency: "USD",
          priceUnit: "MONTHLY",
          locationPrecision: "EXACT",
          latitude: "33.684600",
          longitude: "-117.826500",
          attributes: {
            bedrooms: 2,
            privateContact: "private-listing@example.invalid",
            injectedUnknown: "must-not-index",
          },
          qualityScore: 0.75,
          publishedAt: new Date("2026-07-20T00:00:00.000Z"),
          expiresAt: new Date("2026-08-20T00:00:00.000Z"),
          version: 4,
        },
      });

      const publicRecord = await repository.findById(listingId, now);
      expect(publicRecord).toMatchObject({
        id: listingId,
        version: 4,
        projection: {
          attributes: { bedrooms: 2 },
          category: {
            path: [`search-parent-${parentCategoryId}`, `search-child-${categoryId}`],
            aliases: ["Synthetic apartment"],
          },
          region: {
            path: [`search-county-${parentRegionId}`, `search-city-${regionId}`],
            aliases: ["测试城市别名"],
          },
          location: {
            precision: "CITY",
            latitude: 34.1234,
            longitude: -118.4321,
          },
        },
      });
      expect(JSON.stringify(publicRecord)).not.toContain("private-listing@example.invalid");
      expect(JSON.stringify(publicRecord)).not.toContain("must-not-index");
      expect(JSON.stringify(publicRecord)).not.toContain("33.6846");
      expect(JSON.stringify(publicRecord)).not.toContain("-117.8265");

      await database.client.listing.update({
        where: { id: listingId },
        data: { status: ContentStatus.ARCHIVED, version: 5 },
      });
      await expect(repository.findById(listingId, now)).resolves.toEqual({
        id: listingId,
        version: 5,
        projection: null,
      });
      const states = await repository.listStates({ limit: 1_000, now });
      expect(states.items).toContainEqual({ id: listingId, version: 5, shouldIndex: false });
    } finally {
      await database.client.listing.deleteMany({ where: { id: listingId } });
      await database.client.categoryFormSchemaVersion.deleteMany({ where: { categoryId } });
      await database.client.category.deleteMany({
        where: { id: { in: [categoryId, parentCategoryId] } },
      });
      await database.client.region.deleteMany({
        where: { id: { in: [regionId, parentRegionId] } },
      });
      await database.client.user.deleteMany({ where: { id: ownerId } });
    }
  });
});
