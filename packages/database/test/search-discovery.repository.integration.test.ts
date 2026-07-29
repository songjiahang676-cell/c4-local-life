import { SearchDiscoveryRepository } from "../src/repositories/search-discovery.repository";
import {
  createIntegrationDatabase,
  type IntegrationDatabase,
} from "../src/testing/integration-database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const databaseUrl = process.env.DATABASE_INTEGRATION_URL ?? "";
const integration = describe.skipIf(databaseUrl.length === 0);
const editorId = "74000000-0000-4000-8000-000000000001";
const reviewerId = "74000000-0000-4000-8000-000000000002";

integration("SearchDiscoveryRepository with PostgreSQL", () => {
  let database: IntegrationDatabase;

  beforeAll(() => {
    database = createIntegrationDatabase(databaseUrl);
  });

  afterAll(async () => {
    await database?.close();
  });

  it("publishes reviewed immutable dictionary versions and rolls back by appending", async () => {
    await database.withRollback(async (transaction) => {
      const repository = new SearchDiscoveryRepository(transaction);
      await expect(repository.getLifecycle()).resolves.toEqual({
        currentVersion: 0,
        draft: null,
        published: [],
      });

      const definition = {
        schemaVersion: 1,
        synonymGroups: [
          {
            key: "apartment-rental",
            locale: "en-US",
            canonical: "apartment",
            alternatives: ["apt"],
            regionCodes: [],
          },
        ],
        blockedTerms: [],
      };
      const draft = await repository.saveDraft({
        expectedCurrentVersion: 0,
        definition,
        contentHash: "a".repeat(64),
        actorId: editorId,
      });
      expect(draft).toMatchObject({
        kind: "ok",
        dictionary: { version: 1, revision: 1, publishedAt: null },
      });

      await expect(
        repository.publishDraft({
          expectedCurrentVersion: 0,
          expectedDraftRevision: 1,
          reviewerId: editorId,
        }),
      ).resolves.toEqual({ kind: "review_required" });

      const published = await repository.publishDraft({
        expectedCurrentVersion: 0,
        expectedDraftRevision: 1,
        reviewerId,
        publishedAt: new Date("2026-07-29T18:00:00.000Z"),
      });
      expect(published).toMatchObject({
        kind: "ok",
        dictionary: {
          version: 1,
          revision: 1,
          updatedById: editorId,
          publishedById: reviewerId,
        },
      });
      await expect(repository.getPublished()).resolves.toMatchObject({
        version: 1,
        definition,
      });

      const secondDraft = await repository.saveDraft({
        expectedCurrentVersion: 1,
        definition: { ...definition, blockedTerms: [{ term: "unsafe", reason: "SCAM" }] },
        contentHash: "b".repeat(64),
        actorId: editorId,
      });
      expect(secondDraft).toMatchObject({ kind: "ok", dictionary: { version: 2 } });
      if (secondDraft.kind !== "ok") throw new Error(secondDraft.kind);
      await repository.publishDraft({
        expectedCurrentVersion: 1,
        expectedDraftRevision: secondDraft.dictionary.revision,
        reviewerId,
      });

      const rollback = await repository.rollback({
        expectedCurrentVersion: 2,
        targetVersion: 1,
        actorId: editorId,
      });
      expect(rollback).toMatchObject({
        kind: "ok",
        dictionary: {
          version: 3,
          publishedAt: null,
          basedOnVersion: 1,
          contentHash: "a".repeat(64),
          definition,
        },
      });
      await expect(repository.getPublished()).resolves.toMatchObject({ version: 2 });
      await expect(
        repository.publishDraft({
          expectedCurrentVersion: 2,
          expectedDraftRevision: 1,
          reviewerId: editorId,
        }),
      ).resolves.toEqual({ kind: "review_required" });
      await expect(
        repository.publishDraft({
          expectedCurrentVersion: 2,
          expectedDraftRevision: 1,
          reviewerId,
          publishedAt: new Date("2026-07-29T19:00:00.000Z"),
        }),
      ).resolves.toMatchObject({
        kind: "ok",
        dictionary: {
          version: 3,
          basedOnVersion: 1,
          publishedById: reviewerId,
        },
      });
      await expect(repository.getPublished(1)).resolves.toMatchObject({
        version: 1,
        definition,
      });
    });
  });

  it("enforces published dictionary immutability below the adapter boundary", async () => {
    await expect(
      database.withRollback(async (transaction) => {
        const repository = new SearchDiscoveryRepository(transaction);
        const draft = await repository.saveDraft({
          expectedCurrentVersion: 0,
          definition: { schemaVersion: 1, synonymGroups: [], blockedTerms: [] },
          contentHash: "c".repeat(64),
          actorId: editorId,
        });
        if (draft.kind !== "ok") throw new Error(draft.kind);
        await repository.publishDraft({
          expectedCurrentVersion: 0,
          expectedDraftRevision: draft.dictionary.revision,
          reviewerId,
        });
        await transaction.searchDictionaryVersion.update({
          where: { id: draft.dictionary.id },
          data: { contentHash: "d".repeat(64) },
        });
      }),
    ).rejects.toThrow(/immutable|published search dictionary/i);
  });

  it("never returns fewer than five distinct sources and deduplicates each source per day", async () => {
    await database.withRollback(async (transaction) => {
      const repository = new SearchDiscoveryRepository(transaction);
      const now = new Date("2026-07-29T20:00:00.000Z");
      const queryHash = "e".repeat(64);
      for (let source = 1; source <= 4; source += 1) {
        await repository.recordQuerySample({
          queryHash,
          sourceHash: source.toString(16).padStart(64, "0"),
          queryText: "Irvine apartment",
          locale: "en-US",
          regionCode: "US-CA-ORANGE-IRVINE",
          createdAt: now,
          expiresAt: new Date("2026-08-28T20:00:00.000Z"),
        });
      }

      await expect(
        repository.findPrivacySafeQueries({
          locale: "en-US",
          regionCode: "US-CA-ORANGE-IRVINE",
          since: new Date("2026-07-22T20:00:00.000Z"),
          now,
          minimumSources: 1,
          limit: 10,
        }),
      ).resolves.toEqual([]);

      await expect(
        repository.recordQuerySample({
          queryHash,
          sourceHash: "1".padStart(64, "0"),
          queryText: "Irvine apartment",
          locale: "en-US",
          regionCode: "US-CA-ORANGE-IRVINE",
          createdAt: new Date("2026-07-29T21:00:00.000Z"),
          expiresAt: new Date("2026-08-28T21:00:00.000Z"),
        }),
      ).resolves.toBe("duplicate");

      await repository.recordQuerySample({
        queryHash,
        sourceHash: "5".padStart(64, "0"),
        queryText: "Irvine apartment",
        locale: "en-US",
        regionCode: "US-CA-ORANGE-IRVINE",
        createdAt: now,
        expiresAt: new Date("2026-08-28T20:00:00.000Z"),
      });
      await expect(
        repository.findPrivacySafeQueries({
          locale: "en-US",
          regionCode: "US-CA-ORANGE-IRVINE",
          prefix: "Irv",
          since: new Date("2026-07-22T20:00:00.000Z"),
          now,
          limit: 10,
        }),
      ).resolves.toEqual([
        {
          queryText: "Irvine apartment",
          sourceCount: 5,
          lastSeenAt: now,
        },
      ]);
    });
  });

  it("escapes literal suggestion prefixes and prunes expired samples in bounded batches", async () => {
    await database.withRollback(async (transaction) => {
      const repository = new SearchDiscoveryRepository(transaction);
      const now = new Date("2026-07-29T20:00:00.000Z");
      for (let source = 1; source <= 5; source += 1) {
        await repository.recordQuerySample({
          queryHash: "f".repeat(64),
          sourceHash: source.toString(16).padStart(64, "0"),
          queryText: "100% free listing",
          locale: "en-US",
          createdAt: new Date("2026-07-28T20:00:00.000Z"),
          expiresAt: new Date("2026-07-29T19:00:00.000Z"),
        });
      }
      await expect(
        repository.findPrivacySafeQueries({
          locale: "en-US",
          prefix: "100%",
          since: new Date("2026-07-22T20:00:00.000Z"),
          now,
          limit: 10,
        }),
      ).resolves.toEqual([]);
      await expect(repository.pruneExpiredSamples({ now, limit: 2 })).resolves.toBe(2);
      await expect(repository.pruneExpiredSamples({ now, limit: 10 })).resolves.toBe(3);
    });
  });

  it("rejects retention windows longer than ninety days in PostgreSQL", async () => {
    await expect(
      database.withRollback(async (transaction) => {
        const repository = new SearchDiscoveryRepository(transaction);
        await repository.recordQuerySample({
          queryHash: "1".repeat(64),
          sourceHash: "2".repeat(64),
          queryText: "synthetic query",
          locale: "en-US",
          createdAt: new Date("2026-07-29T20:00:00.000Z"),
          expiresAt: new Date("2026-10-28T20:00:01.000Z"),
        });
      }),
    ).rejects.toThrow(/retention|constraint/i);
  });
});
