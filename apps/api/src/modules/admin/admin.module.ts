import { type DynamicModule, Module, type Provider } from "@nestjs/common";
import type { ApiEnvironment } from "@socal/config";
import { API_ENVIRONMENT } from "../../common/api-environment.token";
import { AdminSessionController } from "./admin-session.controller";
import { AdminSessionService } from "./admin-session.service";
import { DatabaseMfaStore } from "./database-mfa.store";
import { MfaController } from "./mfa.controller";
import { MfaService } from "./mfa.service";
import { MFA_STORE, type MfaStore } from "./mfa.store";

@Module({})
export class AdminModule {
  static register(environment: ApiEnvironment, mfaStore?: MfaStore): DynamicModule {
    const storeProviders: Provider[] = mfaStore
      ? [{ provide: MFA_STORE, useValue: mfaStore }]
      : [DatabaseMfaStore, { provide: MFA_STORE, useExisting: DatabaseMfaStore }];
    return {
      module: AdminModule,
      controllers: [AdminSessionController, MfaController],
      providers: [
        { provide: API_ENVIRONMENT, useValue: environment },
        ...storeProviders,
        AdminSessionService,
        MfaService,
      ],
      exports: [MfaService],
    };
  }
}
