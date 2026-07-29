import {
  NotificationEventValidationError,
  NotificationTemplateUnavailableError,
  type ConsumeListingNotificationResult,
  type NotificationRepository,
  type OrganizationInvitationNotificationEventInput,
} from "@socal/database/notification";
import type { OutboxJobEnvelope } from "../outbox/bullmq-outbox.publisher";
import type { ListingNotificationOutcome } from "./listing-notification";

export type OrganizationInvitationNotificationRepository = Pick<
  NotificationRepository,
  "consumeOrganizationInvitationEvent"
>;

export class PermanentOrganizationInvitationNotificationError extends Error {
  readonly code = "ORGANIZATION_INVITATION_NOTIFICATION_EVENT_INVALID";

  constructor() {
    super("The organization invitation notification event cannot be processed");
    this.name = "PermanentOrganizationInvitationNotificationError";
  }
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function parseOrganizationInvitationNotificationEnvelope(
  value: unknown,
): OrganizationInvitationNotificationEventInput {
  if (!isRecord(value)) throw new PermanentOrganizationInvitationNotificationError();
  const envelope = value as Partial<OutboxJobEnvelope>;
  const payload = envelope.payload;
  if (
    envelope.version !== 1 ||
    typeof envelope.eventId !== "string" ||
    !uuidPattern.test(envelope.eventId) ||
    envelope.aggregateType !== "ORGANIZATION_INVITATION" ||
    typeof envelope.aggregateId !== "string" ||
    !uuidPattern.test(envelope.aggregateId) ||
    envelope.eventType !== "organization.invitation.created" ||
    typeof envelope.occurredAt !== "string" ||
    !isRecord(payload) ||
    payload.schemaVersion !== 1 ||
    payload.invitationId !== envelope.aggregateId ||
    payload.aggregateVersion !== 1
  ) {
    throw new PermanentOrganizationInvitationNotificationError();
  }
  const occurredAt = new Date(envelope.occurredAt);
  if (!Number.isFinite(occurredAt.getTime()) || occurredAt.toISOString() !== envelope.occurredAt) {
    throw new PermanentOrganizationInvitationNotificationError();
  }
  return {
    eventId: envelope.eventId,
    eventType: "organization.invitation.created",
    invitationId: envelope.aggregateId,
    aggregateVersion: 1,
    occurredAt,
  };
}

function outcome(result: ConsumeListingNotificationResult): ListingNotificationOutcome {
  if (result.kind === "existing") return "duplicate";
  return result.kind;
}

export class OrganizationInvitationNotificationHandler {
  constructor(
    private readonly repository: OrganizationInvitationNotificationRepository,
    private readonly onOutcome: (value: ListingNotificationOutcome) => void = () => undefined,
  ) {}

  async handle(value: unknown): Promise<void> {
    let input: OrganizationInvitationNotificationEventInput;
    try {
      input = parseOrganizationInvitationNotificationEnvelope(value);
    } catch (error: unknown) {
      this.onOutcome("failed");
      if (error instanceof PermanentOrganizationInvitationNotificationError) throw error;
      throw new PermanentOrganizationInvitationNotificationError();
    }
    try {
      const result = await this.repository.consumeOrganizationInvitationEvent(input);
      this.onOutcome(outcome(result));
    } catch (error: unknown) {
      this.onOutcome("failed");
      if (
        error instanceof NotificationEventValidationError ||
        error instanceof NotificationTemplateUnavailableError
      ) {
        throw new PermanentOrganizationInvitationNotificationError();
      }
      throw error;
    }
  }
}
