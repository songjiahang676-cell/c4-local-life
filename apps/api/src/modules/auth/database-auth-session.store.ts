import { Inject, Injectable, type OnModuleDestroy } from "@nestjs/common";
import type { ApiEnvironment } from "@socal/config";
import {
  AuthSessionRepository,
  type ActiveSessionDevice,
  type AuthSessionCreateInput,
  type AuthSessionPrincipal,
  type AuthSessionRotateInput,
  type SessionListCursor,
  type UserProfileProjection,
  type UserProfileUpdateInput,
  type UserProfileUpdateResult,
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

  findProfile(userId: string): Promise<UserProfileProjection | null> {
    return this.#repository.findProfile(userId);
  }

  updateProfile(input: UserProfileUpdateInput): Promise<UserProfileUpdateResult> {
    return this.#repository.updateProfile(input);
  }

  listActiveSessions(input: {
    userId: string;
    now: Date;
    limit: number;
    cursor?: SessionListCursor;
  }): Promise<{ items: ActiveSessionDevice[]; nextCursor: SessionListCursor | null }> {
    return this.#repository.listActiveSessions(input);
  }

  revokeSessionForUser(userId: string, sessionId: string, now: Date): Promise<void> {
    return this.#repository.revokeSessionForUser(userId, sessionId, now);
  }

  revokeAllSessionsForUser(userId: string, now: Date): Promise<number> {
    return this.#repository.revokeAllSessionsForUser(userId, now);
  }

  onModuleDestroy(): Promise<void> {
    return this.#repository.close();
  }
}
