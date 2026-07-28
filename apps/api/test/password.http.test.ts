import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { parseApiEnvironment } from "@socal/config";
import type {
  PasswordRecoveryAcceptedResponse,
  ProblemDetails,
  SessionResponse,
} from "@socal/contracts";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApiApplication } from "../src/create-api-application";
import { hashPassword } from "../src/modules/auth/password-crypto";
import { buildActiveSubject, MemoryAuthSessionStore } from "./support/memory-auth-session.store";
import {
  CapturingPasswordNotificationGateway,
  MemoryPasswordStore,
} from "./support/memory-password.store";

const loginUserId = "30000000-0000-4000-8000-000000000041";
const recoveryUserId = "30000000-0000-4000-8000-000000000042";
const deviceId = "synthetic-password-device-0001";
const currentPassword = "Synthetic current password 2026!";
const replacementPassword = "Synthetic replacement password 2026!";
const environment = parseApiEnvironment({
  NODE_ENV: "test",
  APP_ENV: "test",
  PUBLIC_WEB_URL: "https://web.example.invalid",
  PUBLIC_ADMIN_URL: "https://admin.example.invalid",
  DATABASE_URL: "postgresql://example.invalid/socal",
  REDIS_URL: "redis://localhost:6379/0",
  OPENSEARCH_NODE: "https://search.example.invalid",
  SESSION_SECRET: "password-http-session-secret-with-more-than-32-bytes",
  OTP_SECRET: "password-http-otp-secret-with-more-than-32-bytes",
  MFA_SECRET: "password-http-mfa-secret-with-more-than-32-bytes",
  PASSWORD_PEPPER: "password-http-dedicated-pepper-with-more-than-32-bytes",
  CSRF_SECRET: "password-http-csrf-secret-with-more-than-32-bytes",
  PASSWORD_LOGIN_MAX_FAILURES: "3",
  PASSWORD_RECOVERY_COOLDOWN_SECONDS: "300",
  PASSWORD_RECOVERY_TTL_SECONDS: "1800",
});

describe("password authentication HTTP boundary", () => {
  let app: NestFastifyApplication;
  let server: FastifyInstance;
  let sessions: MemoryAuthSessionStore;
  let passwords: MemoryPasswordStore;
  let notifications: CapturingPasswordNotificationGateway;

  beforeAll(async () => {
    sessions = new MemoryAuthSessionStore();
    passwords = new MemoryPasswordStore();
    notifications = new CapturingPasswordNotificationGateway();
    sessions.registerSubject(
      buildActiveSubject({
        id: loginUserId,
        displayName: "Synthetic Password Login User",
        preferredLocale: "en-US",
      }),
    );
    sessions.registerSubject(
      buildActiveSubject({
        id: recoveryUserId,
        displayName: "Synthetic Password Recovery User",
        preferredLocale: "en-US",
      }),
    );
    const passwordHash = await hashPassword(currentPassword, environment.PASSWORD_PEPPER.reveal());
    passwords.registerAccount({
      userId: loginUserId,
      identifier: "login-member@example.invalid",
      passwordHash,
      locale: "en-US",
    });
    passwords.registerAccount({
      userId: recoveryUserId,
      identifier: "recovery-member@example.invalid",
      passwordHash,
      locale: "en-US",
    });
    passwords.registerAccount({
      userId: "30000000-0000-4000-8000-000000000043",
      identifier: "unavailable-member@example.invalid",
      passwordHash,
      locale: "en-US",
    });
    app = await createApiApplication(environment, {
      logger: false,
      authSessionStore: sessions,
      passwordStore: passwords,
      passwordNotificationGateway: notifications,
    });
    await app.init();
    server = app.getHttpAdapter().getInstance();
    await server.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("establishes a hardened primary session and keeps invalid credentials generic", async () => {
    const authenticated = await server.inject({
      method: "POST",
      url: "/v1/auth/password/login",
      headers: { "x-device-id": deviceId },
      payload: {
        identifier: "LOGIN-MEMBER@EXAMPLE.INVALID",
        password: currentPassword,
      },
    });
    const incorrect = await server.inject({
      method: "POST",
      url: "/v1/auth/password/login",
      headers: { "x-device-id": "synthetic-password-device-0002" },
      payload: {
        identifier: "login-member@example.invalid",
        password: "A different but sufficiently long password!",
      },
    });
    const unknown = await server.inject({
      method: "POST",
      url: "/v1/auth/password/login",
      headers: { "x-device-id": "synthetic-password-device-0003" },
      payload: {
        identifier: "unknown@example.invalid",
        password: "A different but sufficiently long password!",
      },
    });
    const unavailable = await server.inject({
      method: "POST",
      url: "/v1/auth/password/login",
      headers: { "x-device-id": "synthetic-password-device-0004" },
      payload: {
        identifier: "unavailable-member@example.invalid",
        password: currentPassword,
      },
    });

    expect(authenticated.statusCode).toBe(200);
    expect(authenticated.headers["cache-control"]).toBe("no-store");
    expect(authenticated.headers["set-cookie"]).toContain("HttpOnly");
    expect(authenticated.headers["set-cookie"]).toContain("Secure");
    expect(authenticated.headers["set-cookie"]).toContain("SameSite=Lax");
    expect(authenticated.json<SessionResponse>().data.user.id).toBe(loginUserId);
    for (const rejected of [incorrect, unknown, unavailable]) {
      expect(rejected.statusCode).toBe(401);
      expect(rejected.json<ProblemDetails>()).toMatchObject({
        title: "Unauthorized",
        detail: "The credentials are invalid",
      });
      expect(rejected.body).not.toContain("unknown@example.invalid");
    }
  });

  it("enforces validation, device binding, and bounded rate-limit responses", async () => {
    const missingDevice = await server.inject({
      method: "POST",
      url: "/v1/auth/password/login",
      payload: {
        identifier: "login-member@example.invalid",
        password: currentPassword,
      },
    });
    const malformed = await server.inject({
      method: "POST",
      url: "/v1/auth/password/recovery",
      headers: { "x-device-id": deviceId },
      payload: { channel: "SMS", destination: "not-a-phone-number" },
    });
    passwords.forceRateLimited = true;
    const limited = await server.inject({
      method: "POST",
      url: "/v1/auth/password/login",
      headers: { "x-device-id": deviceId },
      payload: {
        identifier: "login-member@example.invalid",
        password: currentPassword,
      },
    });
    passwords.forceRateLimited = false;

    expect(missingDevice.statusCode).toBe(400);
    expect(malformed.statusCode).toBe(400);
    expect(limited.statusCode).toBe(429);
    expect(limited.headers["retry-after"]).toBe("60");
  });

  it("uses uniform recovery acceptance, cooldown, one-time proof, and no auto-login", async () => {
    const knownMessageIndex = notifications.messages.length;
    const known = await server.inject({
      method: "POST",
      url: "/v1/auth/password/recovery",
      headers: { "x-device-id": "synthetic-recovery-device-01" },
      payload: {
        channel: "EMAIL",
        destination: "recovery-member@example.invalid",
      },
    });
    const unknownMessageIndex = notifications.messages.length;
    const unknown = await server.inject({
      method: "POST",
      url: "/v1/auth/password/recovery",
      headers: { "x-device-id": "synthetic-recovery-device-02" },
      payload: {
        channel: "EMAIL",
        destination: "missing-member@example.invalid",
      },
    });
    const accepted = known.json<PasswordRecoveryAcceptedResponse>();
    const knownMessage = notifications.messages[knownMessageIndex];
    const unknownMessage = notifications.messages[unknownMessageIndex];
    if (!knownMessage || knownMessage.kind !== "RECOVERY_REQUESTED") {
      throw new Error("Expected a captured recovery message");
    }

    expect(known.statusCode).toBe(202);
    expect(unknown.statusCode).toBe(202);
    expect(Object.keys(unknown.json())).toEqual(Object.keys(accepted));
    expect(known.body).not.toContain(knownMessage.token);
    expect(knownMessage).toMatchObject({
      deliverable: true,
      destination: "recovery-member@example.invalid",
      requestId: accepted.recoveryRequestId,
    });
    expect(unknownMessage).toMatchObject({ kind: "RECOVERY_REQUESTED", deliverable: false });

    const coolingDown = await server.inject({
      method: "POST",
      url: "/v1/auth/password/recovery/confirm",
      headers: { "x-device-id": "synthetic-recovery-device-01" },
      payload: {
        recoveryRequestId: accepted.recoveryRequestId,
        token: knownMessage.token,
        newPassword: replacementPassword,
      },
    });
    expect(coolingDown.statusCode).toBe(429);
    expect(Number(coolingDown.headers["retry-after"])).toBeGreaterThan(0);

    passwords.makeRecoveryReady(accepted.recoveryRequestId);
    const invalidProof = await server.inject({
      method: "POST",
      url: "/v1/auth/password/recovery/confirm",
      headers: { "x-device-id": "synthetic-recovery-device-01" },
      payload: {
        recoveryRequestId: accepted.recoveryRequestId,
        token: "A".repeat(43),
        newPassword: replacementPassword,
      },
    });
    const completed = await server.inject({
      method: "POST",
      url: "/v1/auth/password/recovery/confirm",
      headers: { "x-device-id": "synthetic-recovery-device-01" },
      payload: {
        recoveryRequestId: accepted.recoveryRequestId,
        token: knownMessage.token,
        newPassword: replacementPassword,
      },
    });
    const replay = await server.inject({
      method: "POST",
      url: "/v1/auth/password/recovery/confirm",
      headers: { "x-device-id": "synthetic-recovery-device-01" },
      payload: {
        recoveryRequestId: accepted.recoveryRequestId,
        token: knownMessage.token,
        newPassword: replacementPassword,
      },
    });

    expect(invalidProof.statusCode).toBe(400);
    expect(invalidProof.json<ProblemDetails>().detail).toBe(
      "The password recovery request is invalid or expired",
    );
    expect(completed.statusCode).toBe(200);
    expect(completed.headers["set-cookie"]).toBeUndefined();
    expect(completed.json()).toEqual({
      data: { passwordChanged: true, sessionsRevoked: true },
    });
    expect(replay.statusCode).toBe(400);
    expect(notifications.messages.at(-1)).toMatchObject({
      kind: "PASSWORD_CHANGED",
      destination: "recovery-member@example.invalid",
    });

    const oldPassword = await server.inject({
      method: "POST",
      url: "/v1/auth/password/login",
      headers: { "x-device-id": "synthetic-recovery-device-03" },
      payload: {
        identifier: "recovery-member@example.invalid",
        password: currentPassword,
      },
    });
    const newPassword = await server.inject({
      method: "POST",
      url: "/v1/auth/password/login",
      headers: { "x-device-id": "synthetic-recovery-device-04" },
      payload: {
        identifier: "recovery-member@example.invalid",
        password: replacementPassword,
      },
    });
    expect(oldPassword.statusCode).toBe(401);
    expect(newPassword.statusCode).toBe(200);
  });
});
