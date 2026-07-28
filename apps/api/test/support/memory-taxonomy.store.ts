import { randomUUID } from "node:crypto";
import { normalizeTaxonomyAlias } from "@socal/database/taxonomy";
import type {
  CategoryFormSchemaLifecycleRecord,
  CategoryFormSchemaVersionRecord,
  CategoryTaxonomyRecord,
  FormSchemaMutationResult,
  ListCategoryTaxonomyInput,
  ListRegionTaxonomyInput,
  PublishFormSchemaDraftInput,
  RegionTaxonomyRecord,
  RollbackFormSchemaInput,
  SaveFormSchemaDraftInput,
  TaxonomyStore,
} from "../../src/modules/taxonomy/taxonomy.store";

function matchesQuery(
  query: string,
  values: readonly string[],
  aliases: RegionTaxonomyRecord["aliases"],
): boolean {
  const normalizedQuery = normalizeTaxonomyAlias(query);
  const loweredQuery = query.toLocaleLowerCase("en-US");
  return (
    values.some((value) => value.toLocaleLowerCase("en-US").includes(loweredQuery)) ||
    aliases.some((alias) => normalizeTaxonomyAlias(alias.value).startsWith(normalizedQuery))
  );
}

export class MemoryTaxonomyStore implements TaxonomyStore {
  readonly categories: CategoryTaxonomyRecord[];
  readonly formSchemas: CategoryFormSchemaVersionRecord[];

  constructor(
    readonly regions: readonly RegionTaxonomyRecord[] = [],
    categories: readonly CategoryTaxonomyRecord[] = [],
    formSchemas: readonly CategoryFormSchemaVersionRecord[] = [],
  ) {
    this.categories = categories.map((category) => ({
      ...category,
      aliases: [...category.aliases],
    }));
    this.formSchemas = formSchemas.map((schema) => ({
      ...schema,
      definition: structuredClone(schema.definition),
    }));
  }

  listRegions(input: ListRegionTaxonomyInput): Promise<RegionTaxonomyRecord[]> {
    const parentId = input.parentCode
      ? this.regions.find((region) => region.code === input.parentCode)?.id
      : undefined;
    return Promise.resolve(
      this.regions
        .filter((region) => !input.activeOnly || region.isActive)
        .filter((region) => !input.type || region.type === input.type)
        .filter((region) => !input.parentCode || region.parentId === parentId)
        .filter(
          (region) =>
            !input.query ||
            matchesQuery(
              input.query,
              [region.code, region.slug, region.nameZhHans, region.nameEn],
              region.aliases,
            ),
        )
        .map((region) => ({ ...region, aliases: [...region.aliases] })),
    );
  }

  listCategories(input: ListCategoryTaxonomyInput): Promise<CategoryTaxonomyRecord[]> {
    return Promise.resolve(
      this.categories
        .filter((category) => !input.activeOnly || category.isActive)
        .filter((category) => !input.vertical || category.vertical === input.vertical)
        .filter((category) => !input.parentId || category.parentId === input.parentId)
        .filter(
          (category) =>
            !input.query ||
            matchesQuery(
              input.query,
              [category.slug, category.nameZhHans, category.nameEn],
              category.aliases,
            ),
        )
        .map((category) => ({ ...category, aliases: [...category.aliases] })),
    );
  }

  getPublishedFormSchema(input: {
    categoryId: string;
    version?: number;
    publicOnly: boolean;
  }): Promise<CategoryFormSchemaVersionRecord | null> {
    const category = this.categories.find(
      (candidate) => candidate.id === input.categoryId && (!input.publicOnly || candidate.isActive),
    );
    if (!category) return Promise.resolve(null);
    const schema = this.formSchemas.find(
      (candidate) =>
        candidate.categoryId === input.categoryId &&
        candidate.version === (input.version ?? category.formSchemaVersion) &&
        candidate.publishedAt !== null,
    );
    return Promise.resolve(schema ? structuredClone(schema) : null);
  }

  getFormSchemaLifecycle(categoryId: string): Promise<CategoryFormSchemaLifecycleRecord | null> {
    const category = this.categories.find((candidate) => candidate.id === categoryId);
    if (!category) return Promise.resolve(null);
    const versions = this.formSchemas
      .filter((schema) => schema.categoryId === categoryId)
      .sort((left, right) => left.version - right.version);
    return Promise.resolve({
      categoryId,
      currentVersion: category.formSchemaVersion,
      active: category.isActive,
      draft: structuredClone(versions.find((schema) => schema.publishedAt === null) ?? null),
      published: structuredClone(versions.filter((schema) => schema.publishedAt !== null)),
    });
  }

  saveFormSchemaDraft(input: SaveFormSchemaDraftInput): Promise<FormSchemaMutationResult> {
    const category = this.categories.find((candidate) => candidate.id === input.categoryId);
    if (!category) return Promise.resolve({ kind: "category_not_found" });
    if (category.formSchemaVersion !== input.expectedCurrentVersion) {
      return Promise.resolve({
        kind: "current_version_conflict",
        currentVersion: category.formSchemaVersion,
      });
    }
    const existing = this.formSchemas.find(
      (schema) => schema.categoryId === input.categoryId && schema.publishedAt === null,
    );
    const now = new Date();
    if (existing) {
      if (
        existing.version !== category.formSchemaVersion + 1 ||
        input.expectedDraftRevision === undefined ||
        existing.revision !== input.expectedDraftRevision
      ) {
        return Promise.resolve({
          kind: "draft_revision_conflict",
          currentDraftRevision: existing.revision,
        });
      }
      existing.definition = structuredClone(input.definition);
      existing.contentHash = input.contentHash;
      existing.revision += 1;
      existing.updatedById = input.actorId;
      existing.updatedAt = now;
      return Promise.resolve({ kind: "ok", schema: structuredClone(existing) });
    }
    if (input.expectedDraftRevision !== undefined) {
      return Promise.resolve({ kind: "draft_revision_conflict" });
    }
    const created: CategoryFormSchemaVersionRecord = {
      id: randomUUID(),
      categoryId: input.categoryId,
      version: category.formSchemaVersion + 1,
      revision: 1,
      definition: structuredClone(input.definition),
      contentHash: input.contentHash,
      basedOnVersion: null,
      createdById: input.actorId,
      updatedById: input.actorId,
      publishedById: null,
      createdAt: now,
      updatedAt: now,
      publishedAt: null,
    };
    this.formSchemas.push(created);
    return Promise.resolve({ kind: "ok", schema: structuredClone(created) });
  }

  publishFormSchemaDraft(input: PublishFormSchemaDraftInput): Promise<FormSchemaMutationResult> {
    const category = this.categories.find((candidate) => candidate.id === input.categoryId);
    if (!category) return Promise.resolve({ kind: "category_not_found" });
    if (category.formSchemaVersion !== input.expectedCurrentVersion) {
      return Promise.resolve({
        kind: "current_version_conflict",
        currentVersion: category.formSchemaVersion,
      });
    }
    const draft = this.formSchemas.find(
      (schema) => schema.categoryId === input.categoryId && schema.publishedAt === null,
    );
    if (!draft || draft.version !== category.formSchemaVersion + 1) {
      return Promise.resolve({ kind: "draft_missing" });
    }
    if (draft.revision !== input.expectedDraftRevision) {
      return Promise.resolve({
        kind: "draft_revision_conflict",
        currentDraftRevision: draft.revision,
      });
    }
    const now = new Date();
    draft.publishedAt = now;
    draft.publishedById = input.actorId;
    draft.updatedById = input.actorId;
    draft.updatedAt = now;
    category.formSchemaVersion = draft.version;
    return Promise.resolve({ kind: "ok", schema: structuredClone(draft) });
  }

  rollbackFormSchema(input: RollbackFormSchemaInput): Promise<FormSchemaMutationResult> {
    const category = this.categories.find((candidate) => candidate.id === input.categoryId);
    if (!category) return Promise.resolve({ kind: "category_not_found" });
    if (category.formSchemaVersion !== input.expectedCurrentVersion) {
      return Promise.resolve({
        kind: "current_version_conflict",
        currentVersion: category.formSchemaVersion,
      });
    }
    const target = this.formSchemas.find(
      (schema) =>
        schema.categoryId === input.categoryId &&
        schema.version === input.targetVersion &&
        schema.publishedAt !== null,
    );
    if (!target) return Promise.resolve({ kind: "target_missing" });
    const draft = this.formSchemas.find(
      (schema) => schema.categoryId === input.categoryId && schema.publishedAt === null,
    );
    if (draft) {
      return Promise.resolve({
        kind: "draft_revision_conflict",
        currentDraftRevision: draft.revision,
      });
    }
    const now = new Date();
    const created: CategoryFormSchemaVersionRecord = {
      id: randomUUID(),
      categoryId: input.categoryId,
      version: category.formSchemaVersion + 1,
      revision: 1,
      definition: structuredClone(input.definition),
      contentHash: input.contentHash,
      basedOnVersion: input.targetVersion,
      createdById: input.actorId,
      updatedById: input.actorId,
      publishedById: input.actorId,
      createdAt: now,
      updatedAt: now,
      publishedAt: now,
    };
    this.formSchemas.push(created);
    category.formSchemaVersion = created.version;
    return Promise.resolve({ kind: "ok", schema: structuredClone(created) });
  }
}
