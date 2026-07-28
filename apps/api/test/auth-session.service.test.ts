import { parseApiEnvironment } from "@socal/config";
import { describe, expect, it } from "vitest";
import {
  AuthSessionService,
  hashSessionToken,
  SessionSubjectUnavailableError,
} from "../src/modules/auth/auth-session.service";
import {
  readSessionCookie,
  serializeClearedSessionCookie,
} from "../src/modules/auth/session-cookie";
import { buildActiveSubject, MemoryAuthSessionStore } from "./support/memory-auth-session.store";

const environment = parseApiEnvironment({
  PUBLIC_WEB_URL: "https://web.example.invalid",
  PUBLIC_ADMIN_URL: "https://admin.example.invalid",
  DATABASE_URL: "postgresql://example.invalid/socal",
  REDIS_URL: "redis://localhost:6379/0",
  OPENSEARCH_NODE: "https://search.example.invalid",
  SESSION_SECRET: "test-session-secret-with-more-than-32-bytes",
  OTP_SECRET: "test-otp-secret-with-more-than-32-bytes",
  MFA_SECRET: "test-mfa-secret-with-more-than-32-bytes",
  SESSION_ABSOLUTE_TTL_SECONDS: "1200",
  SESSION_IDLE_TTL_SECONDS: "600",
  SESSION_TOUCH_INTERVAL_SECONDS: "60",
  CSRF_SECRET: "test-csrf-secret-with-more-than-32-bytes",
});

function createService(): {
  store: MemoryAuthSessionStore;
  subject: ReturnType<typeof buildActiveSubject>;
  service: AuthSessionService;
} {
  const store = new MemoryAuthSessionStore();
  const subject = buildActiveSubject();
  store.registerSubject(subject);
  return { store, subject, service: new AuthSessionService(environment, store) };
}

describe("AuthSessionService", () => {
  it("persists only domain-separated hashes and emits a hardened host-only cookie", async () => {
    const { service, store, subject } = createService();
    const now = new Date("2026-07-25T12:00:00.000Z");
    const issued = await service.issueSession(
      subject.id,
      { userAgent: "Browser\u0000Agent", ipAddress: "203.0.113.42" },
      now,
    );
    const persisted = store.createInputs[0];

    expect(persisted?.tokenHash).toBe(
      hashSessionToken(issued.token, environment.SESSION_SECRET.reveal()),
    );
    expect(persisted?.tokenHash).not.toContain(issued.token);
    expect(persisted?.ipHash).not.toBe("203.0.113.42");
    expect(persisted?.userAgent).toBe("Browser Agent");
    expect(issued.cookie).toContain("HttpOnly");
    expect(issued.cookie).toContain("Secure");
    expect(issued.cookie).toContain("SameSite=Lax");
    expect(issued.cookie).toContain("Path=/v1");
    expect(issued.cookie).not.toContain("Domain=");
    expect(issued.response.expiresAt).toBe("2026-07-25T12:10:00.000Z");
  });

  it("rotates atomically so the old bearer token stops resolving", async () => {
    const { service, subject } = createService();
    const issued = await service.issueSession(subject.id, {}, new Date("2026-07-25T12:00:00.000Z"));
    const rotated = await service.rotateSession(
      issued.token,
      {},
      new Date("2026-07-25T12:01:00.000Z"),
    );

    expect(rotated?.token).not.toBe(issued.token);
    expect(
      await service.resolveToken(issued.token, new Date("2026-07-25T12:01:01.000Z")),
    ).toBeNull();
    expect(
      await service.resolveToken(rotated?.token ?? "", new Date("2026-07-25T12:01:01.000Z")),
    ).toMatchObject({ response: { user: { id: subject.id } } });
  });

  it("elevates into a short MFA-bound session and expires recent-auth independently", async () => {
    const { service, store, subject } = createService();
    store.registerPlatformRole(subject.id, "SUPPORT");
    const issued = await service.issueSession(subject.id, {}, new Date("2026-07-25T12:00:00.000Z"));
    const elevated = await service.elevateWithMfa(
      issued.token,
      {},
      new Date("2026-07-25T12:01:00.000Z"),
    );

    expect(elevated?.response.permissions).toContain("admin:console:privileged");
    expect(
      await service.resolveToken(elevated?.token ?? "", new Date("2026-07-25T12:01:01.000Z")),
    ).toMatchObject({
      authentication: {
        strength: "MFA",
        mfaVerifiedAt: "2026-07-25T12:01:00.000Z",
        recentMfa: true,
      },
    });
    expect(
      await service.resolveToken(elevated?.token ?? "", new Date("2026-07-25T12:12:00.000Z")),
    ).toMatchObject({
      authentication: { strength: "MFA", recentMfa: false },
    });
    expect(
      await service.resolveToken(issued.token, new Date("2026-07-25T12:01:01.000Z")),
    ).toBeNull();
  });

  it("enforces idle expiry, bounds refresh by absolute expiry, and rejects malformed tokens early", async () => {
    const { service, store, subject } = createService();
    const issued = await service.issueSession(subject.id, {}, new Date("2026-07-25T12:00:00.000Z"));
    const refreshed = await service.resolveToken(
      issued.token,
      new Date("2026-07-25T12:09:30.000Z"),
    );

    expect(refreshed?.response.expiresAt).toBe("2026-07-25T12:19:30.000Z");
    expect(
      await service.resolveToken(issued.token, new Date("2026-07-25T12:20:01.000Z")),
    ).toBeNull();
    const lookupsBeforeMalformed = store.lookupHashes.length;
    expect(await service.resolveToken("not-a-session-token")).toBeNull();
    expect(store.lookupHashes).toHaveLength(lookupsBeforeMalformed);
  });

  it("fails closed when a user has no usable profile-backed subject", async () => {
    const store = new MemoryAuthSessionStore();
    const service = new AuthSessionService(environment, store);

    await expect(service.issueSession(crypto.randomUUID(), {})).rejects.toBeInstanceOf(
      SessionSubjectUnavailableError,
    );
  });

  it("does not advertise content-mutation capabilities to a limited account", async () => {
    const store = new MemoryAuthSessionStore();
    const subject = buildActiveSubject({ status: "LIMITED" });
    store.registerSubject(subject);
    const service = new AuthSessionService(environment, store);

    const issued = await service.issueSession(subject.id, {});

    expect(issued.response.permissions).toContain("account:profile:read");
    expect(issued.response.permissions).not.toContain("listing:draft:create");
    expect(issued.response.permissions).not.toContain("organization:create");
  });

  it("rejects duplicate cookies and clears with the same security attributes", () => {
    const token = "a".repeat(43);
    expect(readSessionCookie(`socal_session=${token}`, "socal_session")).toBe(token);
    expect(
      readSessionCookie(`socal_session=${token}; socal_session=${"b".repeat(43)}`, "socal_session"),
    ).toBeNull();
    expect(serializeClearedSessionCookie("socal_session")).toBe(
      "socal_session=; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/v1; HttpOnly; Secure; SameSite=Lax",
    );
  });
});
