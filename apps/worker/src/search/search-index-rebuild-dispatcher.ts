import { createHash } from "node:crypto";
import type {
  ClaimedSearchIndexOperation,
  SearchIndexOperationRepository,
} from "@socal/database/search-index-operations";
import type { ListingSearchRepository } from "@socal/database/listing-search";
import type { ObservabilityRuntime } from "@socal/observability";
import { ListingIndexHandler } from "./listing-index-handler";
import { listingRebuildIndexName } from "./listing-index-definition";
import { ListingIndexContractError } from "./listing-index-manager";
import type { ListingIndexManager } from "./listing-index-manager";
import type { OpenSearchListingIndexCatalog } from "./listing-index";

export type SearchIndexRebuildRepositoryPort = Pick<
  SearchIndexOperationRepository,
  | "claimOperation"
  | "prepareRebuild"
  | "advanceScan"
  | "advancePhase"
  | "completeRebuild"
  | "completeRollback"
  | "failOperation"
  | "closeExpiredObservationWindows"
>;

export type SearchIndexRebuildSummary = {
  claimed: number;
  phase: ClaimedSearchIndexOperation["phase"] | null;
  outcome: "idle" | "completed" | "retry" | "failed" | "stale";
};

type RebuildPhase = Parameters<ObservabilityRuntime["metrics"]["searchRebuild"]>[0];

export class SearchIndexValidationMismatchError extends Error {
  readonly code = "SEARCH_INDEX_VALIDATION_MISMATCH";

  constructor() {
    super("Candidate Listing index does not match the canonical PostgreSQL projection");
    this.name = "SearchIndexValidationMismatchError";
  }
}

function nextDigest(previous: string, id: string, version: number): string {
  return createHash("sha256")
    .update(previous, "ascii")
    .update("\0", "ascii")
    .update(id, "ascii")
    .update("\0", "ascii")
    .update(String(version), "ascii")
    .digest("hex");
}

function emptyDigest(): string {
  return createHash("sha256").digest("hex");
}

function metricPhase(operation: ClaimedSearchIndexOperation): RebuildPhase {
  if (operation.type === "SEARCH_INDEX_ROLLBACK") return "rollback";
  switch (operation.phase) {
    case "PENDING":
      return "prepare";
    case "BACKFILLING":
      return "backfill";
    case "CATCHING_UP":
      return "catch_up";
    case "VALIDATING":
      return "validate";
    case "SWITCHING":
      return "switch";
    default:
      return "observation";
  }
}

export class SearchIndexRebuildDispatcher {
  readonly #repository: SearchIndexRebuildRepositoryPort;
  readonly #listings: Pick<ListingSearchRepository, "findById" | "listStates">;
  readonly #manager: ListingIndexManager;
  readonly #catalog: OpenSearchListingIndexCatalog;
  readonly #observability: ObservabilityRuntime;
  readonly #indexPrefix: string;
  readonly #batchSize: number;
  readonly #leaseSeconds: number;
  readonly #pollIntervalMilliseconds: number;
  #timer: NodeJS.Timeout | null = null;
  #inFlight: Promise<void> | null = null;
  #stopping = false;

  constructor(input: {
    repository: SearchIndexRebuildRepositoryPort;
    listings: Pick<ListingSearchRepository, "findById" | "listStates">;
    manager: ListingIndexManager;
    catalog: OpenSearchListingIndexCatalog;
    observability: ObservabilityRuntime;
    indexPrefix: string;
    batchSize: number;
    leaseSeconds: number;
    pollIntervalMilliseconds: number;
  }) {
    this.#repository = input.repository;
    this.#listings = input.listings;
    this.#manager = input.manager;
    this.#catalog = input.catalog;
    this.#observability = input.observability;
    this.#indexPrefix = input.indexPrefix;
    this.#batchSize = input.batchSize;
    this.#leaseSeconds = input.leaseSeconds;
    this.#pollIntervalMilliseconds = input.pollIntervalMilliseconds;
  }

  start(): void {
    if (this.#timer || this.#inFlight) return;
    this.#stopping = false;
    this.#schedule(0);
  }

  async stop(): Promise<void> {
    this.#stopping = true;
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
    await (this.#inFlight ?? Promise.resolve());
  }

  async dispatchOnce(now = new Date()): Promise<SearchIndexRebuildSummary> {
    const closed = await this.#repository.closeExpiredObservationWindows(now);
    if (closed > 0) {
      this.#observability.metrics.searchRebuild("observation", "completed");
      this.#observability.logger.info("worker.search_rebuild.observation_closed", {
        count: closed,
      });
    }
    const operation = await this.#repository.claimOperation({
      now,
      leaseSeconds: this.#leaseSeconds,
    });
    if (!operation) return { claimed: 0, phase: null, outcome: "idle" };

    const phase = metricPhase(operation);
    try {
      const advanced = await this.#execute(operation, now);
      const outcome = advanced ? "completed" : "stale";
      this.#observability.metrics.searchRebuild(phase, outcome);
      this.#observability.logger.info("worker.search_rebuild.stage_completed", {
        operationId: operation.id,
        jobId: operation.jobId,
        jobType: operation.type,
        phase: operation.phase,
        outcome,
      });
      return { claimed: 1, phase: operation.phase, outcome };
    } catch (error: unknown) {
      const deterministic =
        error instanceof ListingIndexContractError ||
        error instanceof SearchIndexValidationMismatchError;
      if (deterministic) {
        const failed = await this.#repository.failOperation({
          jobId: operation.jobId,
          leaseExpiresAt: operation.leaseExpiresAt,
          failureCode:
            error instanceof SearchIndexValidationMismatchError ? error.code : error.code,
          occurredAt: now,
        });
        this.#observability.metrics.searchRebuild(phase, failed ? "failed" : "stale");
        this.#observability.logger.error("worker.search_rebuild.failed", {
          operationId: operation.id,
          jobId: operation.jobId,
          jobType: operation.type,
          phase: operation.phase,
          errorCode: error instanceof SearchIndexValidationMismatchError ? error.code : error.code,
          errorType: error.name,
          staleLease: !failed,
        });
        return { claimed: 1, phase: operation.phase, outcome: failed ? "failed" : "stale" };
      }
      this.#observability.metrics.searchRebuild(phase, "retry");
      this.#observability.logger.error("worker.search_rebuild.retry_scheduled", {
        operationId: operation.id,
        jobId: operation.jobId,
        jobType: operation.type,
        phase: operation.phase,
        errorCode: "SEARCH_INDEX_TRANSIENT_FAILURE",
        errorType: error instanceof Error ? error.name : "UnknownError",
      });
      return { claimed: 1, phase: operation.phase, outcome: "retry" };
    }
  }

  async #execute(operation: ClaimedSearchIndexOperation, now: Date): Promise<boolean> {
    if (operation.phase === "PENDING") {
      if (operation.type === "SEARCH_INDEX_ROLLBACK") {
        return this.#repository.advancePhase({
          jobId: operation.jobId,
          leaseExpiresAt: operation.leaseExpiresAt,
          expectedPhase: "PENDING",
          nextPhase: "VALIDATING",
          occurredAt: now,
        });
      }
      const sourceIndex = await this.#manager.resolveAliasTarget();
      const targetIndex = listingRebuildIndexName(this.#indexPrefix, operation.id);
      await this.#manager.createRebuildIndex(targetIndex);
      return this.#repository.prepareRebuild({
        jobId: operation.jobId,
        leaseExpiresAt: operation.leaseExpiresAt,
        sourceIndex,
        targetIndex,
        occurredAt: now,
      });
    }

    if (operation.phase === "BACKFILLING" || operation.phase === "CATCHING_UP") {
      return this.#scan({ ...operation, phase: operation.phase }, now);
    }

    if (operation.phase === "VALIDATING") {
      if (!operation.targetIndex) throw new ListingIndexContractError("Target index is missing");
      const validation = await this.#validate(operation.targetIndex, now);
      if (
        validation.canonicalCount !== validation.targetCount ||
        validation.canonicalDigest !== validation.targetDigest
      ) {
        throw new SearchIndexValidationMismatchError();
      }
      return this.#repository.advancePhase({
        jobId: operation.jobId,
        leaseExpiresAt: operation.leaseExpiresAt,
        expectedPhase: "VALIDATING",
        nextPhase: "SWITCHING",
        validation,
        occurredAt: now,
      });
    }

    if (operation.phase === "SWITCHING") {
      if (!operation.sourceIndex || !operation.targetIndex || operation.canonicalCount === null) {
        throw new ListingIndexContractError("Validated search alias transition is incomplete");
      }
      await this.#manager.switchAliases(operation.sourceIndex, operation.targetIndex);
      if (operation.type === "SEARCH_INDEX_ROLLBACK") {
        return this.#repository.completeRollback({
          jobId: operation.jobId,
          leaseExpiresAt: operation.leaseExpiresAt,
          aliasSwitchedAt: now,
          canonicalCount: operation.canonicalCount,
        });
      }
      return this.#repository.completeRebuild({
        jobId: operation.jobId,
        leaseExpiresAt: operation.leaseExpiresAt,
        aliasSwitchedAt: now,
        rollbackUntil: new Date(now.getTime() + operation.rollbackWindowHours * 3_600_000),
        canonicalCount: operation.canonicalCount,
      });
    }

    return false;
  }

  async #scan(
    operation: ClaimedSearchIndexOperation & { phase: "BACKFILLING" | "CATCHING_UP" },
    now: Date,
  ): Promise<boolean> {
    if (!operation.targetIndex) throw new ListingIndexContractError("Target index is missing");
    const page = await this.#listings.listStates({
      ...(operation.scanCursor ? { afterId: operation.scanCursor } : {}),
      limit: this.#batchSize,
      now,
    });
    const target = this.#catalog.writer(operation.targetIndex);
    const handler = new ListingIndexHandler(this.#listings, target);
    for (const state of page.items) {
      await handler.synchronize(state.id, state.version, now, "normal", now);
    }
    const nextPhase =
      page.nextCursor !== null
        ? operation.phase
        : operation.phase === "BACKFILLING"
          ? "CATCHING_UP"
          : "VALIDATING";
    return this.#repository.advanceScan({
      jobId: operation.jobId,
      leaseExpiresAt: operation.leaseExpiresAt,
      expectedPhase: operation.phase,
      nextPhase,
      scanCursor: page.nextCursor,
      occurredAt: now,
    });
  }

  async #validate(
    targetIndex: string,
    now: Date,
  ): Promise<{
    canonicalCount: number;
    targetCount: number;
    canonicalDigest: string;
    targetDigest: string;
  }> {
    let canonicalCount = 0;
    let canonicalDigest = emptyDigest();
    let canonicalCursor: string | undefined;
    do {
      const page = await this.#listings.listStates({
        ...(canonicalCursor ? { afterId: canonicalCursor } : {}),
        limit: 1_000,
        now,
      });
      for (const item of page.items) {
        if (!item.shouldIndex) continue;
        canonicalCount += 1;
        canonicalDigest = nextDigest(canonicalDigest, item.id, item.version);
      }
      canonicalCursor = page.nextCursor ?? undefined;
    } while (canonicalCursor);

    await this.#catalog.refresh(targetIndex);
    let targetCount = 0;
    let targetDigest = emptyDigest();
    let targetCursor: string | undefined;
    do {
      const page = await this.#catalog.listVersions({
        index: targetIndex,
        ...(targetCursor ? { afterId: targetCursor } : {}),
        limit: 1_000,
      });
      for (const item of page.items) {
        targetCount += 1;
        targetDigest = nextDigest(targetDigest, item.id, item.version);
      }
      targetCursor = page.nextCursor ?? undefined;
    } while (targetCursor);
    return { canonicalCount, targetCount, canonicalDigest, targetDigest };
  }

  #schedule(delayMilliseconds: number): void {
    if (this.#stopping) return;
    this.#timer = setTimeout(() => {
      this.#timer = null;
      this.#inFlight = this.dispatchOnce()
        .then(() => undefined)
        .catch((error: unknown) => {
          this.#observability.metrics.searchRebuild("prepare", "retry");
          this.#observability.logger.error("worker.search_rebuild.poll_failed", {
            errorCode: "SEARCH_REBUILD_POLL_FAILED",
            errorType: error instanceof Error ? error.name : "UnknownError",
          });
        })
        .finally(() => {
          this.#inFlight = null;
          this.#schedule(this.#pollIntervalMilliseconds);
        });
    }, delayMilliseconds);
    this.#timer.unref();
  }
}
