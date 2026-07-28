import { CategoryFormSchemaRepository } from "../src/repositories/category-form-schema.repository";
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
const actorId = "73000000-0000-4000-8000-000000000001";

integration("CategoryFormSchemaRepository with PostgreSQL", () => {
  let database: IntegrationDatabase;
  let seed: Awaited<ReturnType<typeof loadSeedData>>;
  let categoryId: string;

  beforeAll(async () => {
    seed = await loadSeedData();
    categoryId = stableSeedUuid("category:SECONDHAND:secondhand");
    database = createIntegrationDatabase(databaseUrl);
  });

  afterAll(async () => {
    await database?.close();
  });

  it("persists draft revisions and atomically publishes the materialized current schema", async () => {
    await database.withRollback(async (transaction) => {
      await seedDatabaseInTransaction(transaction, seed);
      const repository = new CategoryFormSchemaRepository(transaction);
      const initial = await repository.getPublished({
        categoryId,
        version: 1,
        requireActiveCategory: true,
      });
      expect(initial).toMatchObject({
        categoryId,
        version: 1,
        revision: 1,
      });
      expect(initial?.publishedAt).toBeInstanceOf(Date);

      const definition = {
        categoryId,
        version: 2,
        fields: [
          {
            key: "condition",
            type: "SELECT",
            label: { "zh-Hans": "物品成色", "en-US": "Condition" },
            required: true,
            filterable: true,
            searchable: false,
            options: [
              { value: "new", label: { "zh-Hans": "全新", "en-US": "New" } },
              { value: "good", label: { "zh-Hans": "良好", "en-US": "Good" } },
            ],
            visibility: "PUBLIC",
            sortOrder: 10,
          },
        ],
      };
      const created = await repository.saveDraft({
        categoryId,
        expectedCurrentVersion: 1,
        definition,
        contentHash: "2".repeat(64),
        actorId,
      });
      expect(created).toMatchObject({ kind: "ok", schema: { version: 2, revision: 1 } });
      const stale = await repository.saveDraft({
        categoryId,
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
        categoryId,
        expectedCurrentVersion: 1,
        expectedDraftRevision: 1,
        actorId,
        fields: [
          {
            key: "condition",
            labelZhHans: "物品成色",
            labelEn: "Condition",
            fieldType: "SELECT",
            isRequired: true,
            isFilterable: true,
            isSearchable: false,
            visibility: "PUBLIC",
            options: definition.fields[0]?.options,
            sortOrder: 10,
          },
        ],
      });
      expect(published).toMatchObject({
        kind: "ok",
        schema: { version: 2, publishedById: actorId },
      });
      expect(published.kind === "ok" ? published.schema.publishedAt : null).toBeInstanceOf(Date);
      await expect(
        transaction.category.findUniqueOrThrow({
          where: { id: categoryId },
          select: { formSchemaVersion: true },
        }),
      ).resolves.toEqual({ formSchemaVersion: 2 });
      await expect(
        transaction.categoryField.findUniqueOrThrow({
          where: { categoryId_key: { categoryId, key: "condition" } },
          select: { isRequired: true, isSearchable: true, visibility: true },
        }),
      ).resolves.toEqual({
        isRequired: true,
        isSearchable: false,
        visibility: "PUBLIC",
      });

      const stalePublish = await repository.publishDraft({
        categoryId,
        expectedCurrentVersion: 1,
        expectedDraftRevision: 1,
        actorId,
        fields: [],
      });
      expect(stalePublish).toMatchObject({
        kind: "current_version_conflict",
        currentVersion: 2,
      });
    });
  });

  it("rolls back by appending a new version with explicit provenance", async () => {
    await database.withRollback(async (transaction) => {
      await seedDatabaseInTransaction(transaction, seed);
      const repository = new CategoryFormSchemaRepository(transaction);
      const versionOne = await repository.getPublished({
        categoryId,
        version: 1,
        requireActiveCategory: false,
      });
      if (!versionOne) throw new Error("Seed version one is missing");

      const definition = {
        ...(versionOne.definition as Record<string, unknown>),
        version: 2,
      };
      const draft = await repository.saveDraft({
        categoryId,
        expectedCurrentVersion: 1,
        definition,
        contentHash: "4".repeat(64),
        actorId,
      });
      if (draft.kind !== "ok") throw new Error(draft.kind);
      await repository.publishDraft({
        categoryId,
        expectedCurrentVersion: 1,
        expectedDraftRevision: draft.schema.revision,
        actorId,
        fields: [],
      });

      const rollbackDefinition = {
        ...(versionOne.definition as Record<string, unknown>),
        version: 3,
      };
      const rollback = await repository.rollback({
        categoryId,
        targetVersion: 1,
        expectedCurrentVersion: 2,
        definition: rollbackDefinition,
        contentHash: "5".repeat(64),
        actorId,
        fields: [],
      });
      expect(rollback).toMatchObject({
        kind: "ok",
        schema: { version: 3, basedOnVersion: 1 },
      });
      expect(rollback.kind === "ok" ? rollback.schema.publishedAt : null).toBeInstanceOf(Date);
      const historical = await repository.getPublished({
        categoryId,
        version: 1,
        requireActiveCategory: false,
      });
      expect(historical?.definition).toEqual(versionOne.definition);
    });
  });

  it("enforces published-row immutability in PostgreSQL, including direct adapter writes", async () => {
    await expect(
      database.withRollback(async (transaction) => {
        await seedDatabaseInTransaction(transaction, seed);
        await transaction.categoryFormSchemaVersion.update({
          where: { categoryId_version: { categoryId, version: 1 } },
          data: { contentHash: "f".repeat(64) },
        });
      }),
    ).rejects.toThrow(/immutable|published category form schema/i);
  });
});
