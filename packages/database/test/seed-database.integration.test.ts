import { loadSeedData } from "../src/seed/seed-data";
import { seedDatabaseInTransaction } from "../src/seed/seed-database";
import { stableSeedUuid } from "../src/seed/stable-id";
import {
  createIntegrationDatabase,
  type IntegrationDatabase,
} from "../src/testing/integration-database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const databaseUrl = process.env.DATABASE_INTEGRATION_URL ?? "";
const integration = describe.skipIf(databaseUrl.length === 0);

integration("idempotent database seed", () => {
  let database: IntegrationDatabase;
  let seed: Awaited<ReturnType<typeof loadSeedData>>;

  function listingIds(): string[] {
    return seed.listings.listings.map((listing, index) =>
      stableSeedUuid(`listing:${listing.type}:${index}`),
    );
  }

  function categoryIds(): string[] {
    return [
      ...seed.categories.verticals.flatMap((vertical) => [
        stableSeedUuid(`category:${vertical.type}:${vertical.slug}`),
        ...vertical.children.map((child) =>
          stableSeedUuid(`category:${vertical.type}:${vertical.slug}:${child.slug}`),
        ),
      ]),
      ...seed.categories.communityCategories.map((category) =>
        stableSeedUuid(`category:COMMUNITY:${category.slug}`),
      ),
    ];
  }

  function regionIds(): string[] {
    return [
      stableSeedUuid(`region:${seed.regions.country.code}`),
      stableSeedUuid(`region:${seed.regions.state.code}`),
      ...seed.regions.metros.flatMap((metro) => [
        stableSeedUuid(`region:${metro.code}`),
        ...metro.children.map((city) => stableSeedUuid(`region:${city.code}`)),
      ]),
    ];
  }

  function regionAliasCount(): number {
    return (
      seed.regions.country.aliases.length +
      seed.regions.state.aliases.length +
      seed.regions.metros.reduce(
        (total, metro) =>
          total +
          metro.aliases.length +
          metro.children.reduce((childTotal, city) => childTotal + city.aliases.length, 0),
        0,
      )
    );
  }

  function categoryAliasCount(): number {
    return (
      seed.categories.verticals.reduce(
        (total, vertical) =>
          total +
          vertical.aliases.length +
          vertical.children.reduce((childTotal, child) => childTotal + child.aliases.length, 0),
        0,
      ) +
      seed.categories.communityCategories.reduce(
        (total, category) => total + category.aliases.length,
        0,
      )
    );
  }

  function categoryFieldCount(): number {
    return seed.categories.verticals.reduce(
      (total, vertical) => total + (vertical.children.length + 1) * vertical.formFields.length,
      0,
    );
  }

  beforeAll(async () => {
    seed = await loadSeedData();
    database = createIntegrationDatabase(databaseUrl);
  });

  afterAll(async () => {
    await database?.close();
  });

  it("imports the same stable taxonomy and synthetic drafts twice without duplicates", async () => {
    await database.withRollback(async (transaction) => {
      const first = await seedDatabaseInTransaction(transaction, seed);
      const second = await seedDatabaseInTransaction(transaction, seed);

      expect(second).toEqual(first);
      expect(first).toMatchObject({
        regions: regionIds().length,
        regionAliases: regionAliasCount(),
        categories: categoryIds().length,
        categoryAliases: categoryAliasCount(),
        categoryFields: categoryFieldCount(),
        formSchemaVersions: categoryIds().length,
        homepageLayouts: 2,
        listings: listingIds().length,
        users: 1,
      });
      await expect(transaction.region.count({ where: { id: { in: regionIds() } } })).resolves.toBe(
        regionIds().length,
      );
      await expect(
        transaction.category.count({ where: { id: { in: categoryIds() } } }),
      ).resolves.toBe(categoryIds().length);
      await expect(
        transaction.regionAlias.count({ where: { regionId: { in: regionIds() } } }),
      ).resolves.toBe(regionAliasCount());
      await expect(
        transaction.categoryAlias.count({ where: { categoryId: { in: categoryIds() } } }),
      ).resolves.toBe(categoryAliasCount());
      await expect(
        transaction.categoryField.count({ where: { categoryId: { in: categoryIds() } } }),
      ).resolves.toBe(categoryFieldCount());
      await expect(
        transaction.categoryFormSchemaVersion.count({
          where: { categoryId: { in: categoryIds() }, version: 1, publishedAt: { not: null } },
        }),
      ).resolves.toBe(categoryIds().length);
      await expect(
        transaction.homepageLayoutVersion.count({
          where: { version: 1, publishedAt: { not: null } },
        }),
      ).resolves.toBe(2);
      await expect(
        transaction.homepageLayoutState.findMany({
          orderBy: { locale: "asc" },
          select: { locale: true, regionCode: true, currentVersion: true },
        }),
      ).resolves.toEqual([
        { locale: "en-US", regionCode: seed.homepage.regionCode, currentVersion: 1 },
        { locale: "zh-Hans", regionCode: seed.homepage.regionCode, currentVersion: 1 },
      ]);
      await expect(
        transaction.listing.count({ where: { id: { in: listingIds() } } }),
      ).resolves.toBe(listingIds().length);

      const listings = await transaction.listing.findMany({
        where: { id: { in: listingIds() } },
        select: {
          status: true,
          moderationStatus: true,
          title: true,
          formSchemaVersion: true,
          publishedAt: true,
        },
      });
      expect(listings).toHaveLength(5);
      expect(
        listings.every(
          (listing) =>
            listing.status === "DRAFT" &&
            listing.moderationStatus === "NOT_REVIEWED" &&
            listing.title.startsWith("[示例]") &&
            listing.formSchemaVersion === 1 &&
            listing.publishedAt === null,
        ),
      ).toBe(true);
    });
  });
});
