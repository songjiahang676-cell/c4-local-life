import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient, type HomepageLayoutVersion } from "../../generated/prisma/client";

const cacheInvalidationEventType = "homepage.layout.published";

export type HomepageLayoutRepositoryOptions = {
  connectionString: string;
  poolMaximum?: number;
};

export type HomepageLayoutScope = {
  id: string;
  locale: "zh-Hans" | "en-US";
  regionCode: string;
  currentVersion: number;
};

export type HomepageLayoutRecord = {
  id: string;
  layoutId: string;
  version: number;
  revision: number;
  definition: Prisma.JsonValue;
  contentHash: string;
  basedOnVersion: number | null;
  createdById: string;
  updatedById: string;
  publishedById: string | null;
  createdAt: Date;
  updatedAt: Date;
  publishedAt: Date | null;
};

export type HomepageLayoutLifecycle = HomepageLayoutScope & {
  draft: HomepageLayoutRecord | null;
  published: HomepageLayoutRecord[];
};

export type HomepageLayoutMutationResult =
  | { kind: "ok"; scope: HomepageLayoutScope; layout: HomepageLayoutRecord }
  | {
      kind:
        | "scope_not_found"
        | "current_version_conflict"
        | "draft_missing"
        | "draft_revision_conflict"
        | "target_missing";
      currentVersion?: number;
      currentDraftRevision?: number;
    };

export type SaveHomepageLayoutDraftInput = {
  locale: "zh-Hans" | "en-US";
  regionCode: string;
  expectedCurrentVersion: number;
  expectedDraftRevision?: number;
  definition: unknown;
  contentHash: string;
  actorId: string;
};

export type PublishHomepageLayoutDraftInput = {
  locale: "zh-Hans" | "en-US";
  regionCode: string;
  expectedCurrentVersion: number;
  expectedDraftRevision: number;
  actorId: string;
  publishedAt?: Date;
};

export type RollbackHomepageLayoutInput = {
  locale: "zh-Hans" | "en-US";
  regionCode: string;
  targetVersion: number;
  expectedCurrentVersion: number;
  definition: unknown;
  contentHash: string;
  actorId: string;
  publishedAt?: Date;
};

const layoutVersionSelect = {
  id: true,
  layoutId: true,
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
} satisfies Prisma.HomepageLayoutVersionSelect;

type SelectedLayoutVersion = Prisma.HomepageLayoutVersionGetPayload<{
  select: typeof layoutVersionSelect;
}>;

function mapRecord(row: SelectedLayoutVersion | HomepageLayoutVersion): HomepageLayoutRecord {
  return {
    id: row.id,
    layoutId: row.layoutId,
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

function mapScope(row: {
  id: string;
  locale: string;
  regionCode: string;
  currentVersion: number;
}): HomepageLayoutScope {
  if (row.locale !== "zh-Hans" && row.locale !== "en-US") {
    throw new Error("Homepage layout locale drift");
  }
  return {
    id: row.id,
    locale: row.locale,
    regionCode: row.regionCode,
    currentVersion: row.currentVersion,
  };
}

function isRepositoryOptions(
  target: PrismaClient | Prisma.TransactionClient | HomepageLayoutRepositoryOptions,
): target is HomepageLayoutRepositoryOptions {
  return "connectionString" in target;
}

function asJsonInput(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

async function ensureAndLockScope(
  transaction: Prisma.TransactionClient,
  input: Pick<SaveHomepageLayoutDraftInput, "locale" | "regionCode">,
): Promise<HomepageLayoutScope> {
  const existing = await transaction.homepageLayoutState.upsert({
    where: {
      locale_regionCode: {
        locale: input.locale,
        regionCode: input.regionCode,
      },
    },
    create: {
      locale: input.locale,
      regionCode: input.regionCode,
    },
    update: {},
    select: { id: true },
  });
  const rows = await transaction.$queryRaw<
    Array<{ id: string; locale: string; regionCode: string; currentVersion: number }>
  >(
    Prisma.sql`
      SELECT
        "id",
        "locale",
        "region_code" AS "regionCode",
        "current_version" AS "currentVersion"
      FROM "homepage_layout_states"
      WHERE "id" = ${existing.id}::uuid
      FOR UPDATE
    `,
  );
  const state = rows[0];
  if (!state) throw new Error("Homepage layout state disappeared while locking");
  return mapScope(state);
}

async function lockExistingScope(
  transaction: Prisma.TransactionClient,
  input: Pick<PublishHomepageLayoutDraftInput, "locale" | "regionCode">,
): Promise<HomepageLayoutScope | null> {
  const rows = await transaction.$queryRaw<
    Array<{ id: string; locale: string; regionCode: string; currentVersion: number }>
  >(
    Prisma.sql`
      SELECT
        "id",
        "locale",
        "region_code" AS "regionCode",
        "current_version" AS "currentVersion"
      FROM "homepage_layout_states"
      WHERE "locale" = ${input.locale}
        AND "region_code" = ${input.regionCode}
      FOR UPDATE
    `,
  );
  return rows[0] ? mapScope(rows[0]) : null;
}

async function appendInvalidation(
  transaction: Prisma.TransactionClient,
  input: {
    scope: HomepageLayoutScope;
    version: number;
    contentHash: string;
    operation: "publish" | "rollback";
    basedOnVersion?: number;
    occurredAt: Date;
  },
): Promise<void> {
  await transaction.outboxEvent.create({
    data: {
      aggregateType: "HOMEPAGE_LAYOUT",
      aggregateId: input.scope.id,
      eventType: cacheInvalidationEventType,
      payload: {
        schemaVersion: 1,
        layoutId: input.scope.id,
        locale: input.scope.locale,
        regionCode: input.scope.regionCode,
        version: input.version,
        contentHash: input.contentHash,
        operation: input.operation,
        ...(input.basedOnVersion === undefined ? {} : { basedOnVersion: input.basedOnVersion }),
        occurredAt: input.occurredAt.toISOString(),
      },
      availableAt: input.occurredAt,
    },
  });
}

export class HomepageLayoutRepository {
  readonly #client: PrismaClient | Prisma.TransactionClient;
  readonly #ownedClient: PrismaClient | null;

  constructor(target: PrismaClient | Prisma.TransactionClient | HomepageLayoutRepositoryOptions) {
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
    locale: "zh-Hans" | "en-US";
    regionCode: string;
    version?: number;
  }): Promise<HomepageLayoutRecord | null> {
    const state = await this.#client.homepageLayoutState.findUnique({
      where: {
        locale_regionCode: {
          locale: input.locale,
          regionCode: input.regionCode,
        },
      },
      select: { id: true, currentVersion: true },
    });
    if (!state) return null;
    const selectedVersion = input.version ?? state.currentVersion;
    if (selectedVersion < 1) return null;
    const row = await this.#client.homepageLayoutVersion.findUnique({
      where: {
        layoutId_version: {
          layoutId: state.id,
          version: selectedVersion,
        },
      },
      select: layoutVersionSelect,
    });
    return row?.publishedAt ? mapRecord(row) : null;
  }

  async getLifecycle(input: {
    locale: "zh-Hans" | "en-US";
    regionCode: string;
  }): Promise<HomepageLayoutLifecycle | null> {
    const state = await this.#client.homepageLayoutState.findUnique({
      where: {
        locale_regionCode: {
          locale: input.locale,
          regionCode: input.regionCode,
        },
      },
      select: {
        id: true,
        locale: true,
        regionCode: true,
        currentVersion: true,
        versions: {
          orderBy: { version: "asc" },
          select: layoutVersionSelect,
        },
      },
    });
    if (!state) return null;
    const versions = state.versions.map(mapRecord);
    return {
      ...mapScope(state),
      draft: versions.find((version) => version.publishedAt === null) ?? null,
      published: versions.filter((version) => version.publishedAt !== null),
    };
  }

  saveDraft(input: SaveHomepageLayoutDraftInput): Promise<HomepageLayoutMutationResult> {
    return this.#inTransaction(async (transaction) => {
      const scope =
        input.expectedCurrentVersion === 0
          ? await ensureAndLockScope(transaction, input)
          : await lockExistingScope(transaction, input);
      if (!scope) {
        return {
          kind: "current_version_conflict",
          currentVersion: 0,
        };
      }
      if (scope.currentVersion !== input.expectedCurrentVersion) {
        return {
          kind: "current_version_conflict",
          currentVersion: scope.currentVersion,
        };
      }
      const nextVersion = scope.currentVersion + 1;
      const existing = await transaction.homepageLayoutVersion.findFirst({
        where: { layoutId: scope.id, publishedAt: null },
        select: layoutVersionSelect,
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
        const updated = await transaction.homepageLayoutVersion.update({
          where: { id: existing.id },
          data: {
            definition: asJsonInput(input.definition),
            contentHash: input.contentHash,
            revision: { increment: 1 },
            updatedById: input.actorId,
          },
          select: layoutVersionSelect,
        });
        return { kind: "ok", scope, layout: mapRecord(updated) };
      }
      if (input.expectedDraftRevision !== undefined) {
        return { kind: "draft_revision_conflict" };
      }
      const created = await transaction.homepageLayoutVersion.create({
        data: {
          layoutId: scope.id,
          version: nextVersion,
          definition: asJsonInput(input.definition),
          contentHash: input.contentHash,
          createdById: input.actorId,
          updatedById: input.actorId,
        },
        select: layoutVersionSelect,
      });
      return { kind: "ok", scope, layout: mapRecord(created) };
    });
  }

  publishDraft(input: PublishHomepageLayoutDraftInput): Promise<HomepageLayoutMutationResult> {
    return this.#inTransaction(async (transaction) => {
      const scope = await lockExistingScope(transaction, input);
      if (!scope) return { kind: "scope_not_found" };
      if (scope.currentVersion !== input.expectedCurrentVersion) {
        return {
          kind: "current_version_conflict",
          currentVersion: scope.currentVersion,
        };
      }
      const draft = await transaction.homepageLayoutVersion.findFirst({
        where: { layoutId: scope.id, publishedAt: null },
        select: layoutVersionSelect,
      });
      if (!draft || draft.version !== scope.currentVersion + 1) {
        return { kind: "draft_missing" };
      }
      if (draft.revision !== input.expectedDraftRevision) {
        return {
          kind: "draft_revision_conflict",
          currentDraftRevision: draft.revision,
        };
      }
      const publishedAt = input.publishedAt ?? new Date();
      const published = await transaction.homepageLayoutVersion.update({
        where: { id: draft.id },
        data: {
          publishedAt,
          publishedById: input.actorId,
        },
        select: layoutVersionSelect,
      });
      await transaction.homepageLayoutState.update({
        where: { id: scope.id },
        data: { currentVersion: draft.version, updatedAt: publishedAt },
      });
      const publishedScope = { ...scope, currentVersion: draft.version };
      await appendInvalidation(transaction, {
        scope: publishedScope,
        version: draft.version,
        contentHash: draft.contentHash,
        operation: "publish",
        occurredAt: publishedAt,
      });
      return { kind: "ok", scope: publishedScope, layout: mapRecord(published) };
    });
  }

  rollback(input: RollbackHomepageLayoutInput): Promise<HomepageLayoutMutationResult> {
    return this.#inTransaction(async (transaction) => {
      const scope = await lockExistingScope(transaction, input);
      if (!scope) return { kind: "scope_not_found" };
      if (scope.currentVersion !== input.expectedCurrentVersion) {
        return {
          kind: "current_version_conflict",
          currentVersion: scope.currentVersion,
        };
      }
      const existingDraft = await transaction.homepageLayoutVersion.findFirst({
        where: { layoutId: scope.id, publishedAt: null },
        select: { revision: true },
      });
      if (existingDraft) {
        return {
          kind: "draft_revision_conflict",
          currentDraftRevision: existingDraft.revision,
        };
      }
      const target = await transaction.homepageLayoutVersion.findUnique({
        where: {
          layoutId_version: {
            layoutId: scope.id,
            version: input.targetVersion,
          },
        },
        select: { publishedAt: true },
      });
      if (!target?.publishedAt) return { kind: "target_missing" };
      const nextVersion = scope.currentVersion + 1;
      const publishedAt = input.publishedAt ?? new Date();
      const created = await transaction.homepageLayoutVersion.create({
        data: {
          layoutId: scope.id,
          version: nextVersion,
          definition: asJsonInput(input.definition),
          contentHash: input.contentHash,
          basedOnVersion: input.targetVersion,
          createdById: input.actorId,
          updatedById: input.actorId,
          publishedById: input.actorId,
          publishedAt,
        },
        select: layoutVersionSelect,
      });
      await transaction.homepageLayoutState.update({
        where: { id: scope.id },
        data: { currentVersion: nextVersion, updatedAt: publishedAt },
      });
      const publishedScope = { ...scope, currentVersion: nextVersion };
      await appendInvalidation(transaction, {
        scope: publishedScope,
        version: nextVersion,
        contentHash: input.contentHash,
        operation: "rollback",
        basedOnVersion: input.targetVersion,
        occurredAt: publishedAt,
      });
      return { kind: "ok", scope: publishedScope, layout: mapRecord(created) };
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
