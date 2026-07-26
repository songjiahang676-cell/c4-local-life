import { type DynamicModule, Module, type Provider } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import type { ApiEnvironment } from "@socal/config";
import { API_ENVIRONMENT } from "../../common/api-environment.token";
import { AuthContextAccessor } from "./auth-context";
import { AuthContextGuard } from "./auth-context.guard";
import { AuthSessionService } from "./auth-session.service";
import { AUTH_SESSION_STORE, type AuthSessionStore } from "./auth-session.store";
import { AuthController } from "./auth.controller";
import { DatabaseAuthSessionStore } from "./database-auth-session.store";
import { DatabaseOtpChallengeStore } from "./database-otp-challenge.store";
import { OTP_CHALLENGE_STORE, type OtpChallengeStore } from "./otp-challenge.store";
import {
  FailClosedOtpDeliveryGateway,
  OTP_DELIVERY_GATEWAY,
  type OtpDeliveryGateway,
} from "./otp-delivery.gateway";
import { OtpController } from "./otp.controller";
import { OtpService } from "./otp.service";

@Module({})
export class AuthModule {
  static register(
    environment: ApiEnvironment,
    sessionStore?: AuthSessionStore,
    challengeStore?: OtpChallengeStore,
    deliveryGateway?: OtpDeliveryGateway,
  ): DynamicModule {
    const storeProviders: Provider[] = sessionStore
      ? [{ provide: AUTH_SESSION_STORE, useValue: sessionStore }]
      : [
          DatabaseAuthSessionStore,
          { provide: AUTH_SESSION_STORE, useExisting: DatabaseAuthSessionStore },
        ];
    const challengeProviders: Provider[] = challengeStore
      ? [{ provide: OTP_CHALLENGE_STORE, useValue: challengeStore }]
      : [
          DatabaseOtpChallengeStore,
          { provide: OTP_CHALLENGE_STORE, useExisting: DatabaseOtpChallengeStore },
        ];

    return {
      module: AuthModule,
      controllers: [AuthController, OtpController],
      providers: [
        { provide: API_ENVIRONMENT, useValue: environment },
        ...storeProviders,
        ...challengeProviders,
        {
          provide: OTP_DELIVERY_GATEWAY,
          useValue: deliveryGateway ?? new FailClosedOtpDeliveryGateway(),
        },
        AuthContextAccessor,
        AuthSessionService,
        OtpService,
        AuthContextGuard,
        { provide: APP_GUARD, useExisting: AuthContextGuard },
      ],
      exports: [AuthContextAccessor, AuthSessionService, OtpService],
    };
  }
}
