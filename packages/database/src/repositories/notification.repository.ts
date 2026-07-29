import { PrismaPg } from "@prisma/adapter-pg";
import { z } from "zod";
import {
  NotificationChannel,
  NotificationStatus,
  Prisma,
  PrismaClient,
  UserStatus,
} from "../../generated/prisma/client";

export type NotificationRepositoryOptions = {
  connectionString: string;
  poolMaximum?: number;
};

export const listingNotificationEventTypes = [
  "listing.submitted",
  "listing.published",
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

export type ListingNotificationEventType = (typeof listingNotificationEventTypes)[number];
export type NotificationLocale = "zh-Hans" | "en-US";

export type ListingNotificationEventInput = {
  eventId: string;
  eventType: ListingNotificationEventType;
  listingId: string;
  aggregateVersion: number;
  occurredAt: Date;
  riskTier?: "LOW" | "MEDIUM" | "HIGH";
};

export const organizationInvitationNotificationEventTypes = [
  "organization.invitation.created",
] as const;

export type OrganizationInvitationNotificationEventInput = {
  eventId: string;
  eventType: (typeof organizationInvitationNotificationEventTypes)[number];
  invitationId: string;
  aggregateVersion: number;
  occurredAt: Date;
};

export type ConsumeListingNotificationResult =
  | { kind: "created"; notification: InAppNotificationRecord }
  | { kind: "existing"; notification: InAppNotificationRecord }
  | { kind: "ignored" | "recipient_unavailable" };

export type NotificationCursor = {
  createdAt: Date;
  id: string;
};

export type ListInAppNotificationsInput = {
  userId: string;
  unreadOnly: boolean;
  cursor?: NotificationCursor;
  limit: number;
};

export type ListInAppNotificationsResult = {
  items: InAppNotificationRecord[];
  nextCursor: NotificationCursor | null;
  unreadCount: number;
};

export type MarkInAppNotificationReadInput = {
  userId: string;
  notificationId: string;
  readAt: Date;
};

export type InAppNotificationRecord = {
  id: string;
  userId: string;
  templateKey: string;
  templateVersion: number;
  locale: NotificationLocale;
  title: string;
  body: string;
  resourceType: "LISTING" | "ORGANIZATION_INVITATION";
  resourceId: string;
  status: "UNREAD" | "READ";
  createdAt: Date;
  readAt: Date | null;
};

export class NotificationEventValidationError extends Error {
  constructor() {
    super("Notification event is invalid");
    this.name = "NotificationEventValidationError";
  }
}

export class NotificationTemplateUnavailableError extends Error {
  constructor() {
    super("Published notification template is unavailable");
    this.name = "NotificationTemplateUnavailableError";
  }
}

type NotificationClient = PrismaClient | Prisma.TransactionClient;

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const templateVariableSchema = z
  .object({
    type: z.literal("object"),
    required: z.tuple([z.literal("resourceId"), z.literal("aggregateVersion")]),
    properties: z
      .object({
        resourceId: z
          .object({
            type: z.literal("string"),
            format: z.literal("uuid"),
          })
          .strict(),
        aggregateVersion: z
          .object({
            type: z.literal("integer"),
            minimum: z.literal(1),
          })
          .strict(),
      })
      .strict(),
    additionalProperties: z.literal(false),
  })
  .strict();

const notificationSelect = {
  id: true,
  userId: true,
  templateKey: true,
  templateVersion: true,
  locale: true,
  title: true,
  body: true,
  resourceType: true,
  resourceId: true,
  status: true,
  createdAt: true,
  readAt: true,
} satisfies Prisma.NotificationSelect;

type SelectedNotification = Prisma.NotificationGetPayload<{ select: typeof notificationSelect }>;

function isRepositoryOptions(
  target: NotificationClient | NotificationRepositoryOptions,
): target is NotificationRepositoryOptions {
  return "connectionString" in target;
}

function normalizedLocale(value: string): NotificationLocale {
  return value === "en-US" ? "en-US" : "zh-Hans";
}

function templateKey(input: ListingNotificationEventInput): string | null {
  if (input.eventType === "listing.submitted") {
    return input.riskTier === "MEDIUM" ? "listing.status.submitted" : null;
  }
  const keys: Record<Exclude<ListingNotificationEventType, "listing.submitted">, string> = {
    "listing.published": "listing.status.published",
    "listing.moderation.escalated": "listing.status.reviewing",
    "listing.moderation.returned": "listing.status.changes_requested",
    "listing.moderation.rejected": "listing.status.rejected",
    "listing.moderation.removed": "listing.status.removed",
    "listing.appeal.upheld": "listing.status.appeal_upheld",
    "listing.appeal.restored": "listing.status.appeal_restored",
    "listing.archived": "listing.status.archived",
    "listing.deleted": "listing.status.deleted",
    "listing.expired": "listing.status.expired",
  };
  return keys[input.eventType];
}

function toRecord(row: SelectedNotification): InAppNotificationRecord {
  if (
    (row.locale !== "zh-Hans" && row.locale !== "en-US") ||
    (row.resourceType !== "LISTING" && row.resourceType !== "ORGANIZATION_INVITATION") ||
    !row.resourceId ||
    (row.status !== NotificationStatus.SENT && row.status !== NotificationStatus.READ)
  ) {
    throw new Error("Stored in-app notification projection is invalid");
  }
  return {
    id: row.id,
    userId: row.userId,
    templateKey: row.templateKey,
    templateVersion: row.templateVersion,
    locale: row.locale,
    title: row.title,
    body: row.body,
    resourceType: row.resourceType,
    resourceId: row.resourceId,
    status: row.status === NotificationStatus.READ ? "READ" : "UNREAD",
    createdAt: row.createdAt,
    readAt: row.readAt,
  };
}

function assertOrganizationInvitationNotificationInput(
  input: OrganizationInvitationNotificationEventInput,
): void {
  if (
    !uuidPattern.test(input.eventId) ||
    !uuidPattern.test(input.invitationId) ||
    !organizationInvitationNotificationEventTypes.includes(input.eventType) ||
    input.aggregateVersion !== 1 ||
    !Number.isFinite(input.occurredAt.getTime())
  ) {
    throw new NotificationEventValidationError();
  }
}

function assertListingNotificationInput(input: ListingNotificationEventInput): void {
  if (
    !uuidPattern.test(input.eventId) ||
    !uuidPattern.test(input.listingId) ||
    !listingNotificationEventTypes.includes(input.eventType) ||
    !Number.isInteger(input.aggregateVersion) ||
    input.aggregateVersion < 1 ||
    !Number.isFinite(input.occurredAt.getTime())
  ) {
    throw new NotificationEventValidationError();
  }
}

export class NotificationRepository {
  readonly #client: NotificationClient;
  readonly #ownedClient: PrismaClient | null;

  constructor(target: NotificationClient | NotificationRepositoryOptions) {
    if (isRepositoryOptions(target)) {
      const adapter = new PrismaPg({
        connectionString: target.connectionString,
        max: target.poolMaximum ?? 10,
      });
      this.#ownedClient = new PrismaClient({ adapter });
      this.#client = this.#ownedClient;
      return;
    }
    this.#client = target;
    this.#ownedClient = null;
  }

  consumeListingEvent(
    input: ListingNotificationEventInput,
  ): Promise<ConsumeListingNotificationResult> {
    assertListingNotificationInput(input);
    const key = templateKey(input);
    if (!key) return Promise.resolve({ kind: "ignored" });

    return this.#inTransaction(async (transaction) => {
      await transaction.$executeRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${input.eventId}, 7411))`,
      );
      const listing = await transaction.listing.findUnique({
        where: { id: input.listingId },
        select: {
          id: true,
          type: true,
          version: true,
          owner: {
            select: {
              id: true,
              status: true,
              deletedAt: true,
              profile: { select: { preferredLocale: true } },
            },
          },
        },
      });
      if (!listing || listing.version < input.aggregateVersion) {
        throw new NotificationEventValidationError();
      }
      if (
        (listing.owner.status !== UserStatus.ACTIVE &&
          listing.owner.status !== UserStatus.LIMITED) ||
        listing.owner.deletedAt ||
        !listing.owner.profile
      ) {
        return { kind: "recipient_unavailable" };
      }

      const existing = await transaction.notification.findFirst({
        where: {
          sourceEventId: input.eventId,
          userId: listing.owner.id,
          channel: NotificationChannel.IN_APP,
        },
        select: notificationSelect,
      });
      if (existing) return { kind: "existing", notification: toRecord(existing) };

      const locale = normalizedLocale(listing.owner.profile.preferredLocale);
      const template = await transaction.notificationTemplate.findFirst({
        where: {
          key,
          channel: NotificationChannel.IN_APP,
          locale,
          publishedAt: { not: null },
        },
        orderBy: [{ version: "desc" }, { id: "desc" }],
        select: {
          id: true,
          key: true,
          version: true,
          title: true,
          body: true,
          variableSchema: true,
        },
      });
      if (!template || !templateVariableSchema.safeParse(template.variableSchema).success) {
        throw new NotificationTemplateUnavailableError();
      }
      const variables = {
        resourceId: listing.id,
        aggregateVersion: input.aggregateVersion,
      } satisfies Prisma.InputJsonObject;
      const notification = await transaction.notification.create({
        data: {
          userId: listing.owner.id,
          channel: NotificationChannel.IN_APP,
          templateId: template.id,
          templateKey: template.key,
          templateVersion: template.version,
          locale,
          title: template.title,
          body: template.body,
          payload: variables,
          resourceType: "LISTING",
          resourceId: listing.id,
          sourceEventId: input.eventId,
          aggregateVersion: input.aggregateVersion,
          status: NotificationStatus.SENT,
          scheduledAt: input.occurredAt,
          sentAt: input.occurredAt,
          createdAt: input.occurredAt,
          updatedAt: input.occurredAt,
        },
        select: notificationSelect,
      });
      return { kind: "created", notification: toRecord(notification) };
    });
  }

  consumeOrganizationInvitationEvent(
    input: OrganizationInvitationNotificationEventInput,
  ): Promise<ConsumeListingNotificationResult> {
    assertOrganizationInvitationNotificationInput(input);
    return this.#inTransaction(async (transaction) => {
      await transaction.$executeRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${input.eventId}, 7411))`,
      );
      const invitation = await transaction.organizationInvitation.findUnique({
        where: { id: input.invitationId },
        select: {
          id: true,
          status: true,
          expiresAt: true,
          invitee: {
            select: {
              id: true,
              status: true,
              deletedAt: true,
              profile: { select: { preferredLocale: true } },
            },
          },
        },
      });
      if (!invitation) throw new NotificationEventValidationError();

      const existing = await transaction.notification.findFirst({
        where: {
          sourceEventId: input.eventId,
          userId: invitation.invitee.id,
          channel: NotificationChannel.IN_APP,
        },
        select: notificationSelect,
      });
      if (existing) return { kind: "existing", notification: toRecord(existing) };
      if (invitation.status !== "PENDING" || invitation.expiresAt <= input.occurredAt) {
        return { kind: "ignored" };
      }
      if (
        (invitation.invitee.status !== UserStatus.ACTIVE &&
          invitation.invitee.status !== UserStatus.LIMITED) ||
        invitation.invitee.deletedAt ||
        !invitation.invitee.profile
      ) {
        return { kind: "recipient_unavailable" };
      }

      const locale = normalizedLocale(invitation.invitee.profile.preferredLocale);
      const template = await transaction.notificationTemplate.findFirst({
        where: {
          key: input.eventType,
          channel: NotificationChannel.IN_APP,
          locale,
          publishedAt: { not: null },
        },
        orderBy: [{ version: "desc" }, { id: "desc" }],
        select: {
          id: true,
          key: true,
          version: true,
          title: true,
          body: true,
          variableSchema: true,
        },
      });
      if (!template || !templateVariableSchema.safeParse(template.variableSchema).success) {
        throw new NotificationTemplateUnavailableError();
      }
      const variables = {
        resourceId: invitation.id,
        aggregateVersion: input.aggregateVersion,
      } satisfies Prisma.InputJsonObject;
      const notification = await transaction.notification.create({
        data: {
          userId: invitation.invitee.id,
          channel: NotificationChannel.IN_APP,
          templateId: template.id,
          templateKey: template.key,
          templateVersion: template.version,
          locale,
          title: template.title,
          body: template.body,
          payload: variables,
          resourceType: "ORGANIZATION_INVITATION",
          resourceId: invitation.id,
          sourceEventId: input.eventId,
          aggregateVersion: input.aggregateVersion,
          status: NotificationStatus.SENT,
          scheduledAt: input.occurredAt,
          sentAt: input.occurredAt,
          createdAt: input.occurredAt,
          updatedAt: input.occurredAt,
        },
        select: notificationSelect,
      });
      return { kind: "created", notification: toRecord(notification) };
    });
  }

  async listInApp(input: ListInAppNotificationsInput): Promise<ListInAppNotificationsResult> {
    if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 50) {
      throw new TypeError("Notification page limit must be between 1 and 50");
    }
    const where = {
      userId: input.userId,
      channel: NotificationChannel.IN_APP,
      templateId: { not: null },
      resourceType: { in: ["LISTING", "ORGANIZATION_INVITATION"] },
      resourceId: { not: null },
      status: input.unreadOnly
        ? NotificationStatus.SENT
        : { in: [NotificationStatus.SENT, NotificationStatus.READ] },
      ...(input.cursor
        ? {
            OR: [
              { createdAt: { lt: input.cursor.createdAt } },
              {
                createdAt: input.cursor.createdAt,
                id: { lt: input.cursor.id },
              },
            ],
          }
        : {}),
    } satisfies Prisma.NotificationWhereInput;
    const rows = await this.#client.notification.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: input.limit + 1,
      select: notificationSelect,
    });
    const unreadCount = await this.#client.notification.count({
      where: {
        userId: input.userId,
        channel: NotificationChannel.IN_APP,
        templateId: { not: null },
        resourceType: { in: ["LISTING", "ORGANIZATION_INVITATION"] },
        resourceId: { not: null },
        status: NotificationStatus.SENT,
      },
    });
    const pageRows = rows.slice(0, input.limit);
    const last = pageRows.at(-1);
    return {
      items: pageRows.map(toRecord),
      nextCursor:
        rows.length > input.limit && last ? { createdAt: last.createdAt, id: last.id } : null,
      unreadCount,
    };
  }

  markInAppRead(input: MarkInAppNotificationReadInput): Promise<InAppNotificationRecord | null> {
    if (!Number.isFinite(input.readAt.getTime())) {
      return Promise.reject(new TypeError("Notification read time must be finite"));
    }
    return this.#inTransaction(async (transaction) => {
      await transaction.notification.updateMany({
        where: {
          id: input.notificationId,
          userId: input.userId,
          channel: NotificationChannel.IN_APP,
          templateId: { not: null },
          resourceType: { in: ["LISTING", "ORGANIZATION_INVITATION"] },
          resourceId: { not: null },
          status: NotificationStatus.SENT,
          readAt: null,
        },
        data: {
          status: NotificationStatus.READ,
          readAt: input.readAt,
          updatedAt: input.readAt,
        },
      });
      const row = await transaction.notification.findFirst({
        where: {
          id: input.notificationId,
          userId: input.userId,
          channel: NotificationChannel.IN_APP,
          templateId: { not: null },
          resourceType: { in: ["LISTING", "ORGANIZATION_INVITATION"] },
          resourceId: { not: null },
          status: NotificationStatus.READ,
        },
        select: notificationSelect,
      });
      return row ? toRecord(row) : null;
    });
  }

  close(): Promise<void> {
    return this.#ownedClient?.$disconnect() ?? Promise.resolve();
  }

  #inTransaction<T>(operation: (transaction: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    if (this.#ownedClient) {
      return this.#ownedClient.$transaction(operation, {
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      });
    }
    return operation(this.#client as Prisma.TransactionClient);
  }
}
