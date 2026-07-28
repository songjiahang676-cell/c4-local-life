import { randomUUID } from "node:crypto";
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
  readonly #profiles = new Map<string, UserProfileProjection>();
  readonly #activeRegionIds = new Set<string>();

  registerSubject(user: AuthSessionPrincipal["user"]): void {
    this.#subjects.set(user.id, user);
    this.#profiles.set(user.id, {
      id: user.id,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      bio: null,
      preferredLocale: user.preferredLocale,
      homeRegionId: null,
      version: 1,
      updatedAt: new Date("2026-07-25T00:00:00.000Z"),
    });
  }

  registerRegion(regionId: string): void {
    this.#activeRegionIds.add(regionId);
  }

  clear(): void {
    this.createInputs.length = 0;
    this.lookupHashes.length = 0;
    this.#sessions.clear();
    this.#subjects.clear();
    this.#profiles.clear();
    this.#activeRegionIds.clear();
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

  findProfile(userId: string): Promise<UserProfileProjection | null> {
    return Promise.resolve(this.#profiles.get(userId) ?? null);
  }

  updateProfile(input: UserProfileUpdateInput): Promise<UserProfileUpdateResult> {
    const profile = this.#profiles.get(input.userId);
    if (!profile) return Promise.resolve({ kind: "not_found" });
    if (profile.version !== input.expectedVersion) {
      return Promise.resolve({ kind: "conflict" });
    }
    if (input.homeRegionId && !this.#activeRegionIds.has(input.homeRegionId)) {
      return Promise.resolve({ kind: "invalid_region" });
    }

    const updated: UserProfileProjection = {
      ...profile,
      ...(input.displayName === undefined ? {} : { displayName: input.displayName }),
      ...(input.bio === undefined ? {} : { bio: input.bio }),
      ...(input.preferredLocale === undefined ? {} : { preferredLocale: input.preferredLocale }),
      ...(input.homeRegionId === undefined ? {} : { homeRegionId: input.homeRegionId }),
      version: profile.version + 1,
      updatedAt: new Date(profile.updatedAt.getTime() + 1),
    };
    this.#profiles.set(input.userId, updated);
    const subject = this.#subjects.get(input.userId);
    if (subject) {
      subject.displayName = updated.displayName;
      subject.preferredLocale = updated.preferredLocale;
    }
    return Promise.resolve({ kind: "updated", profile: updated });
  }

  listActiveSessions(input: {
    userId: string;
    now: Date;
    limit: number;
    cursor?: SessionListCursor;
  }): Promise<{ items: ActiveSessionDevice[]; nextCursor: SessionListCursor | null }> {
    const ordered = [...this.#sessions.values()]
      .filter(
        (stored) =>
          stored.principal.session.userId === input.userId &&
          !stored.revokedAt &&
          stored.principal.session.expiresAt > input.now &&
          stored.principal.session.idleExpiresAt > input.now,
      )
      .map((stored) => ({
        id: stored.principal.session.id,
        userAgent:
          this.createInputs.find((candidate) => candidate.tokenHash === stored.tokenHash)
            ?.userAgent ?? null,
        createdAt: stored.principal.session.createdAt,
        lastSeenAt: stored.principal.session.lastSeenAt,
        expiresAt:
          stored.principal.session.expiresAt <= stored.principal.session.idleExpiresAt
            ? stored.principal.session.expiresAt
            : stored.principal.session.idleExpiresAt,
      }))
      .sort(
        (left, right) =>
          right.lastSeenAt.getTime() - left.lastSeenAt.getTime() || right.id.localeCompare(left.id),
      )
      .filter((session) => {
        if (!input.cursor) return true;
        return (
          session.lastSeenAt < input.cursor.lastSeenAt ||
          (session.lastSeenAt.getTime() === input.cursor.lastSeenAt.getTime() &&
            session.id < input.cursor.id)
        );
      });
    const page = ordered.slice(0, input.limit);
    const last = page.at(-1);
    return Promise.resolve({
      items: page,
      nextCursor:
        ordered.length > input.limit && last ? { id: last.id, lastSeenAt: last.lastSeenAt } : null,
    });
  }

  revokeSessionForUser(userId: string, sessionId: string, now: Date): Promise<void> {
    const stored = [...this.#sessions.values()].find(
      (candidate) =>
        candidate.principal.session.userId === userId &&
        candidate.principal.session.id === sessionId,
    );
    if (stored && !stored.revokedAt) stored.revokedAt = now;
    return Promise.resolve();
  }

  revokeAllSessionsForUser(userId: string, now: Date): Promise<number> {
    let count = 0;
    for (const stored of this.#sessions.values()) {
      if (stored.principal.session.userId === userId && !stored.revokedAt) {
        stored.revokedAt = now;
        count += 1;
      }
    }
    return Promise.resolve(count);
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
