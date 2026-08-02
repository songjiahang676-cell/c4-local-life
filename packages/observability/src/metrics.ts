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
type QueueAdminOperationType =
  "QUEUE_REPLAY" | "QUEUE_RECONCILIATION" | "DEAD_LETTER" | "CONTROL_PLANE";
type QueueAdminOperationOutcome =
  "recorded" | "completed" | "succeeded" | "skipped" | "failed" | "stale" | "poll_failed";
type MediaProcessingOutcome = "ready" | "rejected" | "stale";
type ListingExpiryOutcome = "expired" | "idle";
type NotificationEventOutcome =
  "created" | "duplicate" | "ignored" | "recipient_unavailable" | "failed";
type ModerationDuplicateReviewOutcome = "confirmed" | "false_positive";
type SearchIndexOperation = "upsert" | "delete";
type SearchIndexOutcome = "applied" | "stale" | "missing" | "failed";
type SearchIndexPriority = "urgent" | "normal";
type SearchReconciliationOutcome = "current" | "upserted" | "deleted" | "failed";
type SearchRebuildPhase =
  "prepare" | "backfill" | "catch_up" | "validate" | "switch" | "rollback" | "observation";
type SearchRebuildOutcome = "completed" | "retry" | "failed" | "stale";
type SearchQueryOutcome =
  "success" | "empty" | "invalid_cursor" | "expired_cursor" | "timeout" | "unavailable";
type SearchQuerySort = "RELEVANCE" | "NEWEST" | "PRICE_ASC" | "PRICE_DESC" | "DISTANCE";
type SearchDiscoveryOperation = "dictionary" | "sample" | "suggestions" | "trending" | "retention";
type SearchDiscoveryOutcome =
  | "success"
  | "empty"
  | "recorded"
  | "duplicate"
  | "rejected_bot"
  | "rejected_sensitive"
  | "unavailable";
type HomepageModuleKind = "HERO" | "HOT_SEARCHES" | "CITY_CHIPS" | "LISTING_FEED";
type HomepageModuleOutcome = "success" | "empty" | "unavailable";
type HomepageCacheInvalidationOutcome = "invalidated" | "stale" | "failed";
type HomepageCacheOperationOutcome =
  "hit" | "miss" | "coalesced" | "stored" | "bypassed" | "failed";
type WebVitalName = "CLS" | "FCP" | "INP" | "LCP" | "TTFB";
type WebVitalRoute =
  "homepage" | "listing-list" | "listing-detail" | "search" | "account" | "other";

type Histogram = {
  count: number;
  sum: number;
  boundaries: number[];
  buckets: number[];
};

const durationBuckets = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];
const searchFreshnessBuckets = [1, 2, 5, 10, 30, 60, 120, 300, 900];
const webVitalDurationBuckets = [0.05, 0.1, 0.2, 0.5, 1, 2.5, 4, 10, 30, 60, 120, 600];
const webVitalClsBuckets = [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10];

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

function observe(
  map: Map<string, Histogram>,
  key: string,
  value: number,
  boundaries = durationBuckets,
): void {
  const histogram = map.get(key) ?? {
    count: 0,
    sum: 0,
    boundaries,
    buckets: boundaries.map(() => 0),
  };
  histogram.count += 1;
  histogram.sum += value;
  histogram.boundaries.forEach((boundary, index) => {
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
  readonly #queueAdminOperations = new Map<string, number>();
  readonly #mediaProcessing = new Map<MediaProcessingOutcome, number>();
  readonly #listingExpiryPolls = new Map<ListingExpiryOutcome, number>();
  readonly #notificationEvents = new Map<NotificationEventOutcome, number>();
  readonly #moderationDuplicateReviews = new Map<ModerationDuplicateReviewOutcome, number>();
  readonly #searchIndexEvents = new Map<string, number>();
  readonly #searchIndexFreshness = new Map<string, Histogram>();
  readonly #searchRebuildOperations = new Map<string, number>();
  readonly #searchReconciliations = new Map<SearchReconciliationOutcome, number>();
  readonly #searchQueries = new Map<string, number>();
  readonly #searchDiscoveryEvents = new Map<string, number>();
  readonly #homepageModules = new Map<string, number>();
  readonly #homepageCacheInvalidations = new Map<HomepageCacheInvalidationOutcome, number>();
  readonly #homepageCacheOperations = new Map<HomepageCacheOperationOutcome, number>();
  readonly #webVitalDurations = new Map<string, Histogram>();
  readonly #webVitalCls = new Map<string, Histogram>();
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

  queueAdminOperation(
    operation: QueueAdminOperationType,
    outcome: QueueAdminOperationOutcome,
  ): void {
    increment(this.#queueAdminOperations, labelKey({ operation, outcome }));
  }

  setOutboxOldestPendingAgeSeconds(value: number): void {
    this.#outboxOldestPendingAgeSeconds = Number.isFinite(value) ? Math.max(0, value) : 0;
  }

  mediaProcessing(outcome: MediaProcessingOutcome): void {
    this.#mediaProcessing.set(outcome, (this.#mediaProcessing.get(outcome) ?? 0) + 1);
  }

  notificationEvent(outcome: NotificationEventOutcome): void {
    this.#notificationEvents.set(outcome, (this.#notificationEvents.get(outcome) ?? 0) + 1);
  }

  moderationDuplicateReview(outcome: ModerationDuplicateReviewOutcome, count = 1): void {
    if (!Number.isInteger(count) || count < 1 || count > 10) return;
    increment(this.#moderationDuplicateReviews, outcome, count);
  }

  searchIndex(input: {
    operation: SearchIndexOperation;
    outcome: SearchIndexOutcome;
    priority: SearchIndexPriority;
    freshnessSeconds: number;
  }): void {
    const dimensions = {
      operation: input.operation,
      outcome: input.outcome,
      priority: input.priority,
    };
    increment(this.#searchIndexEvents, labelKey(dimensions));
    if (input.outcome === "failed") return;
    observe(
      this.#searchIndexFreshness,
      labelKey({ operation: input.operation, priority: input.priority }),
      Number.isFinite(input.freshnessSeconds) ? Math.max(0, input.freshnessSeconds) : 0,
      searchFreshnessBuckets,
    );
  }

  searchReconciliation(outcome: SearchReconciliationOutcome): void {
    this.#searchReconciliations.set(outcome, (this.#searchReconciliations.get(outcome) ?? 0) + 1);
  }

  searchRebuild(phase: SearchRebuildPhase, outcome: SearchRebuildOutcome): void {
    increment(this.#searchRebuildOperations, labelKey({ phase, outcome }));
  }

  searchQuery(input: { outcome: SearchQueryOutcome; sort: SearchQuerySort; geo: boolean }): void {
    increment(
      this.#searchQueries,
      labelKey({
        outcome: input.outcome,
        sort: input.sort,
        geo: input.geo ? "true" : "false",
      }),
    );
  }

  searchDiscovery(input: {
    operation: SearchDiscoveryOperation;
    outcome: SearchDiscoveryOutcome;
  }): void {
    increment(this.#searchDiscoveryEvents, labelKey(input));
  }

  homepageModule(input: { kind: HomepageModuleKind; outcome: HomepageModuleOutcome }): void {
    increment(this.#homepageModules, labelKey(input));
  }

  homepageCacheInvalidation(outcome: HomepageCacheInvalidationOutcome): void {
    this.#homepageCacheInvalidations.set(
      outcome,
      (this.#homepageCacheInvalidations.get(outcome) ?? 0) + 1,
    );
  }

  homepageCacheOperation(outcome: HomepageCacheOperationOutcome): void {
    this.#homepageCacheOperations.set(
      outcome,
      (this.#homepageCacheOperations.get(outcome) ?? 0) + 1,
    );
  }

  webVital(input: { name: WebVitalName; route: WebVitalRoute; value: number }): void {
    const value = Number.isFinite(input.value) ? Math.max(0, input.value) : 0;
    if (input.name === "CLS") {
      observe(
        this.#webVitalCls,
        labelKey({ route: input.route }),
        Math.min(value, 10),
        webVitalClsBuckets,
      );
      return;
    }
    observe(
      this.#webVitalDurations,
      labelKey({ metric: input.name, route: input.route }),
      Math.min(value, 600_000) / 1_000,
      webVitalDurationBuckets,
    );
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
      "# HELP socal_queue_admin_operations_total Controlled replay, reconciliation, and dead-letter outcomes.",
      "# TYPE socal_queue_admin_operations_total counter",
    );
    for (const [key, value] of [...this.#queueAdminOperations].sort()) {
      lines.push(`socal_queue_admin_operations_total${labels(parseLabelKey(key))} ${value}`);
    }
    lines.push(
      "# HELP socal_media_processing_total Media processing terminal and stale outcomes.",
      "# TYPE socal_media_processing_total counter",
    );
    for (const [outcome, value] of [...this.#mediaProcessing].sort()) {
      lines.push(`socal_media_processing_total${labels({ outcome })} ${value}`);
    }
    lines.push(
      "# HELP socal_notification_events_total Listing notification projection results by bounded outcome.",
      "# TYPE socal_notification_events_total counter",
    );
    for (const [outcome, value] of [...this.#notificationEvents].sort()) {
      lines.push(`socal_notification_events_total${labels({ outcome })} ${value}`);
    }
    lines.push(
      "# HELP socal_moderation_duplicate_reviews_total Human-reviewed duplicate candidates by bounded outcome.",
      "# TYPE socal_moderation_duplicate_reviews_total counter",
    );
    for (const [outcome, value] of [...this.#moderationDuplicateReviews].sort()) {
      lines.push(`socal_moderation_duplicate_reviews_total${labels({ outcome })} ${value}`);
    }
    lines.push(
      "# HELP socal_search_index_events_total Listing search projection writes by bounded operation, outcome, and priority.",
      "# TYPE socal_search_index_events_total counter",
    );
    for (const [key, value] of [...this.#searchIndexEvents].sort()) {
      lines.push(`socal_search_index_events_total${labels(parseLabelKey(key))} ${value}`);
    }
    lines.push(
      "# HELP socal_search_index_freshness_seconds Time from durable Listing event creation to successful index processing.",
      "# TYPE socal_search_index_freshness_seconds histogram",
    );
    this.#renderHistograms(
      lines,
      "socal_search_index_freshness_seconds",
      this.#searchIndexFreshness,
    );
    lines.push(
      "# HELP socal_search_reconciliation_total Listing index reconciliation outcomes.",
      "# TYPE socal_search_reconciliation_total counter",
    );
    for (const [outcome, value] of [...this.#searchReconciliations].sort()) {
      lines.push(`socal_search_reconciliation_total${labels({ outcome })} ${value}`);
    }
    lines.push(
      "# HELP socal_search_rebuild_operations_total Recoverable Listing index rebuild stages by bounded outcome.",
      "# TYPE socal_search_rebuild_operations_total counter",
    );
    for (const [key, value] of [...this.#searchRebuildOperations].sort()) {
      lines.push(`socal_search_rebuild_operations_total${labels(parseLabelKey(key))} ${value}`);
    }
    lines.push(
      "# HELP socal_search_queries_total Public search queries by bounded outcome, sort, and geo mode.",
      "# TYPE socal_search_queries_total counter",
    );
    for (const [key, value] of [...this.#searchQueries].sort()) {
      lines.push(`socal_search_queries_total${labels(parseLabelKey(key))} ${value}`);
    }
    lines.push(
      "# HELP socal_search_discovery_events_total Search discovery operations by fixed operation and privacy-safe outcome.",
      "# TYPE socal_search_discovery_events_total counter",
    );
    for (const [key, value] of [...this.#searchDiscoveryEvents].sort()) {
      lines.push(`socal_search_discovery_events_total${labels(parseLabelKey(key))} ${value}`);
    }
    lines.push(
      "# HELP socal_homepage_modules_total Homepage module composition by fixed kind and outcome.",
      "# TYPE socal_homepage_modules_total counter",
    );
    for (const [key, value] of [...this.#homepageModules].sort()) {
      lines.push(`socal_homepage_modules_total${labels(parseLabelKey(key))} ${value}`);
    }
    lines.push(
      "# HELP socal_homepage_cache_invalidations_total Homepage layout cache invalidation outcomes.",
      "# TYPE socal_homepage_cache_invalidations_total counter",
    );
    for (const [outcome, value] of [...this.#homepageCacheInvalidations].sort()) {
      lines.push(`socal_homepage_cache_invalidations_total${labels({ outcome })} ${value}`);
    }
    lines.push(
      "# HELP socal_homepage_cache_operations_total Homepage response cache operations by bounded outcome.",
      "# TYPE socal_homepage_cache_operations_total counter",
    );
    for (const [outcome, value] of [...this.#homepageCacheOperations].sort()) {
      lines.push(`socal_homepage_cache_operations_total${labels({ outcome })} ${value}`);
    }
    lines.push(
      "# HELP socal_web_vital_duration_seconds Sampled first-party Web Vital duration.",
      "# TYPE socal_web_vital_duration_seconds histogram",
    );
    this.#renderHistograms(lines, "socal_web_vital_duration_seconds", this.#webVitalDurations);
    lines.push(
      "# HELP socal_web_vital_cls_ratio Sampled first-party cumulative layout shift ratio.",
      "# TYPE socal_web_vital_cls_ratio histogram",
    );
    this.#renderHistograms(lines, "socal_web_vital_cls_ratio", this.#webVitalCls);
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
      histogram.boundaries.forEach((boundary, index) => {
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
