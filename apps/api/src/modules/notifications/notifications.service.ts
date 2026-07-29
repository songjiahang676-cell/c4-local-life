import { createHmac, timingSafeEqual } from "node:crypto";
import { Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import type { ApiEnvironment } from "@socal/config";
import type {
  InAppNotification,
  ListNotificationsQuery,
  NotificationCollection,
  NotificationResponse,
} from "@socal/contracts";
import { API_ENVIRONMENT } from "../../common/api-environment.token";
import {
  PolicyService,
  selfServicePolicyActions,
  type PolicyRequestContext,
} from "../../common/authorization/policy";
import {
  NOTIFICATION_STORE,
  type InAppNotificationRecord,
  type NotificationStore,
} from "./notification.store";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type NotificationCursorPayload = {
  version: 1;
  userId: string;
  unreadOnly: boolean;
  createdAt: string;
  id: string;
};

export class NotificationNotFoundError extends Error {
  constructor() {
    super("Notification not found");
    this.name = "NotificationNotFoundError";
  }
}

export class NotificationCursorError extends Error {
  constructor() {
    super("Notification cursor is invalid");
    this.name = "NotificationCursorError";
  }
}

function authenticatedUserId(context: PolicyRequestContext): string {
  if (context.actor.kind === "guest") {
    throw new UnauthorizedException("Authentication required");
  }
  return context.actor.userId;
}

function cursorSignature(secret: string, encoded: string): string {
  return createHmac("sha256", secret)
    .update("socal-in-app-notification-page-cursor-v1\0", "utf8")
    .update(encoded, "utf8")
    .digest("base64url");
}

function signaturesMatch(expected: string, provided: string): boolean {
  const expectedBytes = Buffer.from(expected, "utf8");
  const providedBytes = Buffer.from(provided, "utf8");
  return (
    expectedBytes.length === providedBytes.length && timingSafeEqual(expectedBytes, providedBytes)
  );
}

function toNotification(record: InAppNotificationRecord): InAppNotification {
  return {
    id: record.id,
    templateKey: record.templateKey,
    templateVersion: record.templateVersion,
    locale: record.locale,
    title: record.title,
    body: record.body,
    resource: {
      type: record.resourceType,
      id: record.resourceId,
    },
    status: record.status,
    createdAt: record.createdAt.toISOString(),
    readAt: record.readAt?.toISOString() ?? null,
  };
}

@Injectable()
export class NotificationsService {
  readonly #cursorSecret: string;

  constructor(
    @Inject(API_ENVIRONMENT) environment: ApiEnvironment,
    @Inject(NOTIFICATION_STORE) private readonly store: NotificationStore,
    private readonly policies: PolicyService,
  ) {
    this.#cursorSecret = environment.SESSION_SECRET.reveal();
  }

  async list(
    context: PolicyRequestContext,
    query: ListNotificationsQuery,
    now = new Date(),
  ): Promise<NotificationCollection> {
    await this.policies.require({
      action: selfServicePolicyActions.notificationsRead,
      context,
    });
    const userId = authenticatedUserId(context);
    const unreadOnly = query.unreadOnly ?? false;
    const cursor = query.cursor ? this.#decodeCursor(query.cursor, userId, unreadOnly) : undefined;
    const result = await this.store.listInApp({
      userId,
      unreadOnly,
      limit: query.limit ?? 20,
      ...(cursor ? { cursor } : {}),
    });
    return {
      data: result.items.map(toNotification),
      pageInfo: {
        hasMore: result.nextCursor !== null,
        nextCursor: result.nextCursor
          ? this.#encodeCursor(userId, unreadOnly, result.nextCursor)
          : null,
      },
      unreadCount: result.unreadCount,
      generatedAt: now.toISOString(),
    };
  }

  async markRead(
    context: PolicyRequestContext,
    notificationId: string,
    readAt = new Date(),
  ): Promise<NotificationResponse> {
    await this.policies.require({
      action: selfServicePolicyActions.notificationsUpdate,
      context,
    });
    const notification = await this.store.markInAppRead({
      userId: authenticatedUserId(context),
      notificationId,
      readAt,
    });
    if (!notification) throw new NotificationNotFoundError();
    return { data: toNotification(notification) };
  }

  #encodeCursor(
    userId: string,
    unreadOnly: boolean,
    cursor: { createdAt: Date; id: string },
  ): string {
    const payload: NotificationCursorPayload = {
      version: 1,
      userId,
      unreadOnly,
      createdAt: cursor.createdAt.toISOString(),
      id: cursor.id,
    };
    const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
    return `${encoded}.${cursorSignature(this.#cursorSecret, encoded)}`;
  }

  #decodeCursor(
    value: string,
    userId: string,
    unreadOnly: boolean,
  ): { createdAt: Date; id: string } {
    const [encoded, signature, extra] = value.split(".");
    if (!encoded || !signature || extra || encoded.length > 1_024) {
      throw new NotificationCursorError();
    }
    if (!signaturesMatch(cursorSignature(this.#cursorSecret, encoded), signature)) {
      throw new NotificationCursorError();
    }
    try {
      const payload = JSON.parse(
        Buffer.from(encoded, "base64url").toString("utf8"),
      ) as Partial<NotificationCursorPayload>;
      if (
        payload.version !== 1 ||
        payload.userId !== userId ||
        payload.unreadOnly !== unreadOnly ||
        typeof payload.createdAt !== "string" ||
        typeof payload.id !== "string" ||
        !uuidPattern.test(payload.id)
      ) {
        throw new NotificationCursorError();
      }
      const createdAt = new Date(payload.createdAt);
      if (!Number.isFinite(createdAt.getTime()) || createdAt.toISOString() !== payload.createdAt) {
        throw new NotificationCursorError();
      }
      return { createdAt, id: payload.id };
    } catch (error) {
      if (error instanceof NotificationCursorError) throw error;
      throw new NotificationCursorError();
    }
  }
}
