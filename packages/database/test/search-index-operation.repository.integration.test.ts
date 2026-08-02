import { randomUUID } from "node:crypto";
import { QueueOperationsRepository } from "../src/repositories/queue-operations.repository";
import { SearchIndexOperationRepository } from "../src/repositories/search-index-operation.repository";
import {
  createIntegrationDatabase,
  type IntegrationDatabase,
} from "../src/testing/integration-database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const databaseUrl = process.env.DATABASE_INTEGRATION_URL ?? "";
const integration = describe.skipIf(databaseUrl.length === 0);

integration("SearchIndexOperationRepository with PostgreSQL", () => {
  let database: IntegrationDatabase;

  beforeAll(() => {
    database = createIntegrationDatabase(databaseUrl);
  });

  afterAll(async () => {
    await database?.close();
  });

  it("runs an idempotent rebuild and separately audited rollback state machine", async () => {
    const repository = new SearchIndexOperationRepository(database.client);
    const queueRepository = new QueueOperationsRepository(database.client);
    const actorId = randomUUID();
    const now = new Date("2000-01-01T12:00:00.000Z");
    const sourceIndex = "socal_it_listings_v1";
    const targetIndex = `socal_it_listings_v1_r${randomUUID().replaceAll("-", "").slice(0, 16)}`;
    const jobIds: string[] = [];
    const operationIds: string[] = [];
    try {
      await database.client.user.create({
        data: { id: actorId, email: `${actorId}@example.invalid` },
      });
      const input = {
        actorUserId: actorId,
        idempotencyKey: "search-rebuild-integration-0001",
        requestHash: "a".repeat(64),
        requestId: "search-rebuild-request-1",
        reasonCode: "INDEX_DRIFT_RECOVERY",
        ticketRef: "INC-SEARCH-1",
        schemaVersion: 1,
        rollbackWindowHours: 24,
        occurredAt: now,
      };
      const concurrent = await Promise.all([
        repository.createRebuild(input),
        repository.createRebuild(input),
      ]);
      expect(concurrent.map((result) => result.kind).sort()).toEqual(["created", "exact_retry"]);
      const created = concurrent.find((result) => result.kind === "created");
      if (!created || !("operation" in created)) throw new Error("Expected rebuild operation");
      operationIds.push(created.operation.id);
      jobIds.push(created.operation.jobId);
      await expect(
        repository.createRebuild({ ...input, requestHash: "b".repeat(64) }),
      ).resolves.toEqual({ kind: "idempotency_conflict" });
      await expect(
        repository.createRebuild({
          ...input,
          idempotencyKey: "search-rebuild-integration-0002",
          requestHash: "c".repeat(64),
        }),
      ).resolves.toEqual({ kind: "active_operation" });

      await expect(queueRepository.claimJob({ now, leaseSeconds: 60 })).resolves.toBeNull();
      const prepare = await repository.claimOperation({ now, leaseSeconds: 300 });
      expect(prepare).toMatchObject({ id: created.operation.id, phase: "PENDING" });
      if (!prepare) throw new Error("Expected rebuild prepare claim");
      await expect(
        repository.prepareRebuild({
          jobId: prepare.jobId,
          leaseExpiresAt: prepare.leaseExpiresAt,
          sourceIndex,
          targetIndex,
          occurredAt: now,
        }),
      ).resolves.toBe(true);

      const backfill = await repository.claimOperation({ now, leaseSeconds: 300 });
      if (!backfill) throw new Error("Expected backfill claim");
      await expect(
        repository.advanceScan({
          jobId: backfill.jobId,
          leaseExpiresAt: backfill.leaseExpiresAt,
          expectedPhase: "BACKFILLING",
          nextPhase: "CATCHING_UP",
          scanCursor: null,
          occurredAt: now,
        }),
      ).resolves.toBe(true);
      const catchUp = await repository.claimOperation({ now, leaseSeconds: 300 });
      if (!catchUp) throw new Error("Expected catch-up claim");
      await repository.advanceScan({
        jobId: catchUp.jobId,
        leaseExpiresAt: catchUp.leaseExpiresAt,
        expectedPhase: "CATCHING_UP",
        nextPhase: "VALIDATING",
        scanCursor: null,
        occurredAt: now,
      });
      const validation = await repository.claimOperation({ now, leaseSeconds: 300 });
      if (!validation) throw new Error("Expected validation claim");
      await repository.advancePhase({
        jobId: validation.jobId,
        leaseExpiresAt: validation.leaseExpiresAt,
        expectedPhase: "VALIDATING",
        nextPhase: "SWITCHING",
        validation: {
          canonicalCount: 0,
          targetCount: 0,
          canonicalDigest: "d".repeat(64),
          targetDigest: "d".repeat(64),
        },
        occurredAt: now,
      });
      await expect(repository.listSecondaryWriteTargets(now)).resolves.toEqual([
        sourceIndex,
        targetIndex,
      ]);
      const switching = await repository.claimOperation({ now, leaseSeconds: 300 });
      if (!switching) throw new Error("Expected switch claim");
      const rollbackUntil = new Date(now.getTime() + 86_400_000);
      await expect(
        repository.completeRebuild({
          jobId: switching.jobId,
          leaseExpiresAt: switching.leaseExpiresAt,
          aliasSwitchedAt: now,
          rollbackUntil,
          canonicalCount: 0,
        }),
      ).resolves.toBe(true);
      await expect(repository.listSecondaryWriteTargets(now)).resolves.toEqual([sourceIndex]);

      const rollbackCreated = await repository.createRollback({
        actorUserId: actorId,
        idempotencyKey: "search-rollback-integration-0001",
        requestHash: "e".repeat(64),
        requestId: "search-rollback-request-1",
        reasonCode: "ROLLBACK_DRILL",
        parentOperationId: created.operation.id,
        occurredAt: new Date(now.getTime() + 1_000),
      });
      if (rollbackCreated.kind !== "created") throw new Error("Expected rollback operation");
      operationIds.push(rollbackCreated.operation.id);
      jobIds.push(rollbackCreated.operation.jobId);
      const rollbackPrepare = await repository.claimOperation({
        now: new Date(now.getTime() + 1_000),
        leaseSeconds: 300,
      });
      if (!rollbackPrepare) throw new Error("Expected rollback prepare claim");
      await repository.advancePhase({
        jobId: rollbackPrepare.jobId,
        leaseExpiresAt: rollbackPrepare.leaseExpiresAt,
        expectedPhase: "PENDING",
        nextPhase: "VALIDATING",
        occurredAt: new Date(now.getTime() + 1_000),
      });
      const rollbackValidation = await repository.claimOperation({
        now: new Date(now.getTime() + 1_000),
        leaseSeconds: 300,
      });
      if (!rollbackValidation) throw new Error("Expected rollback validation claim");
      await repository.advancePhase({
        jobId: rollbackValidation.jobId,
        leaseExpiresAt: rollbackValidation.leaseExpiresAt,
        expectedPhase: "VALIDATING",
        nextPhase: "SWITCHING",
        validation: {
          canonicalCount: 0,
          targetCount: 0,
          canonicalDigest: "f".repeat(64),
          targetDigest: "f".repeat(64),
        },
        occurredAt: new Date(now.getTime() + 1_000),
      });
      const rollbackSwitch = await repository.claimOperation({
        now: new Date(now.getTime() + 1_000),
        leaseSeconds: 300,
      });
      if (!rollbackSwitch) throw new Error("Expected rollback switch claim");
      await expect(
        repository.completeRollback({
          jobId: rollbackSwitch.jobId,
          leaseExpiresAt: rollbackSwitch.leaseExpiresAt,
          aliasSwitchedAt: new Date(now.getTime() + 1_000),
          canonicalCount: 0,
        }),
      ).resolves.toBe(true);
      await expect(repository.getOperation(created.operation.id)).resolves.toMatchObject({
        phase: "ROLLED_BACK",
        rolledBackAt: new Date(now.getTime() + 1_000),
      });
      await expect(
        database.client.auditLog.count({
          where: {
            targetId: { in: [...operationIds, ...jobIds] },
            action: {
              in: [
                "SEARCH_INDEX_REBUILD_REQUESTED",
                "SEARCH_INDEX_ALIAS_SWITCHED",
                "SEARCH_INDEX_ROLLBACK_REQUESTED",
                "SEARCH_INDEX_ALIAS_ROLLED_BACK",
              ],
            },
          },
        }),
      ).resolves.toBe(4);
    } finally {
      await database.client.auditLog.deleteMany({
        where: { targetId: { in: [...operationIds, ...jobIds] } },
      });
      await database.client.searchIndexOperation.deleteMany({
        where: { id: { in: operationIds } },
      });
      await database.client.adminJob.deleteMany({ where: { id: { in: jobIds } } });
      await database.client.user.deleteMany({ where: { id: actorId } });
    }
  });
});
