import type {
  AuthSessionCreateInput,
  AuthSessionPrincipal,
  AuthSessionRotateInput,
} from "@socal/database/auth-session";

export const AUTH_SESSION_STORE = Symbol("AUTH_SESSION_STORE");

export type AuthSessionStore = {
  findActiveByTokenHash(tokenHash: string, now: Date): Promise<AuthSessionPrincipal | null>;
  create(input: AuthSessionCreateInput): Promise<AuthSessionPrincipal | null>;
  rotate(input: AuthSessionRotateInput): Promise<AuthSessionPrincipal | null>;
  touch(tokenHash: string, now: Date, touchBefore: Date, idleExpiresAt: Date): Promise<boolean>;
  revokeByTokenHash(tokenHash: string, now: Date): Promise<boolean>;
};

export type { AuthSessionPrincipal };
