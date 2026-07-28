import { type DynamicModule, Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import type { ApiEnvironment } from "@socal/config";
import { API_ENVIRONMENT } from "./common/api-environment.token";
import { AuthorizationModule } from "./common/authorization/authorization.module";
import { CsrfOriginGuard } from "./common/csrf-origin.guard";
import { AuthModule } from "./modules/auth/auth.module";
import type { AuthSessionStore } from "./modules/auth/auth-session.store";
import type { OtpChallengeStore } from "./modules/auth/otp-challenge.store";
import type { OtpDeliveryGateway } from "./modules/auth/otp-delivery.gateway";
import { HealthModule } from "./modules/health/health.module";
import { ListingsModule } from "./modules/listings/listings.module";

@Module({})
export class AppModule {
  static register(
    environment: ApiEnvironment,
    authSessionStore?: AuthSessionStore,
    otpChallengeStore?: OtpChallengeStore,
    otpDeliveryGateway?: OtpDeliveryGateway,
  ): DynamicModule {
    return {
      module: AppModule,
      imports: [
        AuthorizationModule,
        AuthModule.register(environment, authSessionStore, otpChallengeStore, otpDeliveryGateway),
        HealthModule,
        ListingsModule,
      ],
      providers: [
        { provide: API_ENVIRONMENT, useValue: environment },
        { provide: APP_GUARD, useClass: CsrfOriginGuard },
      ],
    };
  }
}
