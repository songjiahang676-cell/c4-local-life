import { createHash } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type {
  Category,
  CategoryCollectionResponse,
  CategoryFormSchema,
  FormField,
  FormPublicationPolicy,
  GetCategoryFormSchemaQuery,
  ListCategoriesQuery,
  ListRegionsQuery,
  Region,
  RegionCollectionResponse,
} from "@socal/contracts";
import { categoryFormSchemaSchema } from "@socal/contracts";
import {
  TAXONOMY_STORE,
  type CategoryFormSchemaVersionRecord,
  type CategoryTaxonomyRecord,
  type RegionTaxonomyRecord,
  type TaxonomyStore,
} from "./taxonomy.store";

export class CategoryFormSchemaNotFoundError extends Error {
  constructor() {
    super("Category form schema not found");
    this.name = "CategoryFormSchemaNotFoundError";
  }
}

export class CategoryFormSchemaConflictError extends Error {
  constructor(
    readonly reason: string,
    readonly currentVersion?: number,
    readonly currentDraftRevision?: number,
  ) {
    super("Category form schema changed concurrently");
    this.name = "CategoryFormSchemaConflictError";
  }
}

export class CategoryFormSchemaCompatibilityError extends Error {
  constructor(readonly fieldKey: string) {
    super(`Published field type cannot change for ${fieldKey}`);
    this.name = "CategoryFormSchemaCompatibilityError";
  }
}

export type CategoryFormSchemaDraftInput = {
  categoryId: string;
  expectedCurrentVersion: number;
  expectedDraftRevision?: number;
  fields: readonly FormField[];
  publicationPolicy?: FormPublicationPolicy;
  actorId: string;
};

export type CategoryFormSchemaPreview = {
  definition: CategoryFormSchema;
  revision: number;
  contentHash: string;
};

export type CategoryFormSchemaAttributeValidation = {
  valid: boolean;
  errors: Record<string, string[]>;
};

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

function contentHash(definition: CategoryFormSchema): string {
  return createHash("sha256").update(canonicalJson(definition), "utf8").digest("hex");
}

function cloneDefinitionForVersion(
  definition: CategoryFormSchema,
  version: number,
): CategoryFormSchema {
  return categoryFormSchemaSchema.parse({
    ...definition,
    version,
  });
}

function addAttributeError(errors: Record<string, string[]>, field: string, message: string): void {
  (errors[field] ??= []).push(message);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 0));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() + 1 === month &&
    parsed.getUTCDate() === day
  );
}

function validateFieldValue(field: FormField, value: unknown): string[] {
  const errors: string[] = [];
  const options = new Set((field.options ?? []).map((option) => option.value));
  switch (field.type) {
    case "TEXT":
      if (typeof value !== "string") {
        errors.push("must be a string");
      } else if (value.length > 500) {
        errors.push("length must be <= 500");
      }
      break;
    case "TEXTAREA":
      if (typeof value !== "string") {
        errors.push("must be a string");
      } else if (value.length > 10_000) {
        errors.push("length must be <= 10000");
      }
      break;
    case "PHONE":
      if (typeof value !== "string" || !/^\+[1-9]\d{7,14}$/.test(value)) {
        errors.push("must be an E.164 phone number");
      }
      break;
    case "EMAIL":
      if (
        typeof value !== "string" ||
        value.length > 320 ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
      ) {
        errors.push("must be an email address");
      }
      break;
    case "NUMBER":
      if (typeof value !== "number" || !Number.isFinite(value)) errors.push("must be a number");
      break;
    case "MONEY":
      if (typeof value !== "string" || !/^\d{1,12}(?:\.\d{1,2})?$/.test(value)) {
        errors.push("must be a fixed-precision decimal string");
      }
      break;
    case "SELECT":
      if (typeof value !== "string" || !options.has(value)) {
        errors.push("must be one of the published options");
      }
      break;
    case "MULTISELECT":
      if (
        !Array.isArray(value) ||
        value.length > 100 ||
        !value.every((item) => typeof item === "string" && options.has(item)) ||
        new Set(value).size !== value.length
      ) {
        errors.push("must contain unique published option values");
      }
      break;
    case "BOOLEAN":
      if (typeof value !== "boolean") errors.push("must be a boolean");
      break;
    case "DATE":
      if (typeof value !== "string" || !isValidDate(value)) errors.push("must be an ISO date");
      break;
    case "LOCATION":
      if (
        !isPlainRecord(value) ||
        Object.keys(value).some((key) => key !== "latitude" && key !== "longitude") ||
        typeof value.latitude !== "number" ||
        value.latitude < -90 ||
        value.latitude > 90 ||
        typeof value.longitude !== "number" ||
        value.longitude < -180 ||
        value.longitude > 180
      ) {
        errors.push("must be a bounded latitude/longitude object");
      }
      break;
  }
  if (errors.length > 0) return errors;

  const validation = field.validation;
  if (!validation) return errors;
  const comparableNumber =
    typeof value === "number"
      ? value
      : field.type === "MONEY" && typeof value === "string"
        ? Number(value)
        : undefined;
  if (comparableNumber !== undefined) {
    if (validation.min !== undefined && comparableNumber < validation.min) {
      errors.push(`must be >= ${validation.min}`);
    }
    if (validation.max !== undefined && comparableNumber > validation.max) {
      errors.push(`must be <= ${validation.max}`);
    }
  }
  const measurableLength =
    typeof value === "string" || Array.isArray(value) ? value.length : undefined;
  if (measurableLength !== undefined) {
    if (validation.minLength !== undefined && measurableLength < validation.minLength) {
      errors.push(`length must be >= ${validation.minLength}`);
    }
    if (validation.maxLength !== undefined && measurableLength > validation.maxLength) {
      errors.push(`length must be <= ${validation.maxLength}`);
    }
  }
  if (
    validation.pattern !== undefined &&
    typeof value === "string" &&
    !new RegExp(validation.pattern, "u").test(value)
  ) {
    errors.push("does not match the published pattern");
  }
  return errors;
}

function mapRegion(record: RegionTaxonomyRecord, children: readonly Region[] = []): Region {
  return {
    id: record.id,
    parentId: record.parentId,
    code: record.code,
    type: record.type,
    slug: record.slug,
    name: {
      "zh-Hans": record.nameZhHans,
      "en-US": record.nameEn,
    },
    timezone: record.timezone,
    centroid:
      record.latitude === null || record.longitude === null
        ? null
        : { latitude: record.latitude, longitude: record.longitude },
    active: record.isActive,
    aliases: record.aliases,
    children,
  };
}

function mapCategory(record: CategoryTaxonomyRecord, children: readonly Category[] = []): Category {
  return {
    id: record.id,
    parentId: record.parentId,
    vertical: record.vertical,
    slug: record.slug,
    name: {
      "zh-Hans": record.nameZhHans,
      "en-US": record.nameEn,
    },
    iconKey: record.iconKey,
    formSchemaVersion: record.formSchemaVersion,
    active: record.isActive,
    aliases: record.aliases,
    children,
  };
}

function regionTree(records: readonly RegionTaxonomyRecord[]): Region[] {
  const childrenByParent = new Map<string | null, RegionTaxonomyRecord[]>();
  for (const record of records) {
    const children = childrenByParent.get(record.parentId) ?? [];
    children.push(record);
    childrenByParent.set(record.parentId, children);
  }
  const build = (record: RegionTaxonomyRecord, ancestors: ReadonlySet<string>): Region => {
    if (ancestors.has(record.id)) return mapRegion(record);
    const lineage = new Set(ancestors);
    lineage.add(record.id);
    return mapRegion(
      record,
      (childrenByParent.get(record.id) ?? []).map((child) => build(child, lineage)),
    );
  };
  return (childrenByParent.get(null) ?? []).map((record) => build(record, new Set()));
}

function categoryTree(records: readonly CategoryTaxonomyRecord[]): Category[] {
  const childrenByParent = new Map<string | null, CategoryTaxonomyRecord[]>();
  for (const record of records) {
    const children = childrenByParent.get(record.parentId) ?? [];
    children.push(record);
    childrenByParent.set(record.parentId, children);
  }
  const build = (record: CategoryTaxonomyRecord, ancestors: ReadonlySet<string>): Category => {
    if (ancestors.has(record.id)) return mapCategory(record);
    const lineage = new Set(ancestors);
    lineage.add(record.id);
    return mapCategory(
      record,
      (childrenByParent.get(record.id) ?? []).map((child) => build(child, lineage)),
    );
  };
  return (childrenByParent.get(null) ?? []).map((record) => build(record, new Set()));
}

@Injectable()
export class TaxonomyService {
  constructor(@Inject(TAXONOMY_STORE) private readonly store: TaxonomyStore) {}

  async listRegions(query: ListRegionsQuery): Promise<RegionCollectionResponse> {
    const records = await this.store.listRegions({
      activeOnly: query.activeOnly ?? true,
      ...(query.parentCode ? { parentCode: query.parentCode } : {}),
      ...(query.type ? { type: query.type } : {}),
      ...(query.q ? { query: query.q } : {}),
    });
    const isTreeQuery = !query.parentCode && !query.type && !query.q;
    return {
      data: isTreeQuery ? regionTree(records) : records.map((record) => mapRegion(record)),
    };
  }

  async listCategories(query: ListCategoriesQuery): Promise<CategoryCollectionResponse> {
    const records = await this.store.listCategories({
      activeOnly: query.activeOnly ?? true,
      ...(query.vertical ? { vertical: query.vertical } : {}),
      ...(query.parentId ? { parentId: query.parentId } : {}),
      ...(query.q ? { query: query.q } : {}),
    });
    const isTreeQuery = !query.parentId && !query.q;
    return {
      data: isTreeQuery ? categoryTree(records) : records.map((record) => mapCategory(record)),
    };
  }

  async getPublishedFormSchema(
    categoryId: string,
    query: GetCategoryFormSchemaQuery,
  ): Promise<CategoryFormSchemaPreview> {
    const schema = await this.store.getPublishedFormSchema({
      categoryId,
      publicOnly: true,
      ...(query.version === undefined ? {} : { version: query.version }),
    });
    if (!schema) throw new CategoryFormSchemaNotFoundError();
    return {
      definition: schema.definition,
      revision: schema.revision,
      contentHash: schema.contentHash,
    };
  }

  async saveFormSchemaDraft(
    input: CategoryFormSchemaDraftInput,
  ): Promise<CategoryFormSchemaPreview> {
    const definition = categoryFormSchemaSchema.parse({
      categoryId: input.categoryId,
      version: input.expectedCurrentVersion + 1,
      fields: input.fields,
      ...(input.publicationPolicy ? { publicationPolicy: input.publicationPolicy } : {}),
    });
    const result = await this.store.saveFormSchemaDraft({
      categoryId: input.categoryId,
      expectedCurrentVersion: input.expectedCurrentVersion,
      ...(input.expectedDraftRevision === undefined
        ? {}
        : { expectedDraftRevision: input.expectedDraftRevision }),
      definition,
      contentHash: contentHash(definition),
      actorId: input.actorId,
    });
    return this.#unwrapMutation(result);
  }

  async previewFormSchemaDraft(categoryId: string): Promise<CategoryFormSchemaPreview> {
    const lifecycle = await this.store.getFormSchemaLifecycle(categoryId);
    if (!lifecycle?.draft) throw new CategoryFormSchemaNotFoundError();
    return this.#preview(lifecycle.draft);
  }

  async publishFormSchemaDraft(input: {
    categoryId: string;
    expectedCurrentVersion: number;
    expectedDraftRevision: number;
    actorId: string;
  }): Promise<CategoryFormSchemaPreview> {
    const lifecycle = await this.store.getFormSchemaLifecycle(input.categoryId);
    if (!lifecycle) throw new CategoryFormSchemaNotFoundError();
    if (lifecycle.currentVersion !== input.expectedCurrentVersion) {
      throw new CategoryFormSchemaConflictError(
        "current_version_conflict",
        lifecycle.currentVersion,
      );
    }
    const draft = lifecycle.draft;
    if (!draft) throw new CategoryFormSchemaConflictError("draft_missing");
    this.#assertFieldTypeCompatibility(lifecycle.published, draft.definition);
    const result = await this.store.publishFormSchemaDraft({
      ...input,
      fields: draft.definition.fields,
    });
    return this.#unwrapMutation(result);
  }

  async rollbackFormSchema(input: {
    categoryId: string;
    targetVersion: number;
    expectedCurrentVersion: number;
    actorId: string;
  }): Promise<CategoryFormSchemaPreview> {
    const lifecycle = await this.store.getFormSchemaLifecycle(input.categoryId);
    if (!lifecycle) throw new CategoryFormSchemaNotFoundError();
    if (lifecycle.currentVersion !== input.expectedCurrentVersion) {
      throw new CategoryFormSchemaConflictError(
        "current_version_conflict",
        lifecycle.currentVersion,
      );
    }
    if (lifecycle.draft) {
      throw new CategoryFormSchemaConflictError(
        "draft_revision_conflict",
        lifecycle.currentVersion,
        lifecycle.draft.revision,
      );
    }
    const target = lifecycle.published.find((version) => version.version === input.targetVersion);
    if (!target) throw new CategoryFormSchemaNotFoundError();
    const definition = cloneDefinitionForVersion(target.definition, lifecycle.currentVersion + 1);
    const result = await this.store.rollbackFormSchema({
      ...input,
      definition,
      contentHash: contentHash(definition),
      fields: definition.fields,
    });
    return this.#unwrapMutation(result);
  }

  async validateAttributes(
    categoryId: string,
    version: number,
    attributes: Record<string, unknown>,
  ): Promise<CategoryFormSchemaAttributeValidation> {
    const published = await this.store.getPublishedFormSchema({
      categoryId,
      version,
      publicOnly: false,
    });
    if (!published) throw new CategoryFormSchemaNotFoundError();
    const fields = new Map(published.definition.fields.map((field) => [field.key, field]));
    const errors: Record<string, string[]> = {};
    for (const key of Object.keys(attributes)) {
      if (!fields.has(key)) addAttributeError(errors, key, "field is not present in this version");
    }
    for (const field of fields.values()) {
      const value = attributes[field.key];
      const isEmpty =
        value === undefined ||
        value === null ||
        (typeof value === "string" && value.trim() === "") ||
        (Array.isArray(value) && value.length === 0);
      if (isEmpty) {
        if (field.required) addAttributeError(errors, field.key, "field is required");
        continue;
      }
      for (const message of validateFieldValue(field, value)) {
        addAttributeError(errors, field.key, message);
      }
    }
    return { valid: Object.keys(errors).length === 0, errors };
  }

  #assertFieldTypeCompatibility(
    published: readonly CategoryFormSchemaVersionRecord[],
    candidate: CategoryFormSchema,
  ): void {
    const historicalTypes = new Map<string, FormField["type"]>();
    for (const version of published) {
      for (const field of version.definition.fields) {
        historicalTypes.set(field.key, historicalTypes.get(field.key) ?? field.type);
      }
    }
    for (const field of candidate.fields) {
      const historical = historicalTypes.get(field.key);
      if (historical && historical !== field.type) {
        throw new CategoryFormSchemaCompatibilityError(field.key);
      }
    }
  }

  #unwrapMutation(
    result: Awaited<ReturnType<TaxonomyStore["saveFormSchemaDraft"]>>,
  ): CategoryFormSchemaPreview {
    if (result.kind !== "ok") {
      if (result.kind === "category_not_found" || result.kind === "target_missing") {
        throw new CategoryFormSchemaNotFoundError();
      }
      throw new CategoryFormSchemaConflictError(
        result.kind,
        result.currentVersion,
        result.currentDraftRevision,
      );
    }
    return this.#preview(result.schema);
  }

  #preview(schema: CategoryFormSchemaVersionRecord): CategoryFormSchemaPreview {
    return {
      definition: schema.definition,
      revision: schema.revision,
      contentHash: schema.contentHash,
    };
  }
}
