import { randomUUID } from "node:crypto";
import type {
  AuthSessionCreateInput,
  AuthSessionPrincipal,
  AuthSessionRotateInput,
} from "@socal/database/auth-session";
import type { AuthSessionStore } from "../../src/modules/auth/auth-session.store";

type StoredSession = {
  tokenHash: string;
  revokedAt: Date | null;
  principal: AuthSessionPrincipal;
};

export class MemoryAuthSessionStore implements AuthSessionStore {
  readonly createInputs: AuthSessionCreateInput[] = [];
  readonly lookupHashes: string[] = [];
  readonly #sessions = new Map<string, StoredSession>();
  readonly #subjects = new Map<string, AuthSessionPrincipal["user"]>();

  registerSubject(user: AuthSessionPrincipal["user"]): void {
    this.#subjects.set(user.id, user);
  }

  findActiveByTokenHash(tokenHash: string, now: Date): Promise<AuthSessionPrincipal | null> {
    this.lookupHashes.push(tokenHash);
    const stored = this.#sessions.get(tokenHash);
    if (
      !stored ||
      stored.revokedAt ||
      stored.principal.session.expiresAt <= now ||
      stored.principal.session.idleExpiresAt <= now
    ) {
      return Promise.resolve(null);
    }
    return Promise.resolve(stored.principal);
  }

  create(input: AuthSessionCreateInput): Promise<AuthSessionPrincipal | null> {
    this.createInputs.push(input);
    const user = this.#subjects.get(input.userId);
    if (!user) return Promise.resolve(null);
    const principal: AuthSessionPrincipal = {
      session: {
        id: randomUUID(),
        userId: input.userId,
        expiresAt: input.expiresAt,
        idleExpiresAt: input.idleExpiresAt,
        lastSeenAt: input.now,
        createdAt: input.now,
      },
      user,
      organizations: [],
    };
    this.#sessions.set(input.tokenHash, {
      tokenHash: input.tokenHash,
      revokedAt: null,
      principal,
    });
    return Promise.resolve(principal);
  }

  async rotate(input: AuthSessionRotateInput): Promise<AuthSessionPrincipal | null> {
    const current = await this.findActiveByTokenHash(input.currentTokenHash, input.now);
    if (!current || current.user.id !== input.userId) return null;
    const stored = this.#sessions.get(input.currentTokenHash);
    if (!stored) return null;
    stored.revokedAt = input.now;
    return this.create(input);
  }

  touch(tokenHash: string, now: Date, touchBefore: Date, idleExpiresAt: Date): Promise<boolean> {
    const stored = this.#sessions.get(tokenHash);
    if (
      !stored ||
      stored.revokedAt ||
      stored.principal.session.expiresAt <= now ||
      stored.principal.session.idleExpiresAt <= now
    ) {
      return Promise.resolve(false);
    }
    if (stored.principal.session.lastSeenAt <= touchBefore) {
      stored.principal.session.lastSeenAt = now;
      stored.principal.session.idleExpiresAt = idleExpiresAt;
    }
    return Promise.resolve(true);
  }

  revokeByTokenHash(tokenHash: string, now: Date): Promise<boolean> {
    const stored = this.#sessions.get(tokenHash);
    if (!stored || stored.revokedAt) return Promise.resolve(false);
    stored.revokedAt = now;
    return Promise.resolve(true);
  }
}

export function buildActiveSubject(
  overrides: Partial<AuthSessionPrincipal["user"]> = {},
): AuthSessionPrincipal["user"] {
  return {
    id: randomUUID(),
    displayName: "Synthetic Session User",
    avatarUrl: null,
    preferredLocale: "zh-Hans",
    status: "ACTIVE",
    ...overrides,
  };
}
