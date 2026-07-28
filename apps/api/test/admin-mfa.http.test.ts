import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { parseApiEnvironment } from "@socal/config";
import type {
  AdminMfaActivationResponse,
  AdminMfaEnrollmentResponse,
  AdminMfaVerificationResponse,
  AdminSessionResponse,
} from "@socal/contracts";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApiApplication } from "../src/create-api-application";
import { decodeBase32, totpCode } from "../src/modules/admin/mfa-crypto";
import { AuthSessionService } from "../src/modules/auth/auth-session.service";
import { buildActiveSubject, MemoryAuthSessionStore } from "./support/memory-auth-session.store";
import { MemoryMfaStore } from "./support/memory-mfa.store";

const environment = parseApiEnvironment({
  NODE_ENV: "test",
  APP_ENV: "test",
  APP_NAME: "socal-api-admin-mfa-test",
  PUBLIC_WEB_URL: "https://web.example.invalid",
  PUBLIC_ADMIN_URL: "https://admin.example.invalid",
  DATABASE_URL: "postgresql://example.invalid/socal",
  REDIS_URL: "redis://localhost:6379/0",
  OPENSEARCH_NODE: "https://search.example.invalid",
  SESSION_SECRET: "admin-mfa-session-secret-with-more-than-32-bytes",
  OTP_SECRET: "admin-mfa-otp-secret-with-more-than-32-bytes",
  MFA_SECRET: "admin-mfa-master-secret-with-more-than-32-bytes",
  PASSWORD_PEPPER: "admin-password-pepper-with-more-than-32-bytes",
  CSRF_SECRET: "admin-mfa-csrf-secret-with-more-than-32-bytes",
});

const staffUserId = "10000000-0000-4000-8000-000000000071";
const originHeaders = { origin: environment.PUBLIC_ADMIN_URL };

function cookieFromSetCookie(value: string | string[] | undefined): string {
  const cookie = Array.isArray(value) ? value[0] : value;
  if (!cookie) throw new Error("Expected a session cookie");
  return cookie.split(";", 1)[0] ?? "";
}

describe("Admin MFA HTTP boundary", () => {
  let app: NestFastifyApplication;
  let server: FastifyInstance;
  let cookie: string;

  beforeAll(async () => {
    const authStore = new MemoryAuthSessionStore();
    authStore.registerSubject(
      buildActiveSubject({
        id: staffUserId,
        displayName: "Synthetic MFA Operator",
        preferredLocale: "en-US",
      }),
    );
    authStore.registerPlatformRole(staffUserId, "PLATFORM_ADMIN");
    app = await createApiApplication(environment, {
      logger: false,
      authSessionStore: authStore,
      mfaStore: new MemoryMfaStore(),
    });
    await app.init();
    server = app.getHttpAdapter().getInstance();
    await server.ready();
    const issued = await app.get(AuthSessionService).issueSession(staffUserId, {});
    cookie = `${environment.SESSION_COOKIE_NAME}=${issued.token}`;
  });

  afterAll(async () => {
    await app.close();
  });

  it("enrolls TOTP, returns recovery codes once, elevates a short Admin session, and rejects replay", async () => {
    const started = await server.inject({
      method: "POST",
      url: "/v1/admin/mfa/enrollment",
      headers: { cookie, ...originHeaders },
    });
    expect(started.statusCode).toBe(201);
    expect(started.headers["cache-control"]).toBe("no-store");
    const enrollment = started.json<AdminMfaEnrollmentResponse>().data;
    expect(enrollment.secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(enrollment.otpauthUri).toContain("otpauth://totp/");
    expect(enrollment.otpauthUri).not.toContain("Synthetic MFA Operator");
    const retried = await server.inject({
      method: "POST",
      url: "/v1/admin/mfa/enrollment",
      headers: { cookie, ...originHeaders },
    });
    expect(retried.statusCode).toBe(201);
    expect(retried.json<AdminMfaEnrollmentResponse>().data).toEqual(enrollment);

    const code = totpCode(decodeBase32(enrollment.secret), new Date());
    const activated = await server.inject({
      method: "POST",
      url: "/v1/admin/mfa/enrollment/verify",
      headers: { cookie, "content-type": "application/json", ...originHeaders },
      payload: { credentialId: enrollment.credentialId, code },
    });
    expect(activated.statusCode).toBe(200);
    const activation = activated.json<AdminMfaActivationResponse>().data;
    expect(activation.recoveryCodes).toHaveLength(10);
    expect(new Set(activation.recoveryCodes).size).toBe(10);
    expect(JSON.stringify(activation)).not.toContain(enrollment.secret);
    cookie = cookieFromSetCookie(activated.headers["set-cookie"]);

    const session = await server.inject({
      method: "GET",
      url: "/v1/admin/session",
      headers: { cookie },
    });
    const security = session.json<AdminSessionResponse>().data.security;
    expect(security).toMatchObject({
      mfaRequired: true,
      mfaEnrolled: true,
      authenticationStrength: "MFA",
      privilegedActionsAllowed: true,
      sensitiveActionsAllowed: true,
    });
    expect(security.mfaVerifiedAt).not.toBeNull();
    expect(security.stepUpExpiresAt).not.toBeNull();

    const replayedTotp = await server.inject({
      method: "POST",
      url: "/v1/admin/mfa/verify",
      headers: { cookie, "content-type": "application/json", ...originHeaders },
      payload: { code },
    });
    expect(replayedTotp.statusCode).toBe(400);

    const recoveryCode = activation.recoveryCodes[0] ?? "";
    const recovered = await server.inject({
      method: "POST",
      url: "/v1/admin/mfa/verify",
      headers: { cookie, "content-type": "application/json", ...originHeaders },
      payload: { code: recoveryCode },
    });
    expect(recovered.statusCode).toBe(200);
    expect(recovered.json<AdminMfaVerificationResponse>().data.recoveryCodeUsed).toBe(true);
    cookie = cookieFromSetCookie(recovered.headers["set-cookie"]);

    const replayedRecovery = await server.inject({
      method: "POST",
      url: "/v1/admin/mfa/verify",
      headers: { cookie, "content-type": "application/json", ...originHeaders },
      payload: { code: recoveryCode },
    });
    expect(replayedRecovery.statusCode).toBe(400);
  });

  it("rate-limits repeated invalid verification and requires same-origin cookie writes", async () => {
    const crossSite = await server.inject({
      method: "POST",
      url: "/v1/admin/mfa/verify",
      headers: { cookie, "content-type": "application/json", origin: "https://evil.invalid" },
      payload: { code: "000000" },
    });
    expect(crossSite.statusCode).toBe(403);

    const statuses: number[] = [];
    const remainingAttempts = environment.MFA_MAX_ATTEMPTS - 1;
    for (let attempt = 0; attempt < remainingAttempts; attempt += 1) {
      const response = await server.inject({
        method: "POST",
        url: "/v1/admin/mfa/verify",
        headers: { cookie, "content-type": "application/json", ...originHeaders },
        payload: { code: "000000" },
      });
      statuses.push(response.statusCode);
      if (attempt === remainingAttempts - 1) {
        expect(response.headers["retry-after"]).toBe(String(environment.MFA_LOCK_SECONDS));
      }
    }
    expect(statuses.slice(0, -1)).toEqual(Array.from({ length: remainingAttempts - 1 }, () => 400));
    expect(statuses.at(-1)).toBe(429);

    const locked = await server.inject({
      method: "POST",
      url: "/v1/admin/mfa/verify",
      headers: { cookie, "content-type": "application/json", ...originHeaders },
      payload: { code: "123456" },
    });
    expect(locked.statusCode).toBe(429);
  });
});
