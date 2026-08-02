import { type DynamicModule, Module, type Provider } from "@nestjs/common";
import type { ApiEnvironment } from "@socal/config";
import type { MetricsRegistry } from "@socal/observability";
import { API_ENVIRONMENT } from "../../common/api-environment.token";
import { API_METRICS } from "../../common/api-metrics.token";
import { AdminSessionController } from "./admin-session.controller";
import { AdminSessionService } from "./admin-session.service";
import { DatabaseModerationStore } from "./database-moderation.store";
import { DatabaseMfaStore } from "./database-mfa.store";
import { DatabaseQueueOperationsStore } from "./database-queue-operations.store";
import { MfaController } from "./mfa.controller";
import { MfaService } from "./mfa.service";
import { ModerationController } from "./moderation.controller";
import { ModerationService } from "./moderation.service";
import { MODERATION_STORE, type ModerationStore } from "./moderation.store";
import { MFA_STORE, type MfaStore } from "./mfa.store";
import { QueueOperationsController } from "./queue-operations.controller";
import { QueueOperationsService } from "./queue-operations.service";
import { QUEUE_OPERATIONS_STORE, type QueueOperationsStore } from "./queue-operations.store";

@Module({})
export class AdminModule {
  static register(
    environment: ApiEnvironment,
    mfaStore?: MfaStore,
    moderationStore?: ModerationStore,
    metrics?: MetricsRegistry,
    queueOperationsStore?: QueueOperationsStore,
  ): DynamicModule {
    const storeProviders: Provider[] = mfaStore
      ? [{ provide: MFA_STORE, useValue: mfaStore }]
      : [DatabaseMfaStore, { provide: MFA_STORE, useExisting: DatabaseMfaStore }];
    const moderationStoreProviders: Provider[] = moderationStore
      ? [{ provide: MODERATION_STORE, useValue: moderationStore }]
      : [
          DatabaseModerationStore,
          { provide: MODERATION_STORE, useExisting: DatabaseModerationStore },
        ];
    const queueOperationsStoreProviders: Provider[] = queueOperationsStore
      ? [{ provide: QUEUE_OPERATIONS_STORE, useValue: queueOperationsStore }]
      : [
          DatabaseQueueOperationsStore,
          { provide: QUEUE_OPERATIONS_STORE, useExisting: DatabaseQueueOperationsStore },
        ];
    return {
      module: AdminModule,
      controllers: [
        AdminSessionController,
        MfaController,
        ModerationController,
        QueueOperationsController,
      ],
      providers: [
        { provide: API_ENVIRONMENT, useValue: environment },
        ...(metrics ? [{ provide: API_METRICS, useValue: metrics }] : []),
        ...storeProviders,
        ...moderationStoreProviders,
        ...queueOperationsStoreProviders,
        AdminSessionService,
        MfaService,
        ModerationService,
        QueueOperationsService,
      ],
      exports: [MfaService],
    };
  }
}
