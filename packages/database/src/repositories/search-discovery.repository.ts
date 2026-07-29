import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient, type SearchDictionaryVersion } from "../../generated/prisma/client";

const dictionaryId = "default";
const minimumPublicSources = 5;

export type SearchDiscoveryRepositoryOptions = {
  connectionString: string;
  poolMaximum?: number;
};

export type SearchDictionaryRecord = {
  id: string;
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

export type SearchDictionaryLifecycle = {
  currentVersion: number;
  draft: SearchDictionaryRecord | null;
  published: SearchDictionaryRecord[];
};

export type SearchDictionaryMutationResult =
  | { kind: "ok"; dictionary: SearchDictionaryRecord }
  | {
      kind:
        | "current_version_conflict"
        | "draft_missing"
        | "draft_revision_conflict"
        | "review_required"
        | "target_missing";
      currentVersion?: number;
      currentDraftRevision?: number;
    };

export type SaveSearchDictionaryDraftInput = {
  expectedCurrentVersion: number;
  expectedDraftRevision?: number;
  definition: unknown;
  contentHash: string;
  actorId: string;
};

export type PublishSearchDictionaryDraftInput = {
  expectedCurrentVersion: number;
  expectedDraftRevision: number;
  reviewerId: string;
  publishedAt?: Date;
};

export type RollbackSearchDictionaryInput = {
  expectedCurrentVersion: number;
  targetVersion: number;
  actorId: string;
};

export type RecordSearchQuerySampleInput = {
  queryHash: string;
  sourceHash: string;
  queryText: string;
  locale: "zh-Hans" | "en-US";
  regionCode?: string;
  createdAt: Date;
  expiresAt: Date;
};

export type PrivacySafeQuery = {
  queryText: string;
  sourceCount: number;
  lastSeenAt: Date;
};

export type FindPrivacySafeQueriesInput = {
  locale: "zh-Hans" | "en-US";
  regionCode?: string;
  prefix?: string;
  since: Date;
  now: Date;
  minimumSources?: number;
  limit: number;
};

const dictionarySelect = {
  id: true,
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
} satisfies Prisma.SearchDictionaryVersionSelect;

type SelectedDictionary = Prisma.SearchDictionaryVersionGetPayload<{
  select: typeof dictionarySelect;
}>;

function mapDictionary(row: SelectedDictionary | SearchDictionaryVersion): SearchDictionaryRecord {
  return {
    id: row.id,
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
  target: PrismaClient | Prisma.TransactionClient | SearchDiscoveryRepositoryOptions,
): target is SearchDiscoveryRepositoryOptions {
  return "connectionString" in target;
}

function asJsonInput(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function escapeLikePrefix(value: string): string {
  return `${value.replace(/[\\%_]/g, "\\$&")}%`;
}

async function lockDictionary(
  transaction: Prisma.TransactionClient,
): Promise<{ currentVersion: number }> {
  const rows = await transaction.$queryRaw<Array<{ currentVersion: number }>>(
    Prisma.sql`
      SELECT "current_version" AS "currentVersion"
      FROM "search_dictionary_states"
      WHERE "id" = ${dictionaryId}
      FOR UPDATE
    `,
  );
  const state = rows[0];
  if (!state) throw new Error("Search dictionary state is missing");
  return state;
}

export class SearchDiscoveryRepository {
  readonly #client: PrismaClient | Prisma.TransactionClient;
  readonly #ownedClient: PrismaClient | null;

  constructor(target: PrismaClient | Prisma.TransactionClient | SearchDiscoveryRepositoryOptions) {
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

  async getPublished(version?: number): Promise<SearchDictionaryRecord | null> {
    const state = await this.#client.searchDictionaryState.findUnique({
      where: { id: dictionaryId },
      select: { currentVersion: true },
    });
    const selectedVersion = version ?? state?.currentVersion ?? 0;
    if (selectedVersion < 1) return null;
    const row = await this.#client.searchDictionaryVersion.findUnique({
      where: {
        dictionaryId_version: {
          dictionaryId,
          version: selectedVersion,
        },
      },
      select: dictionarySelect,
    });
    return row?.publishedAt ? mapDictionary(row) : null;
  }

  async getLifecycle(): Promise<SearchDictionaryLifecycle> {
    const state = await this.#client.searchDictionaryState.findUniqueOrThrow({
      where: { id: dictionaryId },
      select: {
        currentVersion: true,
        versions: {
          orderBy: { version: "asc" },
          select: dictionarySelect,
        },
      },
    });
    const versions = state.versions.map(mapDictionary);
    return {
      currentVersion: state.currentVersion,
      draft: versions.find((version) => version.publishedAt === null) ?? null,
      published: versions.filter((version) => version.publishedAt !== null),
    };
  }

  saveDraft(input: SaveSearchDictionaryDraftInput): Promise<SearchDictionaryMutationResult> {
    return this.#inTransaction(async (transaction) => {
      const state = await lockDictionary(transaction);
      if (state.currentVersion !== input.expectedCurrentVersion) {
        return {
          kind: "current_version_conflict",
          currentVersion: state.currentVersion,
        };
      }
      const nextVersion = state.currentVersion + 1;
      const existing = await transaction.searchDictionaryVersion.findFirst({
        where: { dictionaryId, publishedAt: null },
        select: dictionarySelect,
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
        const updated = await transaction.searchDictionaryVersion.update({
          where: { id: existing.id },
          data: {
            definition: asJsonInput(input.definition),
            contentHash: input.contentHash,
            revision: { increment: 1 },
            updatedById: input.actorId,
          },
          select: dictionarySelect,
        });
        return { kind: "ok", dictionary: mapDictionary(updated) };
      }
      if (input.expectedDraftRevision !== undefined) {
        return { kind: "draft_revision_conflict" };
      }
      const created = await transaction.searchDictionaryVersion.create({
        data: {
          dictionaryId,
          version: nextVersion,
          definition: asJsonInput(input.definition),
          contentHash: input.contentHash,
          createdById: input.actorId,
          updatedById: input.actorId,
        },
        select: dictionarySelect,
      });
      return { kind: "ok", dictionary: mapDictionary(created) };
    });
  }

  publishDraft(input: PublishSearchDictionaryDraftInput): Promise<SearchDictionaryMutationResult> {
    return this.#inTransaction(async (transaction) => {
      const state = await lockDictionary(transaction);
      if (state.currentVersion !== input.expectedCurrentVersion) {
        return {
          kind: "current_version_conflict",
          currentVersion: state.currentVersion,
        };
      }
      const draft = await transaction.searchDictionaryVersion.findFirst({
        where: { dictionaryId, publishedAt: null },
        select: dictionarySelect,
      });
      if (!draft || draft.version !== state.currentVersion + 1) {
        return { kind: "draft_missing" };
      }
      if (draft.revision !== input.expectedDraftRevision) {
        return {
          kind: "draft_revision_conflict",
          currentDraftRevision: draft.revision,
        };
      }
      if (draft.updatedById === input.reviewerId) {
        return { kind: "review_required" };
      }
      const publishedAt = input.publishedAt ?? new Date();
      const published = await transaction.searchDictionaryVersion.update({
        where: { id: draft.id },
        data: {
          publishedAt,
          publishedById: input.reviewerId,
        },
        select: dictionarySelect,
      });
      await transaction.searchDictionaryState.update({
        where: { id: dictionaryId },
        data: { currentVersion: draft.version, updatedAt: publishedAt },
      });
      return { kind: "ok", dictionary: mapDictionary(published) };
    });
  }

  rollback(input: RollbackSearchDictionaryInput): Promise<SearchDictionaryMutationResult> {
    return this.#inTransaction(async (transaction) => {
      const state = await lockDictionary(transaction);
      if (state.currentVersion !== input.expectedCurrentVersion) {
        return {
          kind: "current_version_conflict",
          currentVersion: state.currentVersion,
        };
      }
      const existingDraft = await transaction.searchDictionaryVersion.findFirst({
        where: { dictionaryId, publishedAt: null },
        select: { revision: true },
      });
      if (existingDraft) {
        return {
          kind: "draft_revision_conflict",
          currentDraftRevision: existingDraft.revision,
        };
      }
      const target = await transaction.searchDictionaryVersion.findUnique({
        where: {
          dictionaryId_version: {
            dictionaryId,
            version: input.targetVersion,
          },
        },
        select: dictionarySelect,
      });
      if (!target?.publishedAt) return { kind: "target_missing" };
      const nextVersion = state.currentVersion + 1;
      const created = await transaction.searchDictionaryVersion.create({
        data: {
          dictionaryId,
          version: nextVersion,
          definition: asJsonInput(target.definition),
          contentHash: target.contentHash,
          basedOnVersion: target.version,
          createdById: input.actorId,
          updatedById: input.actorId,
        },
        select: dictionarySelect,
      });
      return { kind: "ok", dictionary: mapDictionary(created) };
    });
  }

  async recordQuerySample(input: RecordSearchQuerySampleInput): Promise<"recorded" | "duplicate"> {
    const result = await this.#client.searchQuerySample.createMany({
      data: [
        {
          queryHash: input.queryHash,
          sourceHash: input.sourceHash,
          queryText: input.queryText,
          locale: input.locale,
          regionCode: input.regionCode,
          windowDate: new Date(
            Date.UTC(
              input.createdAt.getUTCFullYear(),
              input.createdAt.getUTCMonth(),
              input.createdAt.getUTCDate(),
            ),
          ),
          createdAt: input.createdAt,
          expiresAt: input.expiresAt,
        },
      ],
      skipDuplicates: true,
    });
    return result.count === 1 ? "recorded" : "duplicate";
  }

  findPrivacySafeQueries(input: FindPrivacySafeQueriesInput): Promise<PrivacySafeQuery[]> {
    const threshold = Math.max(minimumPublicSources, input.minimumSources ?? minimumPublicSources);
    const prefixCondition =
      input.prefix === undefined
        ? Prisma.empty
        : Prisma.sql`
            AND LOWER("query_text") LIKE LOWER(${escapeLikePrefix(input.prefix)}) ESCAPE '\'
          `;
    const regionCondition =
      input.regionCode === undefined
        ? Prisma.empty
        : Prisma.sql`AND "region_code" = ${input.regionCode}`;
    return this.#client
      .$queryRaw<Array<{ queryText: string; sourceCount: bigint; lastSeenAt: Date }>>(
        Prisma.sql`
          SELECT
            MIN("query_text") AS "queryText",
            COUNT(DISTINCT "source_hash") AS "sourceCount",
            MAX("created_at") AS "lastSeenAt"
          FROM "search_query_samples"
          WHERE "locale" = ${input.locale}
            AND "created_at" >= ${input.since}
            AND "created_at" <= ${input.now}
            AND "expires_at" > ${input.now}
            ${regionCondition}
            ${prefixCondition}
          GROUP BY "query_hash"
          HAVING COUNT(DISTINCT "source_hash") >= ${threshold}
          ORDER BY
            COUNT(DISTINCT "source_hash") DESC,
            MAX("created_at") DESC,
            MIN("query_text") ASC
          LIMIT ${input.limit}
        `,
      )
      .then((rows) =>
        rows.map((row) => ({
          queryText: row.queryText,
          sourceCount: Number(row.sourceCount),
          lastSeenAt: row.lastSeenAt,
        })),
      );
  }

  async pruneExpiredSamples(input: { now: Date; limit: number }): Promise<number> {
    const rows = await this.#client.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`
        WITH expired AS (
          SELECT "id"
          FROM "search_query_samples"
          WHERE "expires_at" <= ${input.now}
          ORDER BY "expires_at" ASC, "id" ASC
          LIMIT ${input.limit}
          FOR UPDATE SKIP LOCKED
        )
        DELETE FROM "search_query_samples" AS samples
        USING expired
        WHERE samples."id" = expired."id"
        RETURNING samples."id"
      `,
    );
    return rows.length;
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
