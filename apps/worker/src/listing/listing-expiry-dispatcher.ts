import type { ListingRepository } from "@socal/database/listing";
import type { ObservabilityRuntime } from "@socal/observability";

export type ListingExpiryRepository = Pick<ListingRepository, "expireDue">;

export type ListingExpiryConfiguration = {
  batchSize: number;
  pollIntervalMilliseconds: number;
};

export type ListingExpirySummary = {
  expiredCount: number;
};

export class ListingExpiryDispatcher {
  readonly #repository: ListingExpiryRepository;
  readonly #observability: ObservabilityRuntime;
  readonly #configuration: ListingExpiryConfiguration;
  #timer: NodeJS.Timeout | null = null;
  #inFlight: Promise<void> | null = null;
  #stopping = false;

  constructor(input: {
    repository: ListingExpiryRepository;
    observability: ObservabilityRuntime;
    configuration: ListingExpiryConfiguration;
  }) {
    this.#repository = input.repository;
    this.#observability = input.observability;
    this.#configuration = input.configuration;
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

  async dispatchOnce(now = new Date()): Promise<ListingExpirySummary> {
    const summary = await this.#repository.expireDue({
      now,
      limit: this.#configuration.batchSize,
    });
    this.#observability.metrics.observeListingExpiry(summary.expiredCount);
    this.#observability.logger.info("worker.listing_expiry.poll_completed", {
      expiredCount: summary.expiredCount,
    });
    return summary;
  }

  #schedule(delayMilliseconds: number): void {
    if (this.#stopping) return;
    this.#timer = setTimeout(() => {
      this.#timer = null;
      this.#inFlight = this.dispatchOnce()
        .then(() => undefined)
        .catch((error: unknown) => {
          this.#observability.metrics.listingExpiryPollFailed();
          this.#observability.logger.error("worker.listing_expiry.poll_failed", {
            errorCode: "LISTING_EXPIRY_POLL_FAILED",
            errorType: error instanceof Error ? error.name : "UnknownError",
          });
        })
        .finally(() => {
          this.#inFlight = null;
          this.#schedule(this.#configuration.pollIntervalMilliseconds);
        });
    }, delayMilliseconds);
    this.#timer.unref();
  }
}
