import type {
  ListingSearchProjection,
  ListingSearchRepository,
} from "@socal/database/listing-search";
import type { OutboxJobEnvelope } from "../outbox/bullmq-outbox.publisher";
import {
  listingIndexSchemaVersion,
  type ListingSearchAttribute,
  type ListingSearchDocument,
} from "./listing-index-definition";
import type { ListingIndexMutationOutcome, ListingIndexWriter } from "./listing-index";

export const listingSearchEventTypes = [
  "listing.draft.created",
  "listing.draft.updated",
  "listing.submitted",
  "listing.published",
  "listing.revised",
  "listing.moderation.escalated",
  "listing.moderation.returned",
  "listing.moderation.rejected",
  "listing.moderation.removed",
  "listing.appeal.upheld",
  "listing.appeal.restored",
  "listing.archived",
  "listing.deleted",
  "listing.expired",
] as const;

export type ListingSearchEventType = (typeof listingSearchEventTypes)[number];
export type ListingIndexPriority = "urgent" | "normal";
export type ListingIndexOperation = "upsert" | "delete";

export const urgentListingSearchEventTypes = [
  "listing.submitted",
  "listing.moderation.escalated",
  "listing.moderation.returned",
  "listing.moderation.rejected",
  "listing.moderation.removed",
  "listing.appeal.upheld",
  "listing.archived",
  "listing.deleted",
  "listing.expired",
] as const satisfies readonly ListingSearchEventType[];

export type ListingIndexObservation = {
  operation: ListingIndexOperation;
  outcome: ListingIndexMutationOutcome | "failed";
  priority: ListingIndexPriority;
  freshnessSeconds: number;
};

export type ListingIndexSynchronizationResult = {
  operation: ListingIndexOperation;
  outcome: ListingIndexMutationOutcome;
  version: number;
};

type ListingIndexRepository = Pick<ListingSearchRepository, "findById">;

type ListingSearchEvent = {
  listingId: string;
  aggregateVersion: number;
  occurredAt: Date;
};

export class PermanentListingSearchEventError extends Error {
  readonly code = "LISTING_SEARCH_EVENT_INVALID";

  constructor() {
    super("The Listing search event cannot be processed");
    this.name = "PermanentListingSearchEventError";
  }
}

export class ListingSearchProjectionError extends Error {
  readonly code = "LISTING_SEARCH_PROJECTION_INVALID";

  constructor() {
    super("The Listing public search projection is invalid");
    this.name = "ListingSearchProjectionError";
  }
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isListingSearchEventType(value: unknown): value is ListingSearchEventType {
  return (
    typeof value === "string" && listingSearchEventTypes.includes(value as ListingSearchEventType)
  );
}

export function listingSearchEventPriority(eventType: string): ListingIndexPriority {
  return urgentListingSearchEventTypes.includes(
    eventType as (typeof urgentListingSearchEventTypes)[number],
  )
    ? "urgent"
    : "normal";
}

export function parseListingSearchEnvelope(
  value: unknown,
  expectedEventType: ListingSearchEventType,
): ListingSearchEvent {
  if (!isRecord(value)) throw new PermanentListingSearchEventError();
  const envelope = value as Partial<OutboxJobEnvelope>;
  const payload = envelope.payload;
  if (
    envelope.version !== 1 ||
    typeof envelope.eventId !== "string" ||
    !uuidPattern.test(envelope.eventId) ||
    envelope.aggregateType !== "LISTING" ||
    typeof envelope.aggregateId !== "string" ||
    !uuidPattern.test(envelope.aggregateId) ||
    envelope.eventType !== expectedEventType ||
    !isListingSearchEventType(envelope.eventType) ||
    typeof envelope.occurredAt !== "string" ||
    !isRecord(payload) ||
    payload.schemaVersion !== 1 ||
    payload.listingId !== envelope.aggregateId ||
    !Number.isInteger(payload.aggregateVersion) ||
    (payload.aggregateVersion as number) < 1
  ) {
    throw new PermanentListingSearchEventError();
  }
  const occurredAt = new Date(envelope.occurredAt);
  if (!Number.isFinite(occurredAt.getTime()) || occurredAt.toISOString() !== envelope.occurredAt) {
    throw new PermanentListingSearchEventError();
  }
  return {
    listingId: envelope.aggregateId,
    aggregateVersion: payload.aggregateVersion as number,
    occurredAt,
  };
}

function amountMinor(value: string | null): number | null {
  if (value === null) return null;
  const match = /^(-?)(\d{1,14})(?:\.(\d{1,2}))?$/.exec(value);
  if (!match) throw new ListingSearchProjectionError();
  const sign = match[1] === "-" ? -1n : 1n;
  const whole = BigInt(match[2] ?? "0");
  const fraction = BigInt((match[3] ?? "").padEnd(2, "0"));
  const minor = sign * (whole * 100n + fraction);
  if (minor > BigInt(Number.MAX_SAFE_INTEGER) || minor < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new ListingSearchProjectionError();
  }
  return Number(minor);
}

function searchAttributes(
  attributes: ListingSearchProjection["attributes"],
): ListingSearchAttribute[] {
  const result: ListingSearchAttribute[] = [];
  for (const [key, value] of Object.entries(attributes).sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    if (typeof value === "string") {
      result.push({
        key,
        textValue: value,
        ...(value.length <= 256 ? { keywordValue: value } : {}),
      });
    } else if (typeof value === "number" && Number.isFinite(value)) {
      result.push({ key, numberValue: value });
    } else if (typeof value === "boolean") {
      result.push({ key, booleanValue: value });
    }
  }
  return result;
}

export function buildListingSearchDocument(
  projection: ListingSearchProjection,
  indexedAt: Date,
): ListingSearchDocument {
  if (
    projection.price.currency !== "USD" ||
    projection.version < 1 ||
    !Number.isFinite(projection.qualityScore) ||
    !Number.isFinite(indexedAt.getTime())
  ) {
    throw new ListingSearchProjectionError();
  }
  const latitude = projection.location.latitude;
  const longitude = projection.location.longitude;
  const point =
    latitude !== null &&
    longitude !== null &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180
      ? { lat: latitude, lon: longitude }
      : undefined;
  return {
    schemaVersion: listingIndexSchemaVersion,
    id: projection.id,
    type: projection.type,
    status: "PUBLISHED",
    locale: projection.locale,
    slug: projection.slug,
    title: projection.title,
    summary: projection.summary,
    body: projection.body,
    category: projection.category,
    region: projection.region,
    price: {
      amountMinor: amountMinor(projection.price.amount),
      currency: "USD",
      unit: projection.price.unit ?? "NEGOTIABLE",
    },
    location: {
      precision: projection.location.precision,
      ...(point ? { point } : {}),
    },
    attributes: searchAttributes(projection.attributes),
    publisher: {
      ownerId: projection.publisher.ownerId,
      displayName: projection.publisher.displayName,
      avatarUrl: projection.publisher.avatarUrl,
      organizationId: projection.publisher.organizationId,
      organizationSlug: projection.publisher.organizationSlug,
      ...(projection.publisher.organizationVerification
        ? { organizationVerification: projection.publisher.organizationVerification }
        : {}),
    },
    qualityScore: projection.qualityScore,
    isSponsored: projection.isSponsored,
    promotion: null,
    publishedAt: projection.publishedAt.toISOString(),
    expiresAt: projection.expiresAt.toISOString(),
    updatedAt: projection.updatedAt.toISOString(),
    contentVersion: projection.version,
    indexedAt: indexedAt.toISOString(),
  };
}

export class ListingIndexHandler {
  constructor(
    private readonly repository: ListingIndexRepository,
    private readonly index: ListingIndexWriter,
    private readonly onObservation: (value: ListingIndexObservation) => void = () => undefined,
  ) {}

  async handle(
    value: unknown,
    eventType: ListingSearchEventType,
    handledAt = new Date(),
  ): Promise<ListingIndexSynchronizationResult> {
    const event = parseListingSearchEnvelope(value, eventType);
    return this.synchronize(
      event.listingId,
      event.aggregateVersion,
      event.occurredAt,
      listingSearchEventPriority(eventType),
      handledAt,
    );
  }

  async synchronize(
    listingId: string,
    minimumVersion: number,
    occurredAt: Date,
    priority: ListingIndexPriority,
    handledAt = new Date(),
  ): Promise<ListingIndexSynchronizationResult> {
    let operation: ListingIndexOperation = priority === "urgent" ? "delete" : "upsert";
    const freshnessSeconds = Math.max(0, (handledAt.getTime() - occurredAt.getTime()) / 1_000);
    try {
      const record = await this.repository.findById(listingId, handledAt);
      if (record && record.version < minimumVersion) {
        throw new Error("Canonical Listing version is behind its durable event");
      }
      const version = record?.version ?? minimumVersion;
      if (!record?.projection) {
        operation = "delete";
        const outcome = await this.index.remove(listingId, version);
        this.onObservation({ operation, outcome, priority, freshnessSeconds });
        return { operation, outcome, version };
      }
      operation = "upsert";
      const document = buildListingSearchDocument(record.projection, handledAt);
      const outcome = await this.index.upsert(document, version);
      this.onObservation({ operation, outcome, priority, freshnessSeconds });
      return { operation, outcome, version };
    } catch (error: unknown) {
      this.onObservation({
        operation,
        outcome: "failed",
        priority,
        freshnessSeconds,
      });
      throw error;
    }
  }
}
