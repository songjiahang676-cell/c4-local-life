import { Inject, Injectable, type OnModuleDestroy } from "@nestjs/common";
import type { ApiEnvironment } from "@socal/config";
import {
  CategoryFormSchemaRepository,
  TaxonomyRepository,
  type CategoryFormSchemaRecord,
  type CategoryTaxonomyRecord,
  type ListCategoryTaxonomyInput,
  type ListRegionTaxonomyInput,
  type MaterializedCategoryField,
  type RegionTaxonomyRecord,
} from "@socal/database/taxonomy";
import { categoryFormSchemaSchema, type FormField } from "@socal/contracts";
import { API_ENVIRONMENT } from "../../common/api-environment.token";
import type {
  CategoryFormSchemaLifecycleRecord,
  CategoryFormSchemaVersionRecord,
  FormSchemaMutationResult,
  PublishFormSchemaDraftInput,
  RollbackFormSchemaInput,
  SaveFormSchemaDraftInput,
  TaxonomyStore,
} from "./taxonomy.store";

function parseRecord(record: CategoryFormSchemaRecord): CategoryFormSchemaVersionRecord {
  return {
    ...record,
    definition: categoryFormSchemaSchema.parse(record.definition),
  };
}

function mapResult(
  result: Awaited<ReturnType<CategoryFormSchemaRepository["saveDraft"]>>,
): FormSchemaMutationResult {
  return result.kind === "ok" ? { kind: "ok", schema: parseRecord(result.schema) } : result;
}

function materialize(fields: readonly FormField[]): MaterializedCategoryField[] {
  return fields.map((field) => ({
    key: field.key,
    labelZhHans: field.label["zh-Hans"],
    labelEn: field.label["en-US"],
    fieldType: field.type,
    isRequired: field.required,
    isFilterable: field.filterable,
    isSearchable: field.searchable,
    visibility: field.visibility,
    sortOrder: field.sortOrder,
    ...(field.helpText
      ? { helpText: field.helpText as MaterializedCategoryField["helpText"] }
      : {}),
    ...(field.options ? { options: field.options as MaterializedCategoryField["options"] } : {}),
    ...(field.validation
      ? { validation: field.validation as MaterializedCategoryField["validation"] }
      : {}),
  }));
}

@Injectable()
export class DatabaseTaxonomyStore implements TaxonomyStore, OnModuleDestroy {
  readonly #repository: TaxonomyRepository;
  readonly #formSchemas: CategoryFormSchemaRepository;

  constructor(@Inject(API_ENVIRONMENT) environment: ApiEnvironment) {
    this.#repository = new TaxonomyRepository({
      connectionString: environment.DATABASE_URL,
      poolMaximum: environment.DATABASE_POOL_MAX,
    });
    this.#formSchemas = new CategoryFormSchemaRepository({
      connectionString: environment.DATABASE_URL,
      poolMaximum: environment.DATABASE_POOL_MAX,
    });
  }

  listRegions(input: ListRegionTaxonomyInput): Promise<RegionTaxonomyRecord[]> {
    return this.#repository.listRegions(input);
  }

  listCategories(input: ListCategoryTaxonomyInput): Promise<CategoryTaxonomyRecord[]> {
    return this.#repository.listCategories(input);
  }

  async getPublishedFormSchema(input: {
    categoryId: string;
    version?: number;
    publicOnly: boolean;
  }): Promise<CategoryFormSchemaVersionRecord | null> {
    const record = await this.#formSchemas.getPublished({
      categoryId: input.categoryId,
      requireActiveCategory: input.publicOnly,
      ...(input.version === undefined ? {} : { version: input.version }),
    });
    return record ? parseRecord(record) : null;
  }

  async getFormSchemaLifecycle(
    categoryId: string,
  ): Promise<CategoryFormSchemaLifecycleRecord | null> {
    const lifecycle = await this.#formSchemas.getLifecycle(categoryId);
    return lifecycle
      ? {
          ...lifecycle,
          draft: lifecycle.draft ? parseRecord(lifecycle.draft) : null,
          published: lifecycle.published.map(parseRecord),
        }
      : null;
  }

  async saveFormSchemaDraft(input: SaveFormSchemaDraftInput): Promise<FormSchemaMutationResult> {
    return mapResult(await this.#formSchemas.saveDraft(input));
  }

  async publishFormSchemaDraft(
    input: PublishFormSchemaDraftInput,
  ): Promise<FormSchemaMutationResult> {
    return mapResult(
      await this.#formSchemas.publishDraft({
        ...input,
        fields: materialize(input.fields),
      }),
    );
  }

  async rollbackFormSchema(input: RollbackFormSchemaInput): Promise<FormSchemaMutationResult> {
    return mapResult(
      await this.#formSchemas.rollback({
        ...input,
        fields: materialize(input.fields),
      }),
    );
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all([this.#repository.close(), this.#formSchemas.close()]);
  }
}
