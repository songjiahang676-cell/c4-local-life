import type {
  ActiveSessionDevice,
  AuthSessionCreateInput,
  AuthSessionPrincipal,
  AuthSessionRotateInput,
  SessionListCursor,
  UserProfileProjection,
  UserProfileUpdateInput,
  UserProfileUpdateResult,
} from "@socal/database/auth-session";

export const AUTH_SESSION_STORE = Symbol("AUTH_SESSION_STORE");

export type AuthSessionStore = {
  findActiveByTokenHash(tokenHash: string, now: Date): Promise<AuthSessionPrincipal | null>;
  create(input: AuthSessionCreateInput): Promise<AuthSessionPrincipal | null>;
  rotate(input: AuthSessionRotateInput): Promise<AuthSessionPrincipal | null>;
  touch(tokenHash: string, now: Date, touchBefore: Date, idleExpiresAt: Date): Promise<boolean>;
  revokeByTokenHash(tokenHash: string, now: Date): Promise<boolean>;
  findProfile(userId: string): Promise<UserProfileProjection | null>;
  updateProfile(input: UserProfileUpdateInput): Promise<UserProfileUpdateResult>;
  listActiveSessions(input: {
    userId: string;
    now: Date;
    limit: number;
    cursor?: SessionListCursor;
  }): Promise<{ items: ActiveSessionDevice[]; nextCursor: SessionListCursor | null }>;
  revokeSessionForUser(userId: string, sessionId: string, now: Date): Promise<void>;
  revokeAllSessionsForUser(userId: string, now: Date): Promise<number>;
};

export type {
  ActiveSessionDevice,
  AuthSessionPrincipal,
  SessionListCursor,
  UserProfileProjection,
  UserProfileUpdateInput,
  UserProfileUpdateResult,
};
