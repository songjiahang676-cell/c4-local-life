import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  AdminJobStatus,
  AdminJobType,
  Prisma,
  PrismaClient,
  SearchIndexOperationPhase,
} from "../../generated/prisma/client";

export type SearchIndexOperationRepositoryOptions = {
  connectionString: string;
  poolMaximum?: number;
};

export type CreateSearchIndexRebuildInput = {
  actorUserId: string;
  idempotencyKey: string;
  requestHash: string;
  requestId: string;
  reasonCode: string;
  ticketRef?: string;
  schemaVersion: number;
  rollbackWindowHours: number;
  occurredAt: Date;
};

export type CreateSearchIndexRollbackInput = Omit<
  CreateSearchIndexRebuildInput,
  "schemaVersion" | "rollbackWindowHours"
> & {
  parentOperationId: string;
};

export type SearchIndexOperationProjection = {
  id: string;
  jobId: string;
  parentOperationId: string | null;
  type: "SEARCH_INDEX_REBUILD" | "SEARCH_INDEX_ROLLBACK";
  jobStatus: "PENDING" | "RUNNING" | "SUCCEEDED" | "PARTIAL" | "FAILED";
  phase:
    | "PENDING"
    | "BACKFILLING"
    | "CATCHING_UP"
    | "VALIDATING"
    | "SWITCHING"
    | "OBSERVING"
    | "SUCCEEDED"
    | "FAILED"
    | "ROLLED_BACK";
  schemaVersion: number;
  sourceIndex: string | null;
  targetIndex: string | null;
  scanCursor: string | null;
  rollbackWindowHours: number;
  canonicalCount: number | null;
  targetCount: number | null;
  canonicalDigest: string | null;
  targetDigest: string | null;
  aliasSwitchedAt: Date | null;
  rollbackUntil: Date | null;
  rolledBackAt: Date | null;
  failureCode: string | null;
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
};

export type CreateSearchIndexOperationResult =
  | { kind: "created" | "exact_retry"; operation: SearchIndexOperationProjection }
  | { kind: "idempotency_conflict" }
  | { kind: "active_operation" }
  | { kind: "rollback_unavailable" };

export type ClaimedSearchIndexOperation = SearchIndexOperationProjection & {
  actorUserId: string;
  reasonCode: string;
  ticketRef: string | null;
  leaseExpiresAt: Date;
};

type SearchIndexOperationClient = PrismaClient | Prisma.TransactionClient;

const operationProjectionSelect = {
  id: true,
  jobId: true,
  parentOperationId: true,
  phase: true,
  schemaVersion: true,
  sourceIndex: true,
  targetIndex: true,
  scanCursor: true,
  rollbackWindowHours: true,
  canonicalCount: true,
  targetCount: true,
  canonicalDigest: true,
  targetDigest: true,
  aliasSwitchedAt: true,
  rollbackUntil: true,
  rolledBackAt: true,
  failureCode: true,
  createdAt: true,
  job: {
    select: {
      type: true,
      status: true,
      startedAt: true,
      completedAt: true,
    },
  },
} as const;

type SelectedOperation = Prisma.SearchIndexOperationGetPayload<{
  select: typeof operationProjectionSelect;
}>;

function isRepositoryOptions(
  target: SearchIndexOperationClient | SearchIndexOperationRepositoryOptions,
): target is SearchIndexOperationRepositoryOptions {
  return "connectionString" in target;
}

function assertBoundedInteger(value: number, minimum: number, maximum: number, name: string): void {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
}

function boundedCode(value: string, fallback: string): string {
  const normalized = value.trim().toUpperCase();
  return /^[A-Z][A-Z0-9_.-]{1,119}$/.test(normalized) ? normalized : fallback;
}

function mapOperation(row: SelectedOperation): SearchIndexOperationProjection {
  if (
    row.job.type !== AdminJobType.SEARCH_INDEX_REBUILD &&
    row.job.type !== AdminJobType.SEARCH_INDEX_ROLLBACK
  ) {
    throw new Error("Search index operation is attached to an invalid Admin job type");
  }
  return {
    id: row.id,
    jobId: row.jobId,
    parentOperationId: row.parentOperationId,
    type: row.job.type,
    jobStatus: row.job.status,
    phase: row.phase,
    schemaVersion: row.schemaVersion,
    sourceIndex: row.sourceIndex,
    targetIndex: row.targetIndex,
    scanCursor: row.scanCursor,
    rollbackWindowHours: row.rollbackWindowHours,
    canonicalCount: row.canonicalCount,
    targetCount: row.targetCount,
    canonicalDigest: row.canonicalDigest,
    targetDigest: row.targetDigest,
    aliasSwitchedAt: row.aliasSwitchedAt,
    rollbackUntil: row.rollbackUntil,
    rolledBackAt: row.rolledBackAt,
    failureCode: row.failureCode,
    createdAt: row.createdAt,
    startedAt: row.job.startedAt,
    completedAt: row.job.completedAt,
  };
}

async function lockKey(
  transaction: Prisma.TransactionClient,
  actorUserId: string,
  type: AdminJobType,
  idempotencyKey: string,
): Promise<void> {
  await transaction.$executeRaw(Prisma.sql`
    SELECT pg_advisory_xact_lock(
      hashtextextended(
        ${"search-index-admin-job-v1"} || ':' || ${actorUserId} || ':' || ${type}::text || ':' || ${idempotencyKey},
        0
      )
    )
  `);
}

async function lockSearchOperations(transaction: Prisma.TransactionClient): Promise<void> {
  await transaction.$executeRaw(
    Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${"search-index-operation-v1"}, 0))`,
  );
}

export class SearchIndexOperationRepository {
  readonly #client: SearchIndexOperationClient;
  readonly #ownedClient: PrismaClient | null;

  constructor(target: SearchIndexOperationClient | SearchIndexOperationRepositoryOptions) {
    if (isRepositoryOptions(target)) {
      const adapter = new PrismaPg({
        connectionString: target.connectionString,
        max: target.poolMaximum ?? 10,
        connectionTimeoutMillis: 5_000,
        idleTimeoutMillis: 30_000,
      });
      this.#ownedClient = new PrismaClient({ adapter });
      this.#client = this.#ownedClient;
    } else {
      this.#client = target;
      this.#ownedClient = null;
    }
  }

  async createRebuild(
    input: CreateSearchIndexRebuildInput,
  ): Promise<CreateSearchIndexOperationResult> {
    assertBoundedInteger(input.schemaVersion, 1, 10_000, "schemaVersion");
    assertBoundedInteger(input.rollbackWindowHours, 1, 168, "rollbackWindowHours");
    return this.#transaction(async (transaction) => {
      await lockKey(
        transaction,
        input.actorUserId,
        AdminJobType.SEARCH_INDEX_REBUILD,
        input.idempotencyKey,
      );
      const prior = await transaction.adminJob.findUnique({
        where: {
          actorId_type_idempotencyKey: {
            actorId: input.actorUserId,
            type: AdminJobType.SEARCH_INDEX_REBUILD,
            idempotencyKey: input.idempotencyKey,
          },
        },
        select: { requestHash: true, searchOperation: { select: operationProjectionSelect } },
      });
      if (prior) {
        return prior.requestHash === input.requestHash && prior.searchOperation
          ? { kind: "exact_retry" as const, operation: mapOperation(prior.searchOperation) }
          : { kind: "idempotency_conflict" as const };
      }

      await lockSearchOperations(transaction);
      const active = await transaction.searchIndexOperation.findFirst({
        where: {
          OR: [
            {
              phase: {
                in: [
                  SearchIndexOperationPhase.PENDING,
                  SearchIndexOperationPhase.BACKFILLING,
                  SearchIndexOperationPhase.CATCHING_UP,
                  SearchIndexOperationPhase.VALIDATING,
                  SearchIndexOperationPhase.SWITCHING,
                ],
              },
            },
            { phase: SearchIndexOperationPhase.OBSERVING, rollbackUntil: { gt: input.occurredAt } },
          ],
        },
        select: { id: true },
      });
      if (active) return { kind: "active_operation" as const };

      const jobId = randomUUID();
      const operationId = randomUUID();
      await transaction.adminJob.create({
        data: {
          id: jobId,
          type: AdminJobType.SEARCH_INDEX_REBUILD,
          actorId: input.actorUserId,
          idempotencyKey: input.idempotencyKey,
          requestHash: input.requestHash,
          reasonCode: input.reasonCode,
          ticketRef: input.ticketRef,
          availableAt: input.occurredAt,
          createdAt: input.occurredAt,
          updatedAt: input.occurredAt,
        },
      });
      const operation = await transaction.searchIndexOperation.create({
        data: {
          id: operationId,
          jobId,
          schemaVersion: input.schemaVersion,
          rollbackWindowHours: input.rollbackWindowHours,
          createdAt: input.occurredAt,
          updatedAt: input.occurredAt,
        },
        select: operationProjectionSelect,
      });
      await transaction.auditLog.create({
        data: {
          actorId: input.actorUserId,
          actorType: "PLATFORM_ADMIN",
          action: "SEARCH_INDEX_REBUILD_REQUESTED",
          targetType: "SEARCH_INDEX_OPERATION",
          targetId: operationId,
          requestId: input.requestId,
          metadata: {
            reasonCode: input.reasonCode,
            ticketRef: input.ticketRef ?? null,
            schemaVersion: input.schemaVersion,
            rollbackWindowHours: input.rollbackWindowHours,
          },
          createdAt: input.occurredAt,
        },
      });
      return { kind: "created" as const, operation: mapOperation(operation) };
    });
  }

  async createRollback(
    input: CreateSearchIndexRollbackInput,
  ): Promise<CreateSearchIndexOperationResult> {
    return this.#transaction(async (transaction) => {
      await lockKey(
        transaction,
        input.actorUserId,
        AdminJobType.SEARCH_INDEX_ROLLBACK,
        input.idempotencyKey,
      );
      const prior = await transaction.adminJob.findUnique({
        where: {
          actorId_type_idempotencyKey: {
            actorId: input.actorUserId,
            type: AdminJobType.SEARCH_INDEX_ROLLBACK,
            idempotencyKey: input.idempotencyKey,
          },
        },
        select: { requestHash: true, searchOperation: { select: operationProjectionSelect } },
      });
      if (prior) {
        return prior.requestHash === input.requestHash && prior.searchOperation
          ? { kind: "exact_retry" as const, operation: mapOperation(prior.searchOperation) }
          : { kind: "idempotency_conflict" as const };
      }

      await lockSearchOperations(transaction);
      const parent = await transaction.searchIndexOperation.findUnique({
        where: { id: input.parentOperationId },
      });
      if (
        !parent ||
        parent.phase !== SearchIndexOperationPhase.OBSERVING ||
        !parent.rollbackUntil ||
        parent.rollbackUntil <= input.occurredAt ||
        !parent.sourceIndex ||
        !parent.targetIndex ||
        parent.rolledBackAt
      ) {
        return { kind: "rollback_unavailable" as const };
      }
      const activeRollback = await transaction.searchIndexOperation.findFirst({
        where: {
          parentOperationId: parent.id,
          phase: {
            in: [
              SearchIndexOperationPhase.PENDING,
              SearchIndexOperationPhase.VALIDATING,
              SearchIndexOperationPhase.SWITCHING,
              SearchIndexOperationPhase.SUCCEEDED,
            ],
          },
        },
        select: { id: true },
      });
      if (activeRollback) return { kind: "active_operation" as const };

      const jobId = randomUUID();
      const operationId = randomUUID();
      await transaction.adminJob.create({
        data: {
          id: jobId,
          type: AdminJobType.SEARCH_INDEX_ROLLBACK,
          actorId: input.actorUserId,
          idempotencyKey: input.idempotencyKey,
          requestHash: input.requestHash,
          reasonCode: input.reasonCode,
          ticketRef: input.ticketRef,
          availableAt: input.occurredAt,
          createdAt: input.occurredAt,
          updatedAt: input.occurredAt,
        },
      });
      const operation = await transaction.searchIndexOperation.create({
        data: {
          id: operationId,
          jobId,
          parentOperationId: parent.id,
          schemaVersion: parent.schemaVersion,
          sourceIndex: parent.targetIndex,
          targetIndex: parent.sourceIndex,
          rollbackWindowHours: parent.rollbackWindowHours,
          createdAt: input.occurredAt,
          updatedAt: input.occurredAt,
        },
        select: operationProjectionSelect,
      });
      await transaction.auditLog.create({
        data: {
          actorId: input.actorUserId,
          actorType: "PLATFORM_ADMIN",
          action: "SEARCH_INDEX_ROLLBACK_REQUESTED",
          targetType: "SEARCH_INDEX_OPERATION",
          targetId: operationId,
          requestId: input.requestId,
          metadata: {
            reasonCode: input.reasonCode,
            ticketRef: input.ticketRef ?? null,
            parentOperationId: parent.id,
          },
          createdAt: input.occurredAt,
        },
      });
      return { kind: "created" as const, operation: mapOperation(operation) };
    });
  }

  async getOperation(operationId: string): Promise<SearchIndexOperationProjection | null> {
    const operation = await this.#client.searchIndexOperation.findUnique({
      where: { id: operationId },
      select: operationProjectionSelect,
    });
    return operation ? mapOperation(operation) : null;
  }

  async claimOperation(input: {
    now: Date;
    leaseSeconds: number;
  }): Promise<ClaimedSearchIndexOperation | null> {
    assertBoundedInteger(input.leaseSeconds, 1, 3_600, "leaseSeconds");
    const leaseExpiresAt = new Date(input.now.getTime() + input.leaseSeconds * 1_000);
    const rows = await this.#client.$queryRaw<Array<{ jobId: string }>>(Prisma.sql`
      WITH candidate AS (
        SELECT job."id"
        FROM "admin_jobs" job
        INNER JOIN "search_index_operations" operation ON operation."job_id" = job."id"
        WHERE job."type" IN (
          'SEARCH_INDEX_REBUILD'::"AdminJobType",
          'SEARCH_INDEX_ROLLBACK'::"AdminJobType"
        )
        AND (
          (job."status" = 'PENDING'::"AdminJobStatus" AND job."available_at" <= ${input.now})
          OR (job."status" = 'RUNNING'::"AdminJobStatus" AND job."lease_expires_at" < ${input.now})
        )
        ORDER BY job."available_at" ASC, job."id" ASC
        FOR UPDATE OF job SKIP LOCKED
        LIMIT 1
      )
      UPDATE "admin_jobs" job
      SET
        "status" = 'RUNNING'::"AdminJobStatus",
        "started_at" = COALESCE(job."started_at", ${input.now}),
        "lease_expires_at" = ${leaseExpiresAt},
        "updated_at" = ${input.now}
      FROM candidate
      WHERE job."id" = candidate."id"
      RETURNING job."id" AS "jobId"
    `);
    const jobId = rows[0]?.jobId;
    if (!jobId) return null;
    const operation = await this.#client.searchIndexOperation.findUnique({
      where: { jobId },
      select: {
        ...operationProjectionSelect,
        job: {
          select: {
            ...operationProjectionSelect.job.select,
            actorId: true,
            reasonCode: true,
            ticketRef: true,
          },
        },
      },
    });
    if (!operation) return null;
    return {
      ...mapOperation(operation),
      actorUserId: operation.job.actorId,
      reasonCode: operation.job.reasonCode,
      ticketRef: operation.job.ticketRef,
      leaseExpiresAt,
    };
  }

  async prepareRebuild(input: {
    jobId: string;
    leaseExpiresAt: Date;
    sourceIndex: string;
    targetIndex: string;
    occurredAt: Date;
  }): Promise<boolean> {
    return this.#advance({
      jobId: input.jobId,
      leaseExpiresAt: input.leaseExpiresAt,
      expectedPhase: SearchIndexOperationPhase.PENDING,
      nextPhase: SearchIndexOperationPhase.BACKFILLING,
      data: { sourceIndex: input.sourceIndex, targetIndex: input.targetIndex },
      occurredAt: input.occurredAt,
    });
  }

  async advanceScan(input: {
    jobId: string;
    leaseExpiresAt: Date;
    expectedPhase: "BACKFILLING" | "CATCHING_UP";
    nextPhase: "BACKFILLING" | "CATCHING_UP" | "VALIDATING";
    scanCursor: string | null;
    occurredAt: Date;
  }): Promise<boolean> {
    return this.#advance({
      ...input,
      expectedPhase: input.expectedPhase as SearchIndexOperationPhase,
      nextPhase: input.nextPhase as SearchIndexOperationPhase,
      data: { scanCursor: input.scanCursor },
    });
  }

  async advancePhase(input: {
    jobId: string;
    leaseExpiresAt: Date;
    expectedPhase: "PENDING" | "VALIDATING";
    nextPhase: "VALIDATING" | "SWITCHING";
    validation?: {
      canonicalCount: number;
      targetCount: number;
      canonicalDigest: string;
      targetDigest: string;
    };
    occurredAt: Date;
  }): Promise<boolean> {
    return this.#advance({
      ...input,
      expectedPhase: input.expectedPhase as SearchIndexOperationPhase,
      nextPhase: input.nextPhase as SearchIndexOperationPhase,
      data: input.validation ?? {},
    });
  }

  async completeRebuild(input: {
    jobId: string;
    leaseExpiresAt: Date;
    aliasSwitchedAt: Date;
    rollbackUntil: Date;
    canonicalCount: number;
  }): Promise<boolean> {
    return this.#transaction(async (transaction) => {
      const operation = await transaction.searchIndexOperation.updateMany({
        where: {
          jobId: input.jobId,
          phase: SearchIndexOperationPhase.SWITCHING,
        },
        data: {
          phase: SearchIndexOperationPhase.OBSERVING,
          aliasSwitchedAt: input.aliasSwitchedAt,
          rollbackUntil: input.rollbackUntil,
          updatedAt: input.aliasSwitchedAt,
        },
      });
      if (operation.count !== 1) return false;
      const job = await transaction.adminJob.updateMany({
        where: {
          id: input.jobId,
          status: AdminJobStatus.RUNNING,
          leaseExpiresAt: input.leaseExpiresAt,
        },
        data: {
          status: AdminJobStatus.SUCCEEDED,
          estimatedItems: input.canonicalCount,
          processedItems: input.canonicalCount,
          succeededItems: input.canonicalCount,
          completedAt: input.aliasSwitchedAt,
          leaseExpiresAt: null,
          updatedAt: input.aliasSwitchedAt,
        },
      });
      if (job.count !== 1) throw new Error("Search rebuild lease was lost");
      await transaction.auditLog.create({
        data: {
          actorType: "SYSTEM",
          action: "SEARCH_INDEX_ALIAS_SWITCHED",
          targetType: "ADMIN_JOB",
          targetId: input.jobId,
          metadata: {
            canonicalCount: input.canonicalCount,
            rollbackUntil: input.rollbackUntil.toISOString(),
          },
          createdAt: input.aliasSwitchedAt,
        },
      });
      return true;
    });
  }

  async completeRollback(input: {
    jobId: string;
    leaseExpiresAt: Date;
    aliasSwitchedAt: Date;
    canonicalCount: number;
  }): Promise<boolean> {
    return this.#transaction(async (transaction) => {
      const operation = await transaction.searchIndexOperation.findUnique({
        where: { jobId: input.jobId },
        select: { id: true, parentOperationId: true, phase: true },
      });
      if (
        !operation?.parentOperationId ||
        operation.phase !== SearchIndexOperationPhase.SWITCHING
      ) {
        return false;
      }
      await transaction.searchIndexOperation.update({
        where: { id: operation.id },
        data: {
          phase: SearchIndexOperationPhase.SUCCEEDED,
          aliasSwitchedAt: input.aliasSwitchedAt,
          updatedAt: input.aliasSwitchedAt,
        },
      });
      const parent = await transaction.searchIndexOperation.updateMany({
        where: {
          id: operation.parentOperationId,
          phase: {
            in: [SearchIndexOperationPhase.OBSERVING, SearchIndexOperationPhase.SUCCEEDED],
          },
        },
        data: {
          phase: SearchIndexOperationPhase.ROLLED_BACK,
          rolledBackAt: input.aliasSwitchedAt,
          updatedAt: input.aliasSwitchedAt,
        },
      });
      if (parent.count !== 1) throw new Error("Search rollback parent state was lost");
      const job = await transaction.adminJob.updateMany({
        where: {
          id: input.jobId,
          status: AdminJobStatus.RUNNING,
          leaseExpiresAt: input.leaseExpiresAt,
        },
        data: {
          status: AdminJobStatus.SUCCEEDED,
          estimatedItems: input.canonicalCount,
          processedItems: input.canonicalCount,
          succeededItems: input.canonicalCount,
          completedAt: input.aliasSwitchedAt,
          leaseExpiresAt: null,
          updatedAt: input.aliasSwitchedAt,
        },
      });
      if (job.count !== 1) throw new Error("Search rollback lease was lost");
      await transaction.auditLog.create({
        data: {
          actorType: "SYSTEM",
          action: "SEARCH_INDEX_ALIAS_ROLLED_BACK",
          targetType: "ADMIN_JOB",
          targetId: input.jobId,
          metadata: { canonicalCount: input.canonicalCount },
          createdAt: input.aliasSwitchedAt,
        },
      });
      return true;
    });
  }

  async failOperation(input: {
    jobId: string;
    leaseExpiresAt: Date;
    failureCode: string;
    occurredAt: Date;
  }): Promise<boolean> {
    const failureCode = boundedCode(input.failureCode, "SEARCH_INDEX_OPERATION_FAILED");
    return this.#transaction(async (transaction) => {
      const operation = await transaction.searchIndexOperation.updateMany({
        where: {
          jobId: input.jobId,
          phase: {
            in: [
              SearchIndexOperationPhase.PENDING,
              SearchIndexOperationPhase.BACKFILLING,
              SearchIndexOperationPhase.CATCHING_UP,
              SearchIndexOperationPhase.VALIDATING,
              SearchIndexOperationPhase.SWITCHING,
            ],
          },
        },
        data: {
          phase: SearchIndexOperationPhase.FAILED,
          failureCode,
          updatedAt: input.occurredAt,
        },
      });
      if (operation.count !== 1) return false;
      const job = await transaction.adminJob.updateMany({
        where: {
          id: input.jobId,
          status: AdminJobStatus.RUNNING,
          leaseExpiresAt: input.leaseExpiresAt,
        },
        data: {
          status: AdminJobStatus.FAILED,
          estimatedItems: 1,
          processedItems: 1,
          failedItems: 1,
          completedAt: input.occurredAt,
          leaseExpiresAt: null,
          updatedAt: input.occurredAt,
        },
      });
      if (job.count !== 1) throw new Error("Search operation lease was lost");
      await transaction.auditLog.create({
        data: {
          actorType: "SYSTEM",
          action: "SEARCH_INDEX_OPERATION_FAILED",
          targetType: "ADMIN_JOB",
          targetId: input.jobId,
          metadata: { failureCode },
          createdAt: input.occurredAt,
        },
      });
      return true;
    });
  }

  async listSecondaryWriteTargets(now: Date): Promise<string[]> {
    const operations = await this.#client.searchIndexOperation.findMany({
      where: {
        OR: [
          {
            phase: {
              in: [
                SearchIndexOperationPhase.BACKFILLING,
                SearchIndexOperationPhase.CATCHING_UP,
                SearchIndexOperationPhase.VALIDATING,
                SearchIndexOperationPhase.SWITCHING,
              ],
            },
            targetIndex: { not: null },
            parentOperationId: null,
          },
          {
            phase: SearchIndexOperationPhase.OBSERVING,
            rollbackUntil: { gt: now },
            sourceIndex: { not: null },
          },
          {
            parentOperationId: { not: null },
            phase: {
              in: [
                SearchIndexOperationPhase.PENDING,
                SearchIndexOperationPhase.VALIDATING,
                SearchIndexOperationPhase.SWITCHING,
              ],
            },
            targetIndex: { not: null },
          },
        ],
      },
      select: { phase: true, parentOperationId: true, sourceIndex: true, targetIndex: true },
    });
    return [
      ...new Set(
        operations.flatMap((operation) => {
          if (operation.parentOperationId !== null) {
            return operation.targetIndex ? [operation.targetIndex] : [];
          }
          if (operation.phase === SearchIndexOperationPhase.OBSERVING) {
            return operation.sourceIndex ? [operation.sourceIndex] : [];
          }
          if (operation.phase === SearchIndexOperationPhase.SWITCHING) {
            return [operation.sourceIndex, operation.targetIndex].filter(
              (target): target is string => target !== null,
            );
          }
          return operation.targetIndex ? [operation.targetIndex] : [];
        }),
      ),
    ].sort();
  }

  async closeExpiredObservationWindows(now: Date): Promise<number> {
    const result = await this.#client.searchIndexOperation.updateMany({
      where: {
        phase: SearchIndexOperationPhase.OBSERVING,
        rollbackUntil: { lte: now },
      },
      data: { phase: SearchIndexOperationPhase.SUCCEEDED, updatedAt: now },
    });
    return result.count;
  }

  async close(): Promise<void> {
    await (this.#ownedClient?.$disconnect() ?? Promise.resolve());
  }

  async #advance(input: {
    jobId: string;
    leaseExpiresAt: Date;
    expectedPhase: SearchIndexOperationPhase;
    nextPhase: SearchIndexOperationPhase;
    data: Prisma.SearchIndexOperationUpdateManyMutationInput;
    occurredAt: Date;
  }): Promise<boolean> {
    return this.#transaction(async (transaction) => {
      const operation = await transaction.searchIndexOperation.updateMany({
        where: { jobId: input.jobId, phase: input.expectedPhase },
        data: { ...input.data, phase: input.nextPhase, updatedAt: input.occurredAt },
      });
      if (operation.count !== 1) return false;
      const job = await transaction.adminJob.updateMany({
        where: {
          id: input.jobId,
          status: AdminJobStatus.RUNNING,
          leaseExpiresAt: input.leaseExpiresAt,
        },
        data: {
          status: AdminJobStatus.RUNNING,
          leaseExpiresAt: new Date(input.occurredAt.getTime() - 1),
          updatedAt: input.occurredAt,
        },
      });
      if (job.count !== 1) throw new Error("Search operation lease was lost");
      return true;
    });
  }

  async #transaction<T>(
    operation: (transaction: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    if ("$transaction" in this.#client) {
      return this.#client.$transaction(operation, { maxWait: 5_000, timeout: 15_000 });
    }
    return operation(this.#client);
  }
}
