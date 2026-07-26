import { Inject, Injectable, type OnModuleDestroy } from "@nestjs/common";
import type { ApiEnvironment } from "@socal/config";
import {
  AuthSessionRepository,
  type AuthSessionCreateInput,
  type AuthSessionPrincipal,
  type AuthSessionRotateInput,
} from "@socal/database/auth-session";
import { API_ENVIRONMENT } from "../../common/api-environment.token";
import type { AuthSessionStore } from "./auth-session.store";

@Injectable()
export class DatabaseAuthSessionStore implements AuthSessionStore, OnModuleDestroy {
  readonly #repository: AuthSessionRepository;

  constructor(@Inject(API_ENVIRONMENT) environment: ApiEnvironment) {
    this.#repository = new AuthSessionRepository({
      connectionString: environment.DATABASE_URL,
      poolMaximum: environment.DATABASE_POOL_MAX,
    });
  }

  findActiveByTokenHash(tokenHash: string, now: Date): Promise<AuthSessionPrincipal | null> {
    return this.#repository.findActiveByTokenHash(tokenHash, now);
  }

  create(input: AuthSessionCreateInput): Promise<AuthSessionPrincipal | null> {
    return this.#repository.create(input);
  }

  rotate(input: AuthSessionRotateInput): Promise<AuthSessionPrincipal | null> {
    return this.#repository.rotate(input);
  }

  touch(tokenHash: string, now: Date, touchBefore: Date, idleExpiresAt: Date): Promise<boolean> {
    return this.#repository.touch(tokenHash, now, touchBefore, idleExpiresAt);
  }

  revokeByTokenHash(tokenHash: string, now: Date): Promise<boolean> {
    return this.#repository.revokeByTokenHash(tokenHash, now);
  }

  onModuleDestroy(): Promise<void> {
    return this.#repository.close();
  }
}
