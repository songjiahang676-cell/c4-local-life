import { HomepageLayoutRepository } from "../src/repositories/homepage-layout.repository";
import { loadSeedData } from "../src/seed/seed-data";
import { seedDatabaseInTransaction } from "../src/seed/seed-database";
import {
  createIntegrationDatabase,
  type IntegrationDatabase,
} from "../src/testing/integration-database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const databaseUrl = process.env.DATABASE_INTEGRATION_URL ?? "";
const integration = describe.skipIf(databaseUrl.length === 0);
const actorId = "75000000-0000-4000-8000-000000000001";

integration("HomepageLayoutRepository with PostgreSQL", () => {
  let database: IntegrationDatabase;
  let seed: Awaited<ReturnType<typeof loadSeedData>>;

  beforeAll(async () => {
    seed = await loadSeedData();
    database = createIntegrationDatabase(databaseUrl);
  });

  afterAll(async () => {
    await database?.close();
  });

  it("seeds both locales and atomically publishes a revision plus cache invalidation", async () => {
    await database.withRollback(async (transaction) => {
      await seedDatabaseInTransaction(transaction, seed);
      const repository = new HomepageLayoutRepository(transaction);
      const missingScopeRegion = "US-CA-NOT-SEEDED";
      await expect(
        repository.saveDraft({
          locale: "zh-Hans",
          regionCode: missingScopeRegion,
          expectedCurrentVersion: 9,
          definition: {
            ...seed.homepage,
            version: 10,
            regionCode: missingScopeRegion,
          },
          contentHash: "1".repeat(64),
          actorId,
        }),
      ).resolves.toEqual({
        kind: "current_version_conflict",
        currentVersion: 0,
      });
      await expect(
        transaction.homepageLayoutState.count({
          where: { locale: "zh-Hans", regionCode: missingScopeRegion },
        }),
      ).resolves.toBe(0);
      await expect(
        repository.getPublished({
          locale: "en-US",
          regionCode: seed.homepage.regionCode,
        }),
      ).resolves.toMatchObject({
        version: 1,
        definition: { locale: "en-US", version: 1 },
      });
      const definition = {
        ...seed.homepage,
        version: 2,
        slots: [
          ...seed.homepage.slots,
          {
            key: "public-portals",
            kind: "PORTAL_LINKS",
            enabled: true,
            source: { audience: "PUBLIC" },
            limit: 3,
            sponsoredDisclosure: false,
            cacheTtlSeconds: 300,
          },
        ],
      };
      const created = await repository.saveDraft({
        locale: "zh-Hans",
        regionCode: seed.homepage.regionCode,
        expectedCurrentVersion: 1,
        definition,
        contentHash: "2".repeat(64),
        actorId,
      });
      expect(created).toMatchObject({
        kind: "ok",
        layout: { version: 2, revision: 1 },
      });
      const stale = await repository.saveDraft({
        locale: "zh-Hans",
        regionCode: seed.homepage.regionCode,
        expectedCurrentVersion: 1,
        expectedDraftRevision: 8,
        definition,
        contentHash: "3".repeat(64),
        actorId,
      });
      expect(stale).toMatchObject({
        kind: "draft_revision_conflict",
        currentDraftRevision: 1,
      });
      const published = await repository.publishDraft({
        locale: "zh-Hans",
        regionCode: seed.homepage.regionCode,
        expectedCurrentVersion: 1,
        expectedDraftRevision: 1,
        actorId,
        publishedAt: new Date("2026-02-01T00:00:00.000Z"),
      });
      expect(published).toMatchObject({
        kind: "ok",
        scope: { currentVersion: 2 },
        layout: { version: 2, publishedById: actorId },
      });
      await expect(
        transaction.outboxEvent.findFirstOrThrow({
          where: { eventType: "homepage.layout.published" },
          select: { aggregateType: true, aggregateId: true, payload: true },
        }),
      ).resolves.toMatchObject({
        aggregateType: "HOMEPAGE_LAYOUT",
        aggregateId: published.kind === "ok" ? published.scope.id : "unexpected-mutation-result",
        payload: {
          schemaVersion: 1,
          locale: "zh-Hans",
          regionCode: seed.homepage.regionCode,
          version: 2,
          operation: "publish",
        },
      });
      const historical = await repository.getPublished({
        locale: "zh-Hans",
        regionCode: seed.homepage.regionCode,
        version: 1,
      });
      expect(historical?.version).toBe(1);
      expect(historical?.publishedAt).toBeInstanceOf(Date);
    });
  });

  it("rolls back as a new immutable version and emits a second bounded event", async () => {
    await database.withRollback(async (transaction) => {
      await seedDatabaseInTransaction(transaction, seed);
      const repository = new HomepageLayoutRepository(transaction);
      const first = await repository.getPublished({
        locale: "zh-Hans",
        regionCode: seed.homepage.regionCode,
        version: 1,
      });
      if (!first) throw new Error("Seed homepage layout is missing");
      const versionTwo = {
        ...(first.definition as Record<string, unknown>),
        version: 2,
        slots: [],
      };
      const draft = await repository.saveDraft({
        locale: "zh-Hans",
        regionCode: seed.homepage.regionCode,
        expectedCurrentVersion: 1,
        definition: versionTwo,
        contentHash: "4".repeat(64),
        actorId,
      });
      if (draft.kind !== "ok") throw new Error(draft.kind);
      await repository.publishDraft({
        locale: "zh-Hans",
        regionCode: seed.homepage.regionCode,
        expectedCurrentVersion: 1,
        expectedDraftRevision: draft.layout.revision,
        actorId,
      });
      const rollbackDefinition = {
        ...(first.definition as Record<string, unknown>),
        version: 3,
      };
      const rollback = await repository.rollback({
        locale: "zh-Hans",
        regionCode: seed.homepage.regionCode,
        targetVersion: 1,
        expectedCurrentVersion: 2,
        definition: rollbackDefinition,
        contentHash: "5".repeat(64),
        actorId,
        publishedAt: new Date("2026-02-02T00:00:00.000Z"),
      });
      expect(rollback).toMatchObject({
        kind: "ok",
        scope: { currentVersion: 3 },
        layout: { version: 3, basedOnVersion: 1 },
      });
      const events = await transaction.outboxEvent.findMany({
        where: { eventType: "homepage.layout.published" },
        orderBy: { createdAt: "asc" },
        select: { payload: true },
      });
      expect(events).toHaveLength(2);
      expect(events[0]?.payload).toMatchObject({ version: 2, operation: "publish" });
      expect(events[1]?.payload).toMatchObject({
        version: 3,
        operation: "rollback",
        basedOnVersion: 1,
      });
      expect(
        (
          await repository.getPublished({
            locale: "zh-Hans",
            regionCode: seed.homepage.regionCode,
          })
        )?.definition,
      ).toEqual(rollbackDefinition);
    });
  });

  it("enforces published-row immutability for direct adapter writes", async () => {
    await expect(
      database.withRollback(async (transaction) => {
        await seedDatabaseInTransaction(transaction, seed);
        const state = await transaction.homepageLayoutState.findUniqueOrThrow({
          where: {
            locale_regionCode: {
              locale: "zh-Hans",
              regionCode: seed.homepage.regionCode,
            },
          },
          select: { id: true },
        });
        await transaction.homepageLayoutVersion.update({
          where: { layoutId_version: { layoutId: state.id, version: 1 } },
          data: { contentHash: "f".repeat(64) },
        });
      }),
    ).rejects.toThrow(/immutable|published homepage layout/i);
  });
});
