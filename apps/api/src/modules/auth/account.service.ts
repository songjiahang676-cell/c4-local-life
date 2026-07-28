import { createHmac, timingSafeEqual } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type { ApiEnvironment } from "@socal/config";
import type {
  ListMySessionsQuery,
  MyProfile,
  SessionDeviceCollection,
  UpdateMyProfileRequest,
} from "@socal/contracts";
import { API_ENVIRONMENT } from "../../common/api-environment.token";
import {
  AUTH_SESSION_STORE,
  type AuthSessionStore,
  type SessionListCursor,
  type UserProfileProjection,
} from "./auth-session.store";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class AccountProfileConflictError extends Error {
  constructor() {
    super("Profile version conflict");
    this.name = "AccountProfileConflictError";
  }
}

export class AccountUnavailableError extends Error {
  constructor() {
    super("Account is unavailable");
    this.name = "AccountUnavailableError";
  }
}

export class InvalidHomeRegionError extends Error {
  constructor() {
    super("Home region is unavailable");
    this.name = "InvalidHomeRegionError";
  }
}

export class InvalidSessionCursorError extends Error {
  constructor() {
    super("Session cursor is invalid");
    this.name = "InvalidSessionCursorError";
  }
}

type SessionCursorPayload = {
  version: 1;
  userId: string;
  lastSeenAt: string;
  id: string;
};

function supportedLocale(locale: string): "zh-Hans" | "en-US" {
  return locale === "en-US" ? "en-US" : "zh-Hans";
}

function toProfile(profile: UserProfileProjection): MyProfile {
  return {
    id: profile.id,
    displayName: profile.displayName,
    avatarUrl: profile.avatarUrl,
    bio: profile.bio,
    preferredLocale: supportedLocale(profile.preferredLocale),
    homeRegionId: profile.homeRegionId,
    version: profile.version,
    updatedAt: profile.updatedAt.toISOString(),
  };
}

function cursorSignature(secret: string, encoded: string): string {
  return createHmac("sha256", secret)
    .update("socal-session-page-cursor-v1\0", "utf8")
    .update(encoded, "utf8")
    .digest("base64url");
}

function signaturesMatch(expected: string, provided: string): boolean {
  const expectedBytes = Buffer.from(expected, "utf8");
  const providedBytes = Buffer.from(provided, "utf8");
  return (
    expectedBytes.length === providedBytes.length && timingSafeEqual(expectedBytes, providedBytes)
  );
}

export function profileEtag(version: number): string {
  return `"profile-v${version}"`;
}

export function profileVersionFromEtag(value: string | undefined): number | null {
  if (!value) return null;
  const match = /^"profile-v([1-9]\d{0,9})"$/.exec(value);
  if (!match) return null;
  const version = Number(match[1]);
  return Number.isSafeInteger(version) && version <= 2_147_483_647 ? version : null;
}

@Injectable()
export class AccountService {
  readonly #cursorSecret: string;

  constructor(
    @Inject(API_ENVIRONMENT) environment: ApiEnvironment,
    @Inject(AUTH_SESSION_STORE) private readonly store: AuthSessionStore,
  ) {
    this.#cursorSecret = environment.SESSION_SECRET.reveal();
  }

  async getProfile(userId: string): Promise<MyProfile> {
    const profile = await this.store.findProfile(userId);
    if (!profile) throw new AccountUnavailableError();
    return toProfile(profile);
  }

  async updateProfile(
    userId: string,
    expectedVersion: number,
    input: UpdateMyProfileRequest,
  ): Promise<MyProfile> {
    const result = await this.store.updateProfile({
      userId,
      expectedVersion,
      ...input,
    });
    if (result.kind === "conflict") throw new AccountProfileConflictError();
    if (result.kind === "invalid_region") throw new InvalidHomeRegionError();
    if (result.kind === "not_found") throw new AccountUnavailableError();
    return toProfile(result.profile);
  }

  async listSessions(
    userId: string,
    currentSessionId: string,
    query: ListMySessionsQuery,
    now = new Date(),
  ): Promise<SessionDeviceCollection> {
    const cursor = query.cursor ? this.#decodeCursor(query.cursor, userId) : undefined;
    const result = await this.store.listActiveSessions({
      userId,
      now,
      limit: query.limit ?? 20,
      ...(cursor ? { cursor } : {}),
    });
    return {
      data: result.items.map((session) => ({
        id: session.id,
        current: session.id === currentSessionId,
        userAgent: session.userAgent,
        createdAt: session.createdAt.toISOString(),
        lastSeenAt: session.lastSeenAt.toISOString(),
        expiresAt: session.expiresAt.toISOString(),
      })),
      pageInfo: {
        hasMore: result.nextCursor !== null,
        nextCursor: result.nextCursor ? this.#encodeCursor(userId, result.nextCursor) : null,
      },
    };
  }

  revokeSession(userId: string, sessionId: string, now = new Date()): Promise<void> {
    return this.store.revokeSessionForUser(userId, sessionId, now);
  }

  revokeAllSessions(userId: string, now = new Date()): Promise<number> {
    return this.store.revokeAllSessionsForUser(userId, now);
  }

  #encodeCursor(userId: string, cursor: SessionListCursor): string {
    const payload: SessionCursorPayload = {
      version: 1,
      userId,
      lastSeenAt: cursor.lastSeenAt.toISOString(),
      id: cursor.id,
    };
    const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
    return `${encoded}.${cursorSignature(this.#cursorSecret, encoded)}`;
  }

  #decodeCursor(value: string, userId: string): SessionListCursor {
    const parts = value.split(".");
    if (parts.length !== 2) throw new InvalidSessionCursorError();
    const [encoded, providedSignature] = parts;
    if (
      !encoded ||
      !providedSignature ||
      !signaturesMatch(cursorSignature(this.#cursorSecret, encoded), providedSignature)
    ) {
      throw new InvalidSessionCursorError();
    }

    try {
      const payload = JSON.parse(
        Buffer.from(encoded, "base64url").toString("utf8"),
      ) as Partial<SessionCursorPayload>;
      if (
        payload.version !== 1 ||
        payload.userId !== userId ||
        typeof payload.lastSeenAt !== "string" ||
        typeof payload.id !== "string" ||
        !uuidPattern.test(payload.id)
      ) {
        throw new InvalidSessionCursorError();
      }
      const lastSeenAt = new Date(payload.lastSeenAt);
      if (Number.isNaN(lastSeenAt.getTime()) || lastSeenAt.toISOString() !== payload.lastSeenAt) {
        throw new InvalidSessionCursorError();
      }
      return { id: payload.id, lastSeenAt };
    } catch (error) {
      if (error instanceof InvalidSessionCursorError) throw error;
      throw new InvalidSessionCursorError();
    }
  }
}
