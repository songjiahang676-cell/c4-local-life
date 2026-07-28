import { type DynamicModule, Global, Module, type Provider } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import type { ApiEnvironment } from "@socal/config";
import { API_ENVIRONMENT } from "../../common/api-environment.token";
import { AuthorizationGuard } from "../../common/authorization/authorization.guard";
import { AccountController } from "./account.controller";
import { AccountService } from "./account.service";
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
import { DatabasePasswordStore } from "./database-password.store";
import {
  UnavailablePasswordNotificationGateway,
  PASSWORD_NOTIFICATION_GATEWAY,
  type PasswordNotificationGateway,
} from "./password-notification.gateway";
import { PasswordController } from "./password.controller";
import { PasswordService } from "./password.service";
import { PASSWORD_STORE, type PasswordStore } from "./password.store";

@Global()
@Module({})
export class AuthModule {
  static register(
    environment: ApiEnvironment,
    sessionStore?: AuthSessionStore,
    challengeStore?: OtpChallengeStore,
    deliveryGateway?: OtpDeliveryGateway,
    passwordStore?: PasswordStore,
    passwordNotificationGateway?: PasswordNotificationGateway,
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
    const passwordProviders: Provider[] = passwordStore
      ? [{ provide: PASSWORD_STORE, useValue: passwordStore }]
      : [DatabasePasswordStore, { provide: PASSWORD_STORE, useExisting: DatabasePasswordStore }];

    return {
      module: AuthModule,
      controllers: [AuthController, OtpController, PasswordController, AccountController],
      providers: [
        { provide: API_ENVIRONMENT, useValue: environment },
        ...storeProviders,
        ...challengeProviders,
        ...passwordProviders,
        {
          provide: OTP_DELIVERY_GATEWAY,
          useValue: deliveryGateway ?? new FailClosedOtpDeliveryGateway(),
        },
        {
          provide: PASSWORD_NOTIFICATION_GATEWAY,
          useValue: passwordNotificationGateway ?? new UnavailablePasswordNotificationGateway(),
        },
        AuthContextAccessor,
        AuthSessionService,
        AccountService,
        OtpService,
        PasswordService,
        AuthContextGuard,
        { provide: APP_GUARD, useExisting: AuthContextGuard },
        AuthorizationGuard,
        { provide: APP_GUARD, useExisting: AuthorizationGuard },
      ],
      exports: [
        AuthContextAccessor,
        AuthSessionService,
        AccountService,
        OtpService,
        PasswordService,
      ],
    };
  }
}
