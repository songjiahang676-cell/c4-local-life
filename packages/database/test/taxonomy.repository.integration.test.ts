import { TaxonomyRepository } from "../src/repositories/taxonomy.repository";
import { loadSeedData } from "../src/seed/seed-data";
import { seedDatabaseInTransaction } from "../src/seed/seed-database";
import {
  createIntegrationDatabase,
  type IntegrationDatabase,
} from "../src/testing/integration-database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const databaseUrl = process.env.DATABASE_INTEGRATION_URL ?? "";
const integration = describe.skipIf(databaseUrl.length === 0);

integration("TaxonomyRepository with PostgreSQL", () => {
  let database: IntegrationDatabase;
  let seed: Awaited<ReturnType<typeof loadSeedData>>;

  beforeAll(async () => {
    seed = await loadSeedData();
    database = createIntegrationDatabase(databaseUrl);
  });

  afterAll(async () => {
    await database?.close();
  });

  it("reads stable bilingual region hierarchy and resolves normalized aliases", async () => {
    await database.withRollback(async (transaction) => {
      await seedDatabaseInTransaction(transaction, seed);
      const repository = new TaxonomyRepository(transaction);

      const all = await repository.listRegions({ activeOnly: true });
      const children = await repository.listRegions({
        activeOnly: true,
        parentCode: "US-CA-SOCAL",
      });
      const la = await repository.listRegions({ activeOnly: true, query: "L.A." });
      const montereyPark = await repository.listRegions({ activeOnly: true, query: "MPK" });
      const traditional = await repository.listRegions({ activeOnly: true, query: "洛杉磯" });
      const seededCodes = new Set([
        seed.regions.country.code,
        seed.regions.state.code,
        ...seed.regions.metros.flatMap((metro) => [
          metro.code,
          ...metro.children.map((city) => city.code),
        ]),
      ]);
      const seededRegions = all.filter((region) => seededCodes.has(region.code));

      expect(seededRegions).toHaveLength(17);
      expect(seededRegions.find((region) => region.code === "US-CA-SOCAL")).toMatchObject({
        type: "REGION_GROUP",
        nameZhHans: "南加州",
        nameEn: "Southern California",
      });
      expect(children).toHaveLength(14);
      expect(children.every((region) => region.type === "CITY")).toBe(true);
      expect(la.map((region) => region.code)).toContain("US-CA-LA");
      expect(montereyPark.map((region) => region.code)).toEqual(["US-CA-MONTEREY-PARK"]);
      expect(traditional.map((region) => region.code)).toEqual(["US-CA-LA"]);
      expect(JSON.stringify([all, la])).not.toContain("normalizedValue");
    });
  });

  it("filters active/type/category hierarchy and category aliases without leaking inactive rows", async () => {
    await database.withRollback(async (transaction) => {
      await seedDatabaseInTransaction(transaction, seed);
      const repository = new TaxonomyRepository(transaction);
      const irvine = await transaction.region.findUniqueOrThrow({
        where: { code: "US-CA-IRVINE" },
        select: { id: true },
      });
      await transaction.region.update({ where: { id: irvine.id }, data: { isActive: false } });

      const activeCities = await repository.listRegions({
        activeOnly: true,
        type: "CITY",
      });
      const allCities = await repository.listRegions({
        activeOnly: false,
        type: "CITY",
      });
      const services = await repository.listCategories({
        activeOnly: true,
        vertical: "SERVICE",
      });
      const serviceAlias = await repository.listCategories({
        activeOnly: true,
        query: "找师傅",
      });
      const serviceRoot = services.find((category) => category.parentId === null);
      const serviceChildren = await repository.listCategories({
        activeOnly: true,
        parentId: serviceRoot?.id,
      });

      expect(activeCities.some((region) => region.code === "US-CA-IRVINE")).toBe(false);
      expect(allCities.some((region) => region.code === "US-CA-IRVINE")).toBe(true);
      expect(services).toHaveLength(12);
      expect(serviceAlias.map((category) => category.slug)).toEqual(["services"]);
      expect(serviceChildren).toHaveLength(11);
      expect(serviceChildren.every((category) => category.parentId === serviceRoot?.id)).toBe(true);
    });
  });

  it("parameterizes hostile query text and returns no accidental broad match", async () => {
    await database.withRollback(async (transaction) => {
      await seedDatabaseInTransaction(transaction, seed);
      const repository = new TaxonomyRepository(transaction);

      await expect(
        repository.listRegions({ activeOnly: true, query: "' OR 1=1 --" }),
      ).resolves.toEqual([]);
      await expect(
        repository.listCategories({ activeOnly: true, query: "%' UNION SELECT" }),
      ).resolves.toEqual([]);
    });
  });
});
