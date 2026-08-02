import { createHash } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import {
  listingSearchIndexSchemaVersion,
  type CreateSearchIndexRebuildRequest,
  type CreateSearchIndexRollbackRequest,
  type SearchIndexOperation,
  type SearchIndexOperationResponse,
} from "@socal/contracts";
import type { PolicyRequestContext } from "../../common/authorization/policy";
import {
  SEARCH_INDEX_OPERATIONS_STORE,
  type SearchIndexOperationProjection,
  type SearchIndexOperationsStore,
} from "./search-index-operations.store";

export class SearchIndexOperationsAccessDeniedError extends Error {}
export class SearchIndexOperationsConflictError extends Error {}
export class SearchIndexOperationsIdempotencyConflictError extends Error {}
export class SearchIndexOperationNotFoundError extends Error {}
export class SearchIndexRollbackUnavailableError extends Error {}

function actorIdentity(context: PolicyRequestContext): { userId: string } {
  if (context.actor.kind === "guest") throw new SearchIndexOperationsAccessDeniedError();
  return { userId: context.actor.userId };
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
    .join(",")}}`;
}

function requestHash(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function mapOperation(operation: SearchIndexOperationProjection): SearchIndexOperation {
  return {
    id: operation.id,
    jobId: operation.jobId,
    parentOperationId: operation.parentOperationId,
    type: operation.type,
    jobStatus: operation.jobStatus,
    phase: operation.phase,
    schemaVersion: operation.schemaVersion,
    sourceIndex: operation.sourceIndex,
    targetIndex: operation.targetIndex,
    rollbackUntil: operation.rollbackUntil?.toISOString() ?? null,
    failureCode: operation.failureCode,
    canonicalCount: operation.canonicalCount,
    targetCount: operation.targetCount,
    createdAt: operation.createdAt.toISOString(),
    startedAt: operation.startedAt?.toISOString() ?? null,
    completedAt: operation.completedAt?.toISOString() ?? null,
  };
}

@Injectable()
export class SearchIndexOperationsService {
  constructor(
    @Inject(SEARCH_INDEX_OPERATIONS_STORE) private readonly store: SearchIndexOperationsStore,
  ) {}

  async createRebuild(
    context: PolicyRequestContext,
    idempotencyKey: string,
    input: CreateSearchIndexRebuildRequest,
    now = new Date(),
  ): Promise<SearchIndexOperationResponse> {
    const actor = actorIdentity(context);
    const result = await this.store.createRebuild({
      actorUserId: actor.userId,
      idempotencyKey,
      requestHash: requestHash(input),
      requestId: context.requestId,
      reasonCode: input.reasonCode,
      ...(input.ticketRef ? { ticketRef: input.ticketRef } : {}),
      schemaVersion: listingSearchIndexSchemaVersion,
      rollbackWindowHours: input.rollbackWindowHours ?? 24,
      occurredAt: now,
    });
    return this.#mapCreateResult(result);
  }

  async createRollback(
    context: PolicyRequestContext,
    idempotencyKey: string,
    parentOperationId: string,
    input: CreateSearchIndexRollbackRequest,
    now = new Date(),
  ): Promise<SearchIndexOperationResponse> {
    const actor = actorIdentity(context);
    const result = await this.store.createRollback({
      actorUserId: actor.userId,
      idempotencyKey,
      requestHash: requestHash({ parentOperationId, ...input }),
      requestId: context.requestId,
      reasonCode: input.reasonCode,
      ...(input.ticketRef ? { ticketRef: input.ticketRef } : {}),
      parentOperationId,
      occurredAt: now,
    });
    return this.#mapCreateResult(result);
  }

  async getOperation(
    context: PolicyRequestContext,
    operationId: string,
  ): Promise<SearchIndexOperationResponse> {
    actorIdentity(context);
    const operation = await this.store.getOperation(operationId);
    if (!operation) throw new SearchIndexOperationNotFoundError();
    return { data: mapOperation(operation) };
  }

  #mapCreateResult(
    result: Awaited<ReturnType<SearchIndexOperationsStore["createRebuild"]>>,
  ): SearchIndexOperationResponse {
    if (result.kind === "idempotency_conflict") {
      throw new SearchIndexOperationsIdempotencyConflictError();
    }
    if (result.kind === "active_operation") throw new SearchIndexOperationsConflictError();
    if (result.kind === "rollback_unavailable") throw new SearchIndexRollbackUnavailableError();
    return { data: mapOperation(result.operation) };
  }
}
