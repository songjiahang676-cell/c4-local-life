import { PrismaPg } from "@prisma/adapter-pg";
import {
  Prisma,
  PrismaClient,
  type CategoryFormSchemaVersion,
} from "../../generated/prisma/client";

export type CategoryFormSchemaRepositoryOptions = {
  connectionString: string;
  poolMaximum?: number;
};

export type MaterializedCategoryField = {
  key: string;
  labelZhHans: string;
  labelEn: string;
  helpText?: Prisma.InputJsonValue;
  fieldType: string;
  isRequired: boolean;
  isFilterable: boolean;
  isSearchable: boolean;
  visibility: string;
  options?: Prisma.InputJsonValue;
  validation?: Prisma.InputJsonValue;
  sortOrder: number;
};

export type CategoryFormSchemaRecord = {
  id: string;
  categoryId: string;
  version: number;
  revision: number;
  definition: Prisma.JsonValue;
  contentHash: string;
  basedOnVersion: number | null;
  createdById: string | null;
  updatedById: string | null;
  publishedById: string | null;
  createdAt: Date;
  updatedAt: Date;
  publishedAt: Date | null;
};

export type CategoryFormSchemaLifecycle = {
  categoryId: string;
  currentVersion: number;
  active: boolean;
  draft: CategoryFormSchemaRecord | null;
  published: CategoryFormSchemaRecord[];
};

export type SaveCategoryFormSchemaDraftInput = {
  categoryId: string;
  expectedCurrentVersion: number;
  expectedDraftRevision?: number;
  definition: unknown;
  contentHash: string;
  actorId: string;
};

export type PublishCategoryFormSchemaDraftInput = {
  categoryId: string;
  expectedCurrentVersion: number;
  expectedDraftRevision: number;
  actorId: string;
  fields: readonly MaterializedCategoryField[];
};

export type RollbackCategoryFormSchemaInput = {
  categoryId: string;
  targetVersion: number;
  expectedCurrentVersion: number;
  definition: unknown;
  contentHash: string;
  actorId: string;
  fields: readonly MaterializedCategoryField[];
};

export type CategoryFormSchemaMutationResult =
  | { kind: "ok"; schema: CategoryFormSchemaRecord }
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

const formSchemaSelect = {
  id: true,
  categoryId: true,
  version: true,
  revision: true,
  definition: true,
  contentHash: true,
  basedOnVersion: true,
  createdById: true,
  updatedById: true,
  publishedById: true,
  createdAt: true,
  updatedAt: true,
  publishedAt: true,
} satisfies Prisma.CategoryFormSchemaVersionSelect;

type SelectedFormSchema = Prisma.CategoryFormSchemaVersionGetPayload<{
  select: typeof formSchemaSelect;
}>;

function mapRecord(row: SelectedFormSchema | CategoryFormSchemaVersion): CategoryFormSchemaRecord {
  return {
    id: row.id,
    categoryId: row.categoryId,
    version: row.version,
    revision: row.revision,
    definition: row.definition,
    contentHash: row.contentHash,
    basedOnVersion: row.basedOnVersion,
    createdById: row.createdById,
    updatedById: row.updatedById,
    publishedById: row.publishedById,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    publishedAt: row.publishedAt,
  };
}

function isRepositoryOptions(
  target: PrismaClient | Prisma.TransactionClient | CategoryFormSchemaRepositoryOptions,
): target is CategoryFormSchemaRepositoryOptions {
  return "connectionString" in target;
}

function asJsonInput(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

async function lockCategory(
  transaction: Prisma.TransactionClient,
  categoryId: string,
): Promise<{ id: string; formSchemaVersion: number; isActive: boolean } | null> {
  const locked = await transaction.$queryRaw<Array<{ id: string }>>(
    Prisma.sql`SELECT "id" FROM "categories" WHERE "id" = ${categoryId}::uuid FOR UPDATE`,
  );
  if (locked.length === 0) return null;
  return transaction.category.findUnique({
    where: { id: categoryId },
    select: { id: true, formSchemaVersion: true, isActive: true },
  });
}

async function materializeFields(
  transaction: Prisma.TransactionClient,
  categoryId: string,
  fields: readonly MaterializedCategoryField[],
): Promise<void> {
  await transaction.categoryField.deleteMany({ where: { categoryId } });
  if (fields.length === 0) return;
  await transaction.categoryField.createMany({
    data: fields.map((field) => ({
      categoryId,
      key: field.key,
      labelZhHans: field.labelZhHans,
      labelEn: field.labelEn,
      fieldType: field.fieldType,
      isRequired: field.isRequired,
      isFilterable: field.isFilterable,
      isSearchable: field.isSearchable,
      visibility: field.visibility,
      sortOrder: field.sortOrder,
      ...(field.helpText === undefined ? {} : { helpText: field.helpText }),
      ...(field.options === undefined ? {} : { options: field.options }),
      ...(field.validation === undefined ? {} : { validation: field.validation }),
    })),
  });
}

export class CategoryFormSchemaRepository {
  readonly #client: PrismaClient | Prisma.TransactionClient;
  readonly #ownedClient: PrismaClient | null;

  constructor(
    target: PrismaClient | Prisma.TransactionClient | CategoryFormSchemaRepositoryOptions,
  ) {
    if (isRepositoryOptions(target)) {
      const adapter = new PrismaPg({
        connectionString: target.connectionString,
        max: target.poolMaximum ?? 10,
      });
      this.#ownedClient = new PrismaClient({ adapter });
      this.#client = this.#ownedClient;
      return;
    }
    this.#client = target;
    this.#ownedClient = null;
  }

  async getPublished(input: {
    categoryId: string;
    version?: number;
    requireActiveCategory: boolean;
  }): Promise<CategoryFormSchemaRecord | null> {
    const category = await this.#client.category.findFirst({
      where: {
        id: input.categoryId,
        ...(input.requireActiveCategory ? { isActive: true } : {}),
      },
      select: { formSchemaVersion: true },
    });
    if (!category) return null;
    const row = await this.#client.categoryFormSchemaVersion.findUnique({
      where: {
        categoryId_version: {
          categoryId: input.categoryId,
          version: input.version ?? category.formSchemaVersion,
        },
      },
      select: formSchemaSelect,
    });
    return row?.publishedAt ? mapRecord(row) : null;
  }

  async getLifecycle(categoryId: string): Promise<CategoryFormSchemaLifecycle | null> {
    const category = await this.#client.category.findUnique({
      where: { id: categoryId },
      select: {
        id: true,
        formSchemaVersion: true,
        isActive: true,
        formSchemaVersions: {
          orderBy: { version: "asc" },
          select: formSchemaSelect,
        },
      },
    });
    if (!category) return null;
    const versions = category.formSchemaVersions.map(mapRecord);
    return {
      categoryId: category.id,
      currentVersion: category.formSchemaVersion,
      active: category.isActive,
      draft: versions.find((version) => version.publishedAt === null) ?? null,
      published: versions.filter((version) => version.publishedAt !== null),
    };
  }

  saveDraft(input: SaveCategoryFormSchemaDraftInput): Promise<CategoryFormSchemaMutationResult> {
    return this.#inTransaction(async (transaction) => {
      const category = await lockCategory(transaction, input.categoryId);
      if (!category) return { kind: "category_not_found" };
      if (category.formSchemaVersion !== input.expectedCurrentVersion) {
        return {
          kind: "current_version_conflict",
          currentVersion: category.formSchemaVersion,
        };
      }
      const nextVersion = category.formSchemaVersion + 1;
      const existing = await transaction.categoryFormSchemaVersion.findFirst({
        where: { categoryId: input.categoryId, publishedAt: null },
        select: formSchemaSelect,
      });
      if (existing) {
        if (
          existing.version !== nextVersion ||
          input.expectedDraftRevision === undefined ||
          existing.revision !== input.expectedDraftRevision
        ) {
          return {
            kind: "draft_revision_conflict",
            currentDraftRevision: existing.revision,
          };
        }
        const updated = await transaction.categoryFormSchemaVersion.update({
          where: { id: existing.id },
          data: {
            definition: asJsonInput(input.definition),
            contentHash: input.contentHash,
            revision: { increment: 1 },
            updatedById: input.actorId,
          },
          select: formSchemaSelect,
        });
        return { kind: "ok", schema: mapRecord(updated) };
      }
      if (input.expectedDraftRevision !== undefined) {
        return { kind: "draft_revision_conflict" };
      }
      const created = await transaction.categoryFormSchemaVersion.create({
        data: {
          categoryId: input.categoryId,
          version: nextVersion,
          definition: asJsonInput(input.definition),
          contentHash: input.contentHash,
          createdById: input.actorId,
          updatedById: input.actorId,
        },
        select: formSchemaSelect,
      });
      return { kind: "ok", schema: mapRecord(created) };
    });
  }

  publishDraft(
    input: PublishCategoryFormSchemaDraftInput,
  ): Promise<CategoryFormSchemaMutationResult> {
    return this.#inTransaction(async (transaction) => {
      const category = await lockCategory(transaction, input.categoryId);
      if (!category) return { kind: "category_not_found" };
      if (category.formSchemaVersion !== input.expectedCurrentVersion) {
        return {
          kind: "current_version_conflict",
          currentVersion: category.formSchemaVersion,
        };
      }
      const draft = await transaction.categoryFormSchemaVersion.findFirst({
        where: { categoryId: input.categoryId, publishedAt: null },
        select: formSchemaSelect,
      });
      if (!draft || draft.version !== category.formSchemaVersion + 1) {
        return { kind: "draft_missing" };
      }
      if (draft.revision !== input.expectedDraftRevision) {
        return {
          kind: "draft_revision_conflict",
          currentDraftRevision: draft.revision,
        };
      }
      const publishedAt = new Date();
      const published = await transaction.categoryFormSchemaVersion.update({
        where: { id: draft.id },
        data: {
          publishedAt,
          publishedById: input.actorId,
          updatedById: input.actorId,
        },
        select: formSchemaSelect,
      });
      await transaction.category.update({
        where: { id: input.categoryId },
        data: { formSchemaVersion: draft.version },
      });
      await materializeFields(transaction, input.categoryId, input.fields);
      return { kind: "ok", schema: mapRecord(published) };
    });
  }

  rollback(input: RollbackCategoryFormSchemaInput): Promise<CategoryFormSchemaMutationResult> {
    return this.#inTransaction(async (transaction) => {
      const category = await lockCategory(transaction, input.categoryId);
      if (!category) return { kind: "category_not_found" };
      if (category.formSchemaVersion !== input.expectedCurrentVersion) {
        return {
          kind: "current_version_conflict",
          currentVersion: category.formSchemaVersion,
        };
      }
      const target = await transaction.categoryFormSchemaVersion.findUnique({
        where: {
          categoryId_version: {
            categoryId: input.categoryId,
            version: input.targetVersion,
          },
        },
        select: { publishedAt: true },
      });
      if (!target?.publishedAt) return { kind: "target_missing" };
      const existingDraft = await transaction.categoryFormSchemaVersion.findFirst({
        where: { categoryId: input.categoryId, publishedAt: null },
        select: { revision: true },
      });
      if (existingDraft) {
        return {
          kind: "draft_revision_conflict",
          currentDraftRevision: existingDraft.revision,
        };
      }
      const nextVersion = category.formSchemaVersion + 1;
      const publishedAt = new Date();
      const created = await transaction.categoryFormSchemaVersion.create({
        data: {
          categoryId: input.categoryId,
          version: nextVersion,
          definition: asJsonInput(input.definition),
          contentHash: input.contentHash,
          basedOnVersion: input.targetVersion,
          createdById: input.actorId,
          updatedById: input.actorId,
          publishedById: input.actorId,
          publishedAt,
        },
        select: formSchemaSelect,
      });
      await transaction.category.update({
        where: { id: input.categoryId },
        data: { formSchemaVersion: nextVersion },
      });
      await materializeFields(transaction, input.categoryId, input.fields);
      return { kind: "ok", schema: mapRecord(created) };
    });
  }

  close(): Promise<void> {
    return this.#ownedClient?.$disconnect() ?? Promise.resolve();
  }

  #inTransaction<T>(operation: (transaction: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    if (this.#ownedClient) {
      return this.#ownedClient.$transaction(operation, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    }
    return operation(this.#client as Prisma.TransactionClient);
  }
}
