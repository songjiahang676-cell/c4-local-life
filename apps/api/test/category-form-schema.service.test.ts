import type { CategoryFormSchema, FormField } from "@socal/contracts";
import type { CategoryTaxonomyRecord } from "@socal/database/taxonomy";
import { describe, expect, it } from "vitest";
import {
  CategoryFormSchemaCompatibilityError,
  CategoryFormSchemaConflictError,
  TaxonomyService,
} from "../src/modules/taxonomy/taxonomy.service";
import type { CategoryFormSchemaVersionRecord } from "../src/modules/taxonomy/taxonomy.store";
import { MemoryTaxonomyStore } from "./support/memory-taxonomy.store";

const categoryId = "71000000-0000-4000-8000-000000000001";
const actorId = "71000000-0000-4000-8000-000000000002";
const category: CategoryTaxonomyRecord = {
  id: categoryId,
  parentId: null,
  vertical: "SECONDHAND",
  slug: "secondhand",
  nameZhHans: "二手物品",
  nameEn: "Marketplace",
  iconKey: null,
  formSchemaVersion: 1,
  isActive: true,
  sortOrder: 0,
  aliases: [],
};
const conditionField: FormField = {
  key: "condition",
  type: "SELECT",
  label: { "zh-Hans": "成色", "en-US": "Condition" },
  required: false,
  filterable: true,
  searchable: false,
  visibility: "PUBLIC",
  sortOrder: 10,
  options: [
    { value: "new", label: { "zh-Hans": "全新", "en-US": "New" } },
    { value: "good", label: { "zh-Hans": "良好", "en-US": "Good" } },
  ],
};
const versionOne: CategoryFormSchema = {
  categoryId,
  version: 1,
  fields: [conditionField],
  publicationPolicy: {
    defaultLifetimeDays: 45,
    maxMedia: 20,
    allowExactAddress: false,
  },
};

function publishedRecord(
  definition: CategoryFormSchema = versionOne,
): CategoryFormSchemaVersionRecord {
  const timestamp = new Date("2026-01-01T00:00:00.000Z");
  return {
    id: "71000000-0000-4000-8000-000000000003",
    categoryId,
    version: definition.version,
    revision: 1,
    definition,
    contentHash: "1".repeat(64),
    basedOnVersion: null,
    createdById: actorId,
    updatedById: actorId,
    publishedById: actorId,
    createdAt: timestamp,
    updatedAt: timestamp,
    publishedAt: timestamp,
  };
}

function createService(): {
  service: TaxonomyService;
  store: MemoryTaxonomyStore;
} {
  const store = new MemoryTaxonomyStore([], [category], [publishedRecord()]);
  return { service: new TaxonomyService(store), store };
}

describe("category form schema lifecycle", () => {
  it("drafts, previews and publishes with optimistic revisions while old drafts keep validating", async () => {
    const { service } = createService();
    const serialNumber: FormField = {
      key: "serialNumber",
      type: "TEXT",
      label: { "zh-Hans": "序列号", "en-US": "Serial number" },
      required: true,
      filterable: false,
      searchable: false,
      visibility: "OWNER_ONLY",
      sortOrder: 20,
      validation: { minLength: 2, maxLength: 80 },
    };

    const created = await service.saveFormSchemaDraft({
      categoryId,
      expectedCurrentVersion: 1,
      fields: [conditionField, serialNumber],
      actorId,
    });
    expect(created).toMatchObject({ revision: 1, definition: { version: 2 } });
    expect(created.contentHash).toMatch(/^[0-9a-f]{64}$/);

    await expect(
      service.saveFormSchemaDraft({
        categoryId,
        expectedCurrentVersion: 1,
        expectedDraftRevision: 99,
        fields: [conditionField, serialNumber],
        actorId,
      }),
    ).rejects.toBeInstanceOf(CategoryFormSchemaConflictError);

    const updated = await service.saveFormSchemaDraft({
      categoryId,
      expectedCurrentVersion: 1,
      expectedDraftRevision: 1,
      fields: [conditionField, serialNumber],
      publicationPolicy: { defaultLifetimeDays: 30, maxMedia: 10 },
      actorId,
    });
    expect(updated.revision).toBe(2);
    await expect(service.previewFormSchemaDraft(categoryId)).resolves.toEqual(updated);

    const published = await service.publishFormSchemaDraft({
      categoryId,
      expectedCurrentVersion: 1,
      expectedDraftRevision: 2,
      actorId,
    });
    expect(published.definition.version).toBe(2);
    await expect(service.previewFormSchemaDraft(categoryId)).rejects.toThrow(
      "Category form schema not found",
    );

    await expect(service.validateAttributes(categoryId, 1, { condition: "good" })).resolves.toEqual(
      { valid: true, errors: {} },
    );
    await expect(service.validateAttributes(categoryId, 2, { condition: "good" })).resolves.toEqual(
      {
        valid: false,
        errors: { serialNumber: ["field is required"] },
      },
    );
    await expect(
      service.validateAttributes(categoryId, 2, {
        condition: "unknown",
        serialNumber: " ",
        injected: true,
      }),
    ).resolves.toEqual({
      valid: false,
      errors: {
        injected: ["field is not present in this version"],
        condition: ["must be one of the published options"],
        serialNumber: ["field is required"],
      },
    });
  });

  it("rejects reuse of a historical key with a different type", async () => {
    const { service } = createService();
    await service.saveFormSchemaDraft({
      categoryId,
      expectedCurrentVersion: 1,
      fields: [{ ...conditionField, type: "NUMBER", options: undefined }],
      actorId,
    });

    await expect(
      service.publishFormSchemaDraft({
        categoryId,
        expectedCurrentVersion: 1,
        expectedDraftRevision: 1,
        actorId,
      }),
    ).rejects.toBeInstanceOf(CategoryFormSchemaCompatibilityError);
  });

  it("rolls back by publishing a new immutable version instead of moving the pointer backward", async () => {
    const { service, store } = createService();
    await service.saveFormSchemaDraft({
      categoryId,
      expectedCurrentVersion: 1,
      fields: [{ ...conditionField, required: true }],
      actorId,
    });
    await service.publishFormSchemaDraft({
      categoryId,
      expectedCurrentVersion: 1,
      expectedDraftRevision: 1,
      actorId,
    });

    const rollback = await service.rollbackFormSchema({
      categoryId,
      targetVersion: 1,
      expectedCurrentVersion: 2,
      actorId,
    });

    expect(rollback.definition).toEqual({ ...versionOne, version: 3 });
    expect(store.categories[0]?.formSchemaVersion).toBe(3);
    const rollbackRecord = store.formSchemas.find((schema) => schema.version === 3);
    expect(rollbackRecord).toMatchObject({ basedOnVersion: 1 });
    expect(rollbackRecord?.publishedAt).toBeInstanceOf(Date);
    expect(store.formSchemas.find((schema) => schema.version === 1)?.definition).toEqual(
      versionOne,
    );
  });
});
