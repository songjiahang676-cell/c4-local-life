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

@Module({})
export class AuthModule {
  static register(environment: ApiEnvironment, sessionStore?: AuthSessionStore): DynamicModule {
    const storeProviders: Provider[] = sessionStore
      ? [{ provide: AUTH_SESSION_STORE, useValue: sessionStore }]
      : [
          DatabaseAuthSessionStore,
          { provide: AUTH_SESSION_STORE, useExisting: DatabaseAuthSessionStore },
        ];

    return {
      module: AuthModule,
      controllers: [AuthController],
      providers: [
        { provide: API_ENVIRONMENT, useValue: environment },
        ...storeProviders,
        AuthContextAccessor,
        AuthSessionService,
        AuthContextGuard,
        { provide: APP_GUARD, useExisting: AuthContextGuard },
      ],
      exports: [AuthContextAccessor, AuthSessionService],
    };
  }
}
