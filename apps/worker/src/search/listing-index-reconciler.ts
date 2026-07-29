import type { ListingSearchRepository } from "@socal/database/listing-search";
import type { ObservabilityRuntime } from "@socal/observability";
import type { ListingIndexReader } from "./listing-index";
import type { ListingIndexHandler } from "./listing-index-handler";

export type ListingIndexReconciliationRepository = Pick<ListingSearchRepository, "listStates">;

export type ListingIndexReconciliationConfiguration = {
  batchSize: number;
  intervalMilliseconds: number;
};

export type ListingIndexReconciliationSummary = {
  current: number;
  repaired: number;
  scanned: number;
  nextCursor: string | null;
};

export class ListingIndexReconciler {
  readonly #repository: ListingIndexReconciliationRepository;
  readonly #index: ListingIndexReader;
  readonly #handler: Pick<ListingIndexHandler, "synchronize">;
  readonly #observability: ObservabilityRuntime;
  readonly #configuration: ListingIndexReconciliationConfiguration;
  #cursor: string | undefined;
  #timer: NodeJS.Timeout | null = null;
  #inFlight: Promise<void> | null = null;
  #stopping = false;

  constructor(input: {
    repository: ListingIndexReconciliationRepository;
    index: ListingIndexReader;
    handler: Pick<ListingIndexHandler, "synchronize">;
    observability: ObservabilityRuntime;
    configuration: ListingIndexReconciliationConfiguration;
  }) {
    this.#repository = input.repository;
    this.#index = input.index;
    this.#handler = input.handler;
    this.#observability = input.observability;
    this.#configuration = input.configuration;
  }

  start(): void {
    if (this.#timer || this.#inFlight) return;
    this.#stopping = false;
    this.#schedule(this.#configuration.intervalMilliseconds);
  }

  async stop(): Promise<void> {
    this.#stopping = true;
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
    await (this.#inFlight ?? Promise.resolve());
  }

  async reconcileOnce(now = new Date()): Promise<ListingIndexReconciliationSummary> {
    const page = await this.#repository.listStates({
      ...(this.#cursor ? { afterId: this.#cursor } : {}),
      limit: this.#configuration.batchSize,
      now,
    });
    let current = 0;
    let repaired = 0;
    for (const state of page.items) {
      const indexedVersion = await this.#index.version(state.id);
      const matches =
        (state.shouldIndex && indexedVersion === state.version) ||
        (!state.shouldIndex && indexedVersion === null);
      if (matches) {
        current += 1;
        this.#observability.metrics.searchReconciliation("current");
        continue;
      }
      const result = await this.#handler.synchronize(state.id, state.version, now, "normal", now);
      if (result.outcome === "stale") {
        throw new Error("OpenSearch Listing version is ahead of PostgreSQL");
      }
      repaired += 1;
      this.#observability.metrics.searchReconciliation(state.shouldIndex ? "upserted" : "deleted");
    }
    this.#cursor = page.nextCursor ?? undefined;
    const summary = {
      current,
      repaired,
      scanned: page.items.length,
      nextCursor: page.nextCursor,
    };
    this.#observability.logger.info("worker.search_reconciliation.completed", {
      current,
      repaired,
      scanned: page.items.length,
      cycleCompleted: page.nextCursor === null,
    });
    return summary;
  }

  #schedule(delayMilliseconds: number): void {
    if (this.#stopping) return;
    this.#timer = setTimeout(() => {
      this.#timer = null;
      this.#inFlight = this.reconcileOnce()
        .then(() => undefined)
        .catch((error: unknown) => {
          this.#observability.metrics.searchReconciliation("failed");
          this.#observability.logger.error("worker.search_reconciliation.failed", {
            errorCode: "SEARCH_RECONCILIATION_FAILED",
            errorType: error instanceof Error ? error.name : "UnknownError",
          });
        })
        .finally(() => {
          this.#inFlight = null;
          this.#schedule(this.#configuration.intervalMilliseconds);
        });
    }, delayMilliseconds);
    this.#timer.unref();
  }
}
