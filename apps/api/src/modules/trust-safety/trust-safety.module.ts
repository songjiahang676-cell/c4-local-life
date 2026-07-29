import { type DynamicModule, Module, type Provider } from "@nestjs/common";
import type { ApiEnvironment } from "@socal/config";
import { API_ENVIRONMENT } from "../../common/api-environment.token";
import { DatabaseTrustSafetyStore } from "./database-trust-safety.store";
import {
  AppealModerationController,
  PublicTrustSafetyController,
  ReportModerationController,
} from "./trust-safety.controller";
import { TrustSafetyService } from "./trust-safety.service";
import { TRUST_SAFETY_STORE, type TrustSafetyStore } from "./trust-safety.store";

@Module({})
export class TrustSafetyModule {
  static register(environment: ApiEnvironment, store?: TrustSafetyStore): DynamicModule {
    const storeProviders: Provider[] = store
      ? [{ provide: TRUST_SAFETY_STORE, useValue: store }]
      : [
          DatabaseTrustSafetyStore,
          {
            provide: TRUST_SAFETY_STORE,
            useExisting: DatabaseTrustSafetyStore,
          },
        ];
    return {
      module: TrustSafetyModule,
      controllers: [
        PublicTrustSafetyController,
        ReportModerationController,
        AppealModerationController,
      ],
      providers: [
        { provide: API_ENVIRONMENT, useValue: environment },
        ...storeProviders,
        TrustSafetyService,
      ],
    };
  }
}
