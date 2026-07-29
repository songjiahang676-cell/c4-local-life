type HttpObservation = {
  method: string;
  route: string;
  statusCode: number;
  durationSeconds: number;
};

type WorkerObservation = {
  jobName: string;
  outcome: "completed" | "failed";
  durationSeconds: number;
};

type OutboxDispatchOutcome = "published" | "retry" | "failed" | "stale";
type MediaProcessingOutcome = "ready" | "rejected" | "stale";
type ListingExpiryOutcome = "expired" | "idle";

type Histogram = {
  count: number;
  sum: number;
  buckets: number[];
};

const durationBuckets = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

function escapeLabel(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("\n", "\\n").replaceAll('"', '\\"');
}

function labels(values: Record<string, string>): string {
  return `{${Object.entries(values)
    .map(([key, value]) => `${key}="${escapeLabel(value)}"`)
    .join(",")}}`;
}

function labelKey(values: Record<string, string>): string {
  return JSON.stringify(values);
}

function parseLabelKey(key: string): Record<string, string> {
  return JSON.parse(key) as Record<string, string>;
}

function increment(map: Map<string, number>, key: string, amount = 1): void {
  map.set(key, (map.get(key) ?? 0) + amount);
}

function observe(map: Map<string, Histogram>, key: string, value: number): void {
  const histogram = map.get(key) ?? {
    count: 0,
    sum: 0,
    buckets: durationBuckets.map(() => 0),
  };
  histogram.count += 1;
  histogram.sum += value;
  durationBuckets.forEach((boundary, index) => {
    if (value <= boundary) histogram.buckets[index] = (histogram.buckets[index] ?? 0) + 1;
  });
  map.set(key, histogram);
}

function safeMethod(method: string): string {
  const normalized = method.toUpperCase();
  return /^(?:GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS)$/.test(normalized) ? normalized : "OTHER";
}

function safeRoute(route: string): string {
  if (!route.startsWith("/") || route.length > 160) return "unmatched";
  return route.replaceAll(/[\r\n"]/g, "");
}

function safeJobName(jobName: string): string {
  return /^[a-z][a-z0-9.-]{0,79}$/.test(jobName) ? jobName : "unknown";
}

export class MetricsRegistry {
  #httpInFlight = 0;
  #workerInFlight = 0;
  readonly #httpRequests = new Map<string, number>();
  readonly #httpDurations = new Map<string, Histogram>();
  readonly #workerJobs = new Map<string, number>();
  readonly #workerDurations = new Map<string, Histogram>();
  readonly #outboxDispatches = new Map<OutboxDispatchOutcome, number>();
  readonly #mediaProcessing = new Map<MediaProcessingOutcome, number>();
  readonly #listingExpiryPolls = new Map<ListingExpiryOutcome, number>();
  #listingsExpired = 0;
  #listingExpiryPollFailures = 0;
  #outboxOldestPendingAgeSeconds = 0;
  #outboxPollFailures = 0;

  httpRequestStarted(): void {
    this.#httpInFlight += 1;
  }

  observeHttpRequest(observation: HttpObservation): void {
    this.#httpInFlight = Math.max(0, this.#httpInFlight - 1);
    const dimensions = {
      method: safeMethod(observation.method),
      route: safeRoute(observation.route),
      status_class: `${Math.floor(observation.statusCode / 100)}xx`,
    };
    const key = labelKey(dimensions);
    increment(this.#httpRequests, key);
    observe(this.#httpDurations, key, Math.max(0, observation.durationSeconds));
  }

  workerJobStarted(): void {
    this.#workerInFlight += 1;
  }

  observeWorkerJob(observation: WorkerObservation): void {
    this.#workerInFlight = Math.max(0, this.#workerInFlight - 1);
    const dimensions = {
      job_name: safeJobName(observation.jobName),
      outcome: observation.outcome,
    };
    const key = labelKey(dimensions);
    increment(this.#workerJobs, key);
    observe(this.#workerDurations, key, Math.max(0, observation.durationSeconds));
  }

  outboxDispatch(outcome: OutboxDispatchOutcome): void {
    this.#outboxDispatches.set(outcome, (this.#outboxDispatches.get(outcome) ?? 0) + 1);
  }

  outboxPollFailed(): void {
    this.#outboxPollFailures += 1;
  }

  setOutboxOldestPendingAgeSeconds(value: number): void {
    this.#outboxOldestPendingAgeSeconds = Number.isFinite(value) ? Math.max(0, value) : 0;
  }

  mediaProcessing(outcome: MediaProcessingOutcome): void {
    this.#mediaProcessing.set(outcome, (this.#mediaProcessing.get(outcome) ?? 0) + 1);
  }

  observeListingExpiry(expiredCount: number): void {
    const count = Number.isInteger(expiredCount) && expiredCount > 0 ? expiredCount : 0;
    const outcome: ListingExpiryOutcome = count > 0 ? "expired" : "idle";
    this.#listingExpiryPolls.set(outcome, (this.#listingExpiryPolls.get(outcome) ?? 0) + 1);
    this.#listingsExpired += count;
  }

  listingExpiryPollFailed(): void {
    this.#listingExpiryPollFailures += 1;
  }

  renderPrometheus(): string {
    const lines = [
      "# HELP socal_http_requests_in_flight Current HTTP requests being served.",
      "# TYPE socal_http_requests_in_flight gauge",
      `socal_http_requests_in_flight ${this.#httpInFlight}`,
      "# HELP socal_http_requests_total Completed HTTP requests.",
      "# TYPE socal_http_requests_total counter",
    ];

    for (const [key, value] of [...this.#httpRequests].sort()) {
      lines.push(`socal_http_requests_total${labels(parseLabelKey(key))} ${value}`);
    }

    lines.push(
      "# HELP socal_http_request_duration_seconds HTTP request duration.",
      "# TYPE socal_http_request_duration_seconds histogram",
    );
    this.#renderHistograms(lines, "socal_http_request_duration_seconds", this.#httpDurations);
    lines.push(
      "# HELP socal_worker_jobs_in_flight Current worker jobs being processed.",
      "# TYPE socal_worker_jobs_in_flight gauge",
      `socal_worker_jobs_in_flight ${this.#workerInFlight}`,
      "# HELP socal_worker_jobs_total Completed worker jobs by outcome.",
      "# TYPE socal_worker_jobs_total counter",
    );

    for (const [key, value] of [...this.#workerJobs].sort()) {
      lines.push(`socal_worker_jobs_total${labels(parseLabelKey(key))} ${value}`);
    }

    lines.push(
      "# HELP socal_worker_job_duration_seconds Worker job duration.",
      "# TYPE socal_worker_job_duration_seconds histogram",
    );
    this.#renderHistograms(lines, "socal_worker_job_duration_seconds", this.#workerDurations);
    lines.push(
      "# HELP socal_outbox_dispatch_total Outbox publish results by bounded outcome.",
      "# TYPE socal_outbox_dispatch_total counter",
    );
    for (const [outcome, value] of [...this.#outboxDispatches].sort()) {
      lines.push(`socal_outbox_dispatch_total${labels({ outcome })} ${value}`);
    }
    lines.push(
      "# HELP socal_outbox_poll_failures_total Outbox polling failures.",
      "# TYPE socal_outbox_poll_failures_total counter",
      `socal_outbox_poll_failures_total ${this.#outboxPollFailures}`,
      "# HELP socal_outbox_oldest_pending_age_seconds Age of the oldest pending outbox event.",
      "# TYPE socal_outbox_oldest_pending_age_seconds gauge",
      `socal_outbox_oldest_pending_age_seconds ${this.#outboxOldestPendingAgeSeconds}`,
      "# HELP socal_media_processing_total Media processing terminal and stale outcomes.",
      "# TYPE socal_media_processing_total counter",
    );
    for (const [outcome, value] of [...this.#mediaProcessing].sort()) {
      lines.push(`socal_media_processing_total${labels({ outcome })} ${value}`);
    }
    lines.push(
      "# HELP socal_listing_expiry_polls_total Listing expiry polls by bounded outcome.",
      "# TYPE socal_listing_expiry_polls_total counter",
    );
    for (const [outcome, value] of [...this.#listingExpiryPolls].sort()) {
      lines.push(`socal_listing_expiry_polls_total${labels({ outcome })} ${value}`);
    }
    lines.push(
      "# HELP socal_listings_expired_total Rental Listings transitioned to expired.",
      "# TYPE socal_listings_expired_total counter",
      `socal_listings_expired_total ${this.#listingsExpired}`,
      "# HELP socal_listing_expiry_poll_failures_total Listing expiry polling failures.",
      "# TYPE socal_listing_expiry_poll_failures_total counter",
      `socal_listing_expiry_poll_failures_total ${this.#listingExpiryPollFailures}`,
    );
    return `${lines.join("\n")}\n`;
  }

  #renderHistograms(lines: string[], metricName: string, histograms: Map<string, Histogram>): void {
    for (const [key, histogram] of [...histograms].sort()) {
      const dimensions = parseLabelKey(key);
      durationBuckets.forEach((boundary, index) => {
        lines.push(
          `${metricName}_bucket${labels({ ...dimensions, le: String(boundary) })} ${
            histogram.buckets[index] ?? 0
          }`,
        );
      });
      lines.push(
        `${metricName}_bucket${labels({ ...dimensions, le: "+Inf" })} ${histogram.count}`,
        `${metricName}_sum${labels(dimensions)} ${histogram.sum}`,
        `${metricName}_count${labels(dimensions)} ${histogram.count}`,
      );
    }
  }
}
