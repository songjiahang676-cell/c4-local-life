import type {
  InAppNotificationRecord,
  ListInAppNotificationsInput,
  ListInAppNotificationsResult,
  MarkInAppNotificationReadInput,
  NotificationStore,
} from "../../src/modules/notifications/notification.store";

export class MemoryNotificationStore implements NotificationStore {
  readonly #notifications = new Map<string, InAppNotificationRecord>();

  register(notification: InAppNotificationRecord): void {
    this.#notifications.set(notification.id, {
      ...notification,
      createdAt: new Date(notification.createdAt),
      readAt: notification.readAt ? new Date(notification.readAt) : null,
    });
  }

  listInApp(input: ListInAppNotificationsInput): Promise<ListInAppNotificationsResult> {
    const scoped = [...this.#notifications.values()]
      .filter(
        (notification) =>
          notification.userId === input.userId &&
          (!input.unreadOnly || notification.status === "UNREAD"),
      )
      .sort(
        (left, right) =>
          right.createdAt.getTime() - left.createdAt.getTime() || right.id.localeCompare(left.id),
      )
      .filter((notification) => {
        if (!input.cursor) return true;
        return (
          notification.createdAt < input.cursor.createdAt ||
          (notification.createdAt.getTime() === input.cursor.createdAt.getTime() &&
            notification.id < input.cursor.id)
        );
      });
    const page = scoped.slice(0, input.limit);
    const last = page.at(-1);
    return Promise.resolve({
      items: page.map((notification) => ({ ...notification })),
      nextCursor:
        scoped.length > input.limit && last ? { id: last.id, createdAt: last.createdAt } : null,
      unreadCount: [...this.#notifications.values()].filter(
        (notification) => notification.userId === input.userId && notification.status === "UNREAD",
      ).length,
    });
  }

  markInAppRead(input: MarkInAppNotificationReadInput): Promise<InAppNotificationRecord | null> {
    const notification = this.#notifications.get(input.notificationId);
    if (!notification || notification.userId !== input.userId) {
      return Promise.resolve(null);
    }
    if (notification.status === "UNREAD") {
      notification.status = "READ";
      notification.readAt = new Date(input.readAt);
    }
    return Promise.resolve({ ...notification });
  }
}
