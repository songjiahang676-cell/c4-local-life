import { createHmac, randomBytes } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type { ApiEnvironment } from "@socal/config";
import type { Session } from "@socal/contracts";
import { API_ENVIRONMENT } from "../../common/api-environment.token";
import {
  accountSelfServicePermissions,
  activeUserPermissions,
  adminPolicyActions,
} from "../../common/authorization/policy";
import {
  AUTH_SESSION_STORE,
  type AuthSessionPrincipal,
  type AuthSessionStore,
} from "./auth-session.store";
import { isSessionToken, serializeSessionCookie } from "./session-cookie";

const millisecondsPerSecond = 1_000;

export class SessionSubjectUnavailableError extends Error {
  constructor() {
    super("Session subject is unavailable");
    this.name = "SessionSubjectUnavailableError";
  }
}

export type SessionClientMetadata = {
  userAgent?: string;
  ipAddress?: string;
};

export type IssuedSession = {
  token: string;
  cookie: string;
  sessionId: string;
  response: Session;
};

function addSeconds(value: Date, seconds: number): Date {
  return new Date(value.getTime() + seconds * millisecondsPerSecond);
}

function earlierDate(first: Date, second: Date): Date {
  return first.getTime() <= second.getTime() ? first : second;
}

function cleanUserAgent(userAgent: string | undefined): string | null {
  if (!userAgent) return null;
  const cleaned = Array.from(userAgent, (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 31 || codePoint === 127 ? " " : character;
  })
    .join("")
    .trim();
  return cleaned.length > 0 ? cleaned.slice(0, 512) : null;
}

function supportedLocale(locale: string): "zh-Hans" | "en-US" {
  return locale === "en-US" ? "en-US" : "zh-Hans";
}

export function hashSessionToken(token: string, secret: string): string {
  return createHmac("sha256", secret)
    .update("socal-session-token-v1\0", "utf8")
    .update(token, "utf8")
    .digest("hex");
}

function hashIpAddress(ipAddress: string | undefined, secret: string): string | null {
  if (!ipAddress) return null;
  return createHmac("sha256", secret)
    .update("socal-session-ip-v1\0", "utf8")
    .update(ipAddress, "utf8")
    .digest("hex");
}

function toSessionResponse(principal: AuthSessionPrincipal): Session {
  const effectiveExpiry = earlierDate(principal.session.expiresAt, principal.session.idleExpiresAt);
  const platformRoles =
    principal.user.status === "ACTIVE" ? [...principal.platformRoles].sort() : [];
  return {
    user: {
      id: principal.user.id,
      displayName: principal.user.displayName,
      avatarUrl: principal.user.avatarUrl,
      locale: supportedLocale(principal.user.preferredLocale),
      status: principal.user.status,
      verificationBadges: [],
    },
    expiresAt: effectiveExpiry.toISOString(),
    permissions:
      principal.user.status === "ACTIVE"
        ? [
            ...activeUserPermissions,
            ...(platformRoles.length > 0 ? [adminPolicyActions.consoleAccess] : []),
          ]
        : [...accountSelfServicePermissions],
    platformRoles,
    organizations: principal.organizations.map((organization) => ({
      id: organization.id,
      type: organization.type,
      displayName: organization.displayName,
      slug: organization.slug,
      role: organization.role,
    })),
  };
}

@Injectable()
export class AuthSessionService {
  readonly #secret: string;

  constructor(
    @Inject(API_ENVIRONMENT) private readonly environment: ApiEnvironment,
    @Inject(AUTH_SESSION_STORE) private readonly store: AuthSessionStore,
  ) {
    this.#secret = environment.SESSION_SECRET.reveal();
  }

  async issueSession(
    userId: string,
    metadata: SessionClientMetadata,
    now = new Date(),
  ): Promise<IssuedSession> {
    const token = randomBytes(32).toString("base64url");
    const tokenHash = hashSessionToken(token, this.#secret);
    const expiresAt = addSeconds(now, this.environment.SESSION_ABSOLUTE_TTL_SECONDS);
    const idleExpiresAt = earlierDate(
      expiresAt,
      addSeconds(now, this.environment.SESSION_IDLE_TTL_SECONDS),
    );
    const principal = await this.store.create({
      userId,
      tokenHash,
      userAgent: cleanUserAgent(metadata.userAgent),
      ipHash: hashIpAddress(metadata.ipAddress, this.#secret),
      expiresAt,
      idleExpiresAt,
      now,
    });
    if (!principal) throw new SessionSubjectUnavailableError();
    return this.#issued(token, principal, now);
  }

  async rotateSession(
    currentToken: string,
    metadata: SessionClientMetadata,
    now = new Date(),
  ): Promise<IssuedSession | null> {
    const current = await this.resolveToken(currentToken, now);
    if (!current) return null;

    const token = randomBytes(32).toString("base64url");
    const tokenHash = hashSessionToken(token, this.#secret);
    const expiresAt = addSeconds(now, this.environment.SESSION_ABSOLUTE_TTL_SECONDS);
    const idleExpiresAt = earlierDate(
      expiresAt,
      addSeconds(now, this.environment.SESSION_IDLE_TTL_SECONDS),
    );
    const principal = await this.store.rotate({
      userId: current.response.user.id,
      currentTokenHash: hashSessionToken(currentToken, this.#secret),
      tokenHash,
      userAgent: cleanUserAgent(metadata.userAgent),
      ipHash: hashIpAddress(metadata.ipAddress, this.#secret),
      expiresAt,
      idleExpiresAt,
      now,
    });
    return principal ? this.#issued(token, principal, now) : null;
  }

  async resolveToken(
    token: string,
    now = new Date(),
  ): Promise<{ sessionId: string; response: Session } | null> {
    if (!isSessionToken(token)) return null;
    const tokenHash = hashSessionToken(token, this.#secret);
    const principal = await this.store.findActiveByTokenHash(tokenHash, now);
    if (!principal) return null;

    const touchInterval = this.environment.SESSION_TOUCH_INTERVAL_SECONDS * millisecondsPerSecond;
    if (now.getTime() - principal.session.lastSeenAt.getTime() >= touchInterval) {
      const idleExpiresAt = earlierDate(
        principal.session.expiresAt,
        addSeconds(now, this.environment.SESSION_IDLE_TTL_SECONDS),
      );
      const touchBefore = new Date(now.getTime() - touchInterval);
      if (!(await this.store.touch(tokenHash, now, touchBefore, idleExpiresAt))) return null;
      principal.session.lastSeenAt = now;
      principal.session.idleExpiresAt = idleExpiresAt;
    }

    return {
      sessionId: principal.session.id,
      response: toSessionResponse(principal),
    };
  }

  logout(token: string, now = new Date()): Promise<boolean> {
    if (!isSessionToken(token)) return Promise.resolve(false);
    return this.store.revokeByTokenHash(hashSessionToken(token, this.#secret), now);
  }

  #issued(token: string, principal: AuthSessionPrincipal, now: Date): IssuedSession {
    const maximumAgeSeconds = Math.floor(
      (principal.session.expiresAt.getTime() - now.getTime()) / millisecondsPerSecond,
    );
    return {
      token,
      cookie: serializeSessionCookie(
        this.environment.SESSION_COOKIE_NAME,
        token,
        maximumAgeSeconds,
      ),
      sessionId: principal.session.id,
      response: toSessionResponse(principal),
    };
  }
}
