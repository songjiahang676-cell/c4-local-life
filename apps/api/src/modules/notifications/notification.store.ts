import type {
  InAppNotificationRecord,
  ListInAppNotificationsInput,
  ListInAppNotificationsResult,
  MarkInAppNotificationReadInput,
} from "@socal/database/notification";

export const NOTIFICATION_STORE = Symbol("NOTIFICATION_STORE");

export type NotificationStore = {
  listInApp(input: ListInAppNotificationsInput): Promise<ListInAppNotificationsResult>;
  markInAppRead(input: MarkInAppNotificationReadInput): Promise<InAppNotificationRecord | null>;
};

export type {
  InAppNotificationRecord,
  ListInAppNotificationsInput,
  ListInAppNotificationsResult,
  MarkInAppNotificationReadInput,
};
