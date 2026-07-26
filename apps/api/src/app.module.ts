import { type DynamicModule, Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import type { ApiEnvironment } from "@socal/config";
import { API_ENVIRONMENT } from "./common/api-environment.token";
import { CsrfOriginGuard } from "./common/csrf-origin.guard";
import { AuthModule } from "./modules/auth/auth.module";
import type { AuthSessionStore } from "./modules/auth/auth-session.store";
import { HealthModule } from "./modules/health/health.module";
import { ListingsModule } from "./modules/listings/listings.module";

@Module({})
export class AppModule {
  static register(environment: ApiEnvironment, authSessionStore?: AuthSessionStore): DynamicModule {
    return {
      module: AppModule,
      imports: [AuthModule.register(environment, authSessionStore), HealthModule, ListingsModule],
      providers: [
        { provide: API_ENVIRONMENT, useValue: environment },
        { provide: APP_GUARD, useClass: CsrfOriginGuard },
      ],
    };
  }
}
