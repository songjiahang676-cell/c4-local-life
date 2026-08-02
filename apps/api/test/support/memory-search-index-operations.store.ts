import type {
  CreateSearchIndexOperationResult,
  CreateSearchIndexRebuildInput,
  CreateSearchIndexRollbackInput,
  SearchIndexOperationProjection,
  SearchIndexOperationsStore,
} from "../../src/modules/admin/search-index-operations.store";

export const memorySearchRebuildId = "41000000-0000-4000-8000-000000000101";
export const memorySearchRollbackId = "41000000-0000-4000-8000-000000000102";

export class MemorySearchIndexOperationsStore implements SearchIndexOperationsStore {
  readonly rebuildInputs: CreateSearchIndexRebuildInput[] = [];
  readonly rollbackInputs: CreateSearchIndexRollbackInput[] = [];
  readonly #operations = new Map<string, SearchIndexOperationProjection>();
  readonly #idempotency = new Map<string, { requestHash: string; operationId: string }>();

  createRebuild(input: CreateSearchIndexRebuildInput): Promise<CreateSearchIndexOperationResult> {
    this.rebuildInputs.push(input);
    const retry = this.#retry(input.actorUserId, "SEARCH_INDEX_REBUILD", input);
    if (retry) return Promise.resolve(retry);
    const active = [...this.#operations.values()].some((operation) =>
      ["PENDING", "BACKFILLING", "CATCHING_UP", "VALIDATING", "SWITCHING", "OBSERVING"].includes(
        operation.phase,
      ),
    );
    if (active) return Promise.resolve({ kind: "active_operation" });
    const operation = this.#operation({
      id: memorySearchRebuildId,
      jobId: "41000000-0000-4000-8000-000000000201",
      type: "SEARCH_INDEX_REBUILD",
      schemaVersion: input.schemaVersion,
      rollbackWindowHours: input.rollbackWindowHours,
      createdAt: input.occurredAt,
    });
    this.#remember(input.actorUserId, operation.type, input, operation);
    return Promise.resolve({ kind: "created", operation });
  }

  createRollback(input: CreateSearchIndexRollbackInput): Promise<CreateSearchIndexOperationResult> {
    this.rollbackInputs.push(input);
    const retry = this.#retry(input.actorUserId, "SEARCH_INDEX_ROLLBACK", input);
    if (retry) return Promise.resolve(retry);
    const parent = this.#operations.get(input.parentOperationId);
    if (
      !parent ||
      parent.phase !== "OBSERVING" ||
      !parent.rollbackUntil ||
      parent.rollbackUntil <= input.occurredAt ||
      !parent.sourceIndex ||
      !parent.targetIndex
    ) {
      return Promise.resolve({ kind: "rollback_unavailable" });
    }
    const operation = this.#operation({
      id: memorySearchRollbackId,
      jobId: "41000000-0000-4000-8000-000000000202",
      parentOperationId: parent.id,
      type: "SEARCH_INDEX_ROLLBACK",
      schemaVersion: parent.schemaVersion,
      rollbackWindowHours: parent.rollbackWindowHours,
      sourceIndex: parent.targetIndex,
      targetIndex: parent.sourceIndex,
      createdAt: input.occurredAt,
    });
    this.#remember(input.actorUserId, operation.type, input, operation);
    return Promise.resolve({ kind: "created", operation });
  }

  getOperation(operationId: string): Promise<SearchIndexOperationProjection | null> {
    return Promise.resolve(this.#operations.get(operationId) ?? null);
  }

  markObserving(operationId: string, now = new Date()): void {
    const operation = this.#operations.get(operationId);
    if (!operation) throw new Error("Synthetic search operation was not found");
    this.#operations.set(operationId, {
      ...operation,
      jobStatus: "SUCCEEDED",
      phase: "OBSERVING",
      sourceIndex: "socal_test_listings_v1",
      targetIndex: "socal_test_listings_v1_r4100000000004000",
      aliasSwitchedAt: now,
      rollbackUntil: new Date(now.getTime() + 3_600_000),
      completedAt: now,
    });
  }

  #retry(
    actorUserId: string,
    type: SearchIndexOperationProjection["type"],
    input: { idempotencyKey: string; requestHash: string },
  ): CreateSearchIndexOperationResult | null {
    const prior = this.#idempotency.get(`${actorUserId}:${type}:${input.idempotencyKey}`);
    if (!prior) return null;
    return prior.requestHash === input.requestHash
      ? { kind: "exact_retry", operation: this.#operations.get(prior.operationId)! }
      : { kind: "idempotency_conflict" };
  }

  #remember(
    actorUserId: string,
    type: SearchIndexOperationProjection["type"],
    input: { idempotencyKey: string; requestHash: string },
    operation: SearchIndexOperationProjection,
  ): void {
    this.#operations.set(operation.id, operation);
    this.#idempotency.set(`${actorUserId}:${type}:${input.idempotencyKey}`, {
      requestHash: input.requestHash,
      operationId: operation.id,
    });
  }

  #operation(input: {
    id: string;
    jobId: string;
    parentOperationId?: string;
    type: SearchIndexOperationProjection["type"];
    schemaVersion: number;
    rollbackWindowHours: number;
    sourceIndex?: string;
    targetIndex?: string;
    createdAt: Date;
  }): SearchIndexOperationProjection {
    return {
      id: input.id,
      jobId: input.jobId,
      parentOperationId: input.parentOperationId ?? null,
      type: input.type,
      jobStatus: "PENDING",
      phase: "PENDING",
      schemaVersion: input.schemaVersion,
      sourceIndex: input.sourceIndex ?? null,
      targetIndex: input.targetIndex ?? null,
      scanCursor: null,
      rollbackWindowHours: input.rollbackWindowHours,
      canonicalCount: null,
      targetCount: null,
      canonicalDigest: null,
      targetDigest: null,
      aliasSwitchedAt: null,
      rollbackUntil: null,
      rolledBackAt: null,
      failureCode: null,
      createdAt: input.createdAt,
      startedAt: null,
      completedAt: null,
    };
  }
}
