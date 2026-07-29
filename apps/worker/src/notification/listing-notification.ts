import {
  NotificationEventValidationError,
  NotificationTemplateUnavailableError,
  listingNotificationEventTypes,
  type ConsumeListingNotificationResult,
  type ListingNotificationEventInput,
  type ListingNotificationEventType,
  type NotificationRepository,
} from "@socal/database/notification";
import type { OutboxJobEnvelope } from "../outbox/bullmq-outbox.publisher";

export type ListingNotificationOutcome =
  "created" | "duplicate" | "ignored" | "recipient_unavailable" | "failed";

export type ListingNotificationRepository = Pick<NotificationRepository, "consumeListingEvent">;

export class PermanentListingNotificationError extends Error {
  readonly code = "LISTING_NOTIFICATION_EVENT_INVALID";

  constructor() {
    super("The listing notification event cannot be processed");
    this.name = "PermanentListingNotificationError";
  }
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const riskTiers = ["LOW", "MEDIUM", "HIGH"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isListingNotificationEventType(value: unknown): value is ListingNotificationEventType {
  return (
    typeof value === "string" &&
    listingNotificationEventTypes.includes(value as ListingNotificationEventType)
  );
}

function isRiskTier(value: unknown): value is ListingNotificationEventInput["riskTier"] {
  return typeof value === "string" && riskTiers.includes(value as (typeof riskTiers)[number]);
}

export function parseListingNotificationEnvelope(
  value: unknown,
  expectedEventType: ListingNotificationEventType,
): ListingNotificationEventInput {
  if (!isRecord(value)) throw new PermanentListingNotificationError();
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
    !isListingNotificationEventType(envelope.eventType) ||
    typeof envelope.occurredAt !== "string" ||
    !isRecord(payload) ||
    payload.schemaVersion !== 1 ||
    payload.listingId !== envelope.aggregateId ||
    !Number.isInteger(payload.aggregateVersion) ||
    (payload.aggregateVersion as number) < 1
  ) {
    throw new PermanentListingNotificationError();
  }
  const occurredAt = new Date(envelope.occurredAt);
  if (!Number.isFinite(occurredAt.getTime()) || occurredAt.toISOString() !== envelope.occurredAt) {
    throw new PermanentListingNotificationError();
  }
  const riskTier = payload.riskTier;
  if (expectedEventType === "listing.submitted" && !isRiskTier(riskTier)) {
    throw new PermanentListingNotificationError();
  }
  if (riskTier !== undefined && !isRiskTier(riskTier)) {
    throw new PermanentListingNotificationError();
  }
  return {
    eventId: envelope.eventId,
    eventType: expectedEventType,
    listingId: envelope.aggregateId,
    aggregateVersion: payload.aggregateVersion as number,
    occurredAt,
    ...(riskTier ? { riskTier } : {}),
  };
}

function outcome(result: ConsumeListingNotificationResult): ListingNotificationOutcome {
  if (result.kind === "existing") return "duplicate";
  return result.kind;
}

export class ListingNotificationHandler {
  constructor(
    private readonly repository: ListingNotificationRepository,
    private readonly onOutcome: (value: ListingNotificationOutcome) => void = () => undefined,
  ) {}

  async handle(value: unknown, eventType: ListingNotificationEventType): Promise<void> {
    let input: ListingNotificationEventInput;
    try {
      input = parseListingNotificationEnvelope(value, eventType);
    } catch (error: unknown) {
      this.onOutcome("failed");
      if (error instanceof PermanentListingNotificationError) throw error;
      throw new PermanentListingNotificationError();
    }

    try {
      const result = await this.repository.consumeListingEvent(input);
      this.onOutcome(outcome(result));
    } catch (error: unknown) {
      this.onOutcome("failed");
      if (
        error instanceof NotificationEventValidationError ||
        error instanceof NotificationTemplateUnavailableError
      ) {
        throw new PermanentListingNotificationError();
      }
      throw error;
    }
  }
}
