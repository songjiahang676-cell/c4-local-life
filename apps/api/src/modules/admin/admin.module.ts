import { type DynamicModule, Module, type Provider } from "@nestjs/common";
import type { ApiEnvironment } from "@socal/config";
import { API_ENVIRONMENT } from "../../common/api-environment.token";
import { AdminSessionController } from "./admin-session.controller";
import { AdminSessionService } from "./admin-session.service";
import { DatabaseModerationStore } from "./database-moderation.store";
import { DatabaseMfaStore } from "./database-mfa.store";
import { MfaController } from "./mfa.controller";
import { MfaService } from "./mfa.service";
import { ModerationController } from "./moderation.controller";
import { ModerationService } from "./moderation.service";
import { MODERATION_STORE, type ModerationStore } from "./moderation.store";
import { MFA_STORE, type MfaStore } from "./mfa.store";

@Module({})
export class AdminModule {
  static register(
    environment: ApiEnvironment,
    mfaStore?: MfaStore,
    moderationStore?: ModerationStore,
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
    return {
      module: AdminModule,
      controllers: [AdminSessionController, MfaController, ModerationController],
      providers: [
        { provide: API_ENVIRONMENT, useValue: environment },
        ...storeProviders,
        ...moderationStoreProviders,
        AdminSessionService,
        MfaService,
        ModerationService,
      ],
      exports: [MfaService],
    };
  }
}
