import type {
  CategoryTaxonomyRecord,
  ListCategoryTaxonomyInput,
  ListRegionTaxonomyInput,
  RegionTaxonomyRecord,
} from "@socal/database/taxonomy";
import type { CategoryFormSchema, FormField } from "@socal/contracts";

export const TAXONOMY_STORE = Symbol("TAXONOMY_STORE");

export type TaxonomyStore = {
  listRegions(input: ListRegionTaxonomyInput): Promise<RegionTaxonomyRecord[]>;
  listCategories(input: ListCategoryTaxonomyInput): Promise<CategoryTaxonomyRecord[]>;
  getPublishedFormSchema(input: {
    categoryId: string;
    version?: number;
    publicOnly: boolean;
  }): Promise<CategoryFormSchemaVersionRecord | null>;
  getFormSchemaLifecycle(categoryId: string): Promise<CategoryFormSchemaLifecycleRecord | null>;
  saveFormSchemaDraft(input: SaveFormSchemaDraftInput): Promise<FormSchemaMutationResult>;
  publishFormSchemaDraft(input: PublishFormSchemaDraftInput): Promise<FormSchemaMutationResult>;
  rollbackFormSchema(input: RollbackFormSchemaInput): Promise<FormSchemaMutationResult>;
};

export type CategoryFormSchemaVersionRecord = {
  id: string;
  categoryId: string;
  version: number;
  revision: number;
  definition: CategoryFormSchema;
  contentHash: string;
  basedOnVersion: number | null;
  createdById: string | null;
  updatedById: string | null;
  publishedById: string | null;
  createdAt: Date;
  updatedAt: Date;
  publishedAt: Date | null;
};

export type CategoryFormSchemaLifecycleRecord = {
  categoryId: string;
  currentVersion: number;
  active: boolean;
  draft: CategoryFormSchemaVersionRecord | null;
  published: CategoryFormSchemaVersionRecord[];
};

export type FormSchemaMutationResult =
  | { kind: "ok"; schema: CategoryFormSchemaVersionRecord }
  | {
      kind:
        | "category_not_found"
        | "current_version_conflict"
        | "draft_missing"
        | "draft_revision_conflict"
        | "target_missing";
      currentVersion?: number;
      currentDraftRevision?: number;
    };

export type SaveFormSchemaDraftInput = {
  categoryId: string;
  expectedCurrentVersion: number;
  expectedDraftRevision?: number;
  definition: CategoryFormSchema;
  contentHash: string;
  actorId: string;
};

export type PublishFormSchemaDraftInput = {
  categoryId: string;
  expectedCurrentVersion: number;
  expectedDraftRevision: number;
  actorId: string;
  fields: readonly FormField[];
};

export type RollbackFormSchemaInput = {
  categoryId: string;
  targetVersion: number;
  expectedCurrentVersion: number;
  definition: CategoryFormSchema;
  contentHash: string;
  actorId: string;
  fields: readonly FormField[];
};

export type {
  CategoryTaxonomyRecord,
  ListCategoryTaxonomyInput,
  ListRegionTaxonomyInput,
  RegionTaxonomyRecord,
};
