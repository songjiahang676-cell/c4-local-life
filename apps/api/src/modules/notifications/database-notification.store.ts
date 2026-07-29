import { Inject, Injectable, type OnModuleDestroy } from "@nestjs/common";
import type { ApiEnvironment } from "@socal/config";
import {
  NotificationRepository,
  type InAppNotificationRecord,
  type ListInAppNotificationsInput,
  type ListInAppNotificationsResult,
  type MarkInAppNotificationReadInput,
} from "@socal/database/notification";
import { API_ENVIRONMENT } from "../../common/api-environment.token";
import type { NotificationStore } from "./notification.store";

@Injectable()
export class DatabaseNotificationStore implements NotificationStore, OnModuleDestroy {
  readonly #repository: NotificationRepository;

  constructor(@Inject(API_ENVIRONMENT) environment: ApiEnvironment) {
    this.#repository = new NotificationRepository({
      connectionString: environment.DATABASE_URL,
      poolMaximum: environment.DATABASE_POOL_MAX,
    });
  }

  listInApp(input: ListInAppNotificationsInput): Promise<ListInAppNotificationsResult> {
    return this.#repository.listInApp(input);
  }

  markInAppRead(input: MarkInAppNotificationReadInput): Promise<InAppNotificationRecord | null> {
    return this.#repository.markInAppRead(input);
  }

  onModuleDestroy(): Promise<void> {
    return this.#repository.close();
  }
}
