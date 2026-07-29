import { type DynamicModule, Module, type Provider } from "@nestjs/common";
import type { ApiEnvironment } from "@socal/config";
import { API_ENVIRONMENT } from "../../common/api-environment.token";
import { DatabaseNotificationStore } from "./database-notification.store";
import { NOTIFICATION_STORE, type NotificationStore } from "./notification.store";
import { NotificationsController } from "./notifications.controller";
import { NotificationsService } from "./notifications.service";

@Module({})
export class NotificationsModule {
  static register(environment: ApiEnvironment, store?: NotificationStore): DynamicModule {
    const storeProviders: Provider[] = store
      ? [{ provide: NOTIFICATION_STORE, useValue: store }]
      : [
          DatabaseNotificationStore,
          { provide: NOTIFICATION_STORE, useExisting: DatabaseNotificationStore },
        ];
    return {
      module: NotificationsModule,
      controllers: [NotificationsController],
      providers: [
        { provide: API_ENVIRONMENT, useValue: environment },
        ...storeProviders,
        NotificationsService,
      ],
      exports: [NotificationsService],
    };
  }
}
