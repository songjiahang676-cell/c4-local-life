import { createHmac } from "node:crypto";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { parseApiEnvironment } from "@socal/config";
import type { OtpAcceptedResponse, ProblemDetails, SessionResponse } from "@socal/contracts";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApiApplication } from "../src/create-api-application";
import { buildActiveSubject, MemoryAuthSessionStore } from "./support/memory-auth-session.store";
import {
  CapturingOtpDeliveryGateway,
  MemoryOtpChallengeStore,
} from "./support/memory-otp-challenge.store";

const userId = "30000000-0000-4000-8000-000000000001";
const deviceId = "synthetic-device-0001";
const environment = parseApiEnvironment({
  NODE_ENV: "test",
  APP_ENV: "test",
  PUBLIC_WEB_URL: "https://web.example.invalid",
  PUBLIC_ADMIN_URL: "https://admin.example.invalid",
  DATABASE_URL: "postgresql://example.invalid/socal",
  REDIS_URL: "redis://localhost:6379/0",
  OPENSEARCH_NODE: "https://search.example.invalid",
  SESSION_SECRET: "otp-http-session-secret-with-more-than-32-bytes",
  OTP_SECRET: "otp-http-dedicated-secret-with-more-than-32-bytes",
  MFA_SECRET: "otp-http-mfa-secret-with-more-than-32-bytes",
  PASSWORD_PEPPER: "otp-http-password-pepper-with-more-than-32-bytes",
  OTP_DESTINATION_LIMIT: "3",
  OTP_IP_LIMIT: "100",
  OTP_DEVICE_LIMIT: "100",
  CSRF_SECRET: "otp-http-csrf-secret-with-more-than-32-bytes",
});

describe("OTP HTTP boundary", () => {
  let app: NestFastifyApplication;
  let server: FastifyInstance;
  let sessions: MemoryAuthSessionStore;
  let challenges: MemoryOtpChallengeStore;
  let delivery: CapturingOtpDeliveryGateway;

  beforeAll(async () => {
    sessions = new MemoryAuthSessionStore();
    challenges = new MemoryOtpChallengeStore();
    delivery = new CapturingOtpDeliveryGateway();
    app = await createApiApplication(environment, {
      logger: false,
      authSessionStore: sessions,
      otpChallengeStore: challenges,
      otpDeliveryGateway: delivery,
    });
    await app.init();
    server = app.getHttpAdapter().getInstance();
    await server.ready();
  });

  beforeEach(() => {
    sessions.registerSubject(
      buildActiveSubject({
        id: userId,
        displayName: "Synthetic OTP User",
      }),
    );
  });

  afterAll(async () => {
    await app.close();
  });

  async function requestChallenge(
    destination = "Member@Example.Invalid",
    currentDeviceId = deviceId,
  ): Promise<{ response: Awaited<ReturnType<FastifyInstance["inject"]>>; deliveryIndex: number }> {
    const deliveryIndex = delivery.messages.length;
    const response = await server.inject({
      method: "POST",
      url: "/v1/auth/otp/request",
      headers: { "x-device-id": currentDeviceId },
      payload: {
        channel: "EMAIL",
        destination,
        purpose: "SIGN_IN",
        locale: "en-US",
      },
    });
    return { response, deliveryIndex };
  }

  it("accepts without exposing the code and establishes a hardened session once", async () => {
    const { response, deliveryIndex } = await requestChallenge();
    const accepted = response.json<OtpAcceptedResponse>();
    const message = delivery.messages[deliveryIndex];

    expect(response.statusCode).toBe(202);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(accepted).toMatchObject({
      accepted: true,
      challengeId: message?.challengeId,
    });
    expect(message?.destination).toBe("member@example.invalid");
    expect(message?.code).toMatch(/^\d{6}$/);
    expect(response.body).not.toContain(message?.code ?? "unreachable");
    expect(challenges.createInputs.at(-1)?.codeHash).not.toContain(message?.code ?? "");
    expect(challenges.createInputs.at(-1)?.destinationHash).not.toContain("member");

    const verified = await server.inject({
      method: "POST",
      url: "/v1/auth/otp/verify",
      headers: { "x-device-id": deviceId },
      payload: { challengeId: accepted.challengeId, code: message?.code },
    });
    const replay = await server.inject({
      method: "POST",
      url: "/v1/auth/otp/verify",
      headers: { "x-device-id": deviceId },
      payload: { challengeId: accepted.challengeId, code: message?.code },
    });

    expect(verified.statusCode).toBe(200);
    expect(verified.headers["set-cookie"]).toContain("HttpOnly");
    expect(verified.headers["set-cookie"]).toContain("Secure");
    expect(verified.headers["set-cookie"]).toContain("SameSite=Lax");
    expect(verified.json<SessionResponse>().data.user.id).toBe(userId);
    expect(replay.statusCode).toBe(400);
    expect(replay.json<ProblemDetails>().detail).toBe("The challenge is invalid or expired");
  });

  it("uses one generic response for wrong, unknown, expired, and cross-device challenges", async () => {
    const { response, deliveryIndex } = await requestChallenge("generic@example.invalid");
    const accepted = response.json<OtpAcceptedResponse>();
    const code = delivery.messages[deliveryIndex]?.code ?? "000000";
    const cases = await Promise.all([
      server.inject({
        method: "POST",
        url: "/v1/auth/otp/verify",
        headers: { "x-device-id": deviceId },
        payload: { challengeId: accepted.challengeId, code: "999999" },
      }),
      server.inject({
        method: "POST",
        url: "/v1/auth/otp/verify",
        headers: { "x-device-id": deviceId },
        payload: { challengeId: "40000000-0000-4000-8000-000000000001", code },
      }),
      server.inject({
        method: "POST",
        url: "/v1/auth/otp/verify",
        headers: { "x-device-id": "different-device-001" },
        payload: { challengeId: accepted.challengeId, code },
      }),
    ]);

    for (const responseCase of cases) {
      expect(responseCase.statusCode).toBe(400);
      expect(responseCase.json<ProblemDetails>()).toMatchObject({
        title: "Bad Request",
        detail: "The challenge is invalid or expired",
      });
    }
  });

  it("validates contact formats and requires an opaque device identifier", async () => {
    const [email, phone, missingDevice] = await Promise.all([
      server.inject({
        method: "POST",
        url: "/v1/auth/otp/request",
        headers: { "x-device-id": deviceId },
        payload: { channel: "EMAIL", destination: "not-email", purpose: "SIGN_IN" },
      }),
      server.inject({
        method: "POST",
        url: "/v1/auth/otp/request",
        headers: { "x-device-id": deviceId },
        payload: { channel: "SMS", destination: "555-1234", purpose: "SIGN_IN" },
      }),
      server.inject({
        method: "POST",
        url: "/v1/auth/otp/request",
        payload: {
          channel: "EMAIL",
          destination: "member@example.invalid",
          purpose: "SIGN_IN",
        },
      }),
    ]);

    expect(email.statusCode).toBe(400);
    expect(phone.statusCode).toBe(400);
    expect(missingDevice.statusCode).toBe(400);
  });

  it("accepts a normalized E.164 SMS destination through the same provider port", async () => {
    const deliveryIndex = delivery.messages.length;
    const response = await server.inject({
      method: "POST",
      url: "/v1/auth/otp/request",
      headers: { "x-device-id": "synthetic-sms-device-01" },
      payload: {
        channel: "SMS",
        destination: "+19495550123",
        purpose: "SIGN_IN",
        locale: "zh-Hans",
      },
    });

    expect(response.statusCode).toBe(202);
    expect(delivery.messages[deliveryIndex]).toMatchObject({
      channel: "SMS",
      destination: "+19495550123",
      locale: "zh-Hans",
    });
  });

  it("enforces the destination request limit without returning a code or account state", async () => {
    const destination = "limited@example.invalid";
    const responses = [];
    for (let attempt = 0; attempt < 4; attempt += 1) {
      responses.push(
        (await requestChallenge(destination, `rate-device-${attempt.toString().padStart(4, "0")}`))
          .response,
      );
    }
    const limited = responses.at(-1);

    expect(responses.slice(0, 3).every((response) => response.statusCode === 202)).toBe(true);
    expect(limited?.statusCode).toBe(429);
    expect(limited?.headers["retry-after"]).toBeDefined();
    expect(limited?.body).not.toMatch(/\b\d{6}\b/);
  });

  it("returns 401 for contact-verification purposes without an active session", async () => {
    const response = await server.inject({
      method: "POST",
      url: "/v1/auth/otp/request",
      headers: { "x-device-id": deviceId },
      payload: {
        channel: "EMAIL",
        destination: "new-contact@example.invalid",
        purpose: "VERIFY_CONTACT",
      },
    });

    expect(response.statusCode).toBe(401);
  });

  it("allows the device header in credentialed browser preflight", async () => {
    const response = await server.inject({
      method: "OPTIONS",
      url: "/v1/auth/otp/request",
      headers: {
        origin: environment.PUBLIC_WEB_URL,
        "access-control-request-method": "POST",
        "access-control-request-headers": "content-type,x-device-id",
      },
    });

    expect(response.statusCode).toBe(204);
    expect(response.headers["access-control-allow-origin"]).toBe(environment.PUBLIC_WEB_URL);
    expect(response.headers["access-control-allow-headers"]).toContain("x-device-id");
  });

  it("ignores a spoofed forwarded IP from an untrusted direct peer", async () => {
    const remoteAddress = "203.0.113.20";
    const response = await server.inject({
      method: "POST",
      url: "/v1/auth/otp/request",
      remoteAddress,
      headers: {
        "x-device-id": "untrusted-proxy-device-01",
        "x-forwarded-for": "198.51.100.99",
      },
      payload: {
        channel: "EMAIL",
        destination: "proxy-check@example.invalid",
        purpose: "SIGN_IN",
      },
    });
    const expectedHash = createHmac("sha256", environment.OTP_SECRET.reveal())
      .update("socal-otp-ip-v1", "utf8")
      .update("\0", "utf8")
      .update(remoteAddress, "utf8")
      .digest("hex");

    expect(response.statusCode).toBe(202);
    expect(challenges.createInputs.at(-1)?.ipHash).toBe(expectedHash);
  });
});
