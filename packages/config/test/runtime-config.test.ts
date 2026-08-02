import { describe, expect, it } from "vitest";
import {
  parseApiEnvironment,
  parseWorkerEnvironment,
  redactSensitiveValue,
  RuntimeConfigError,
  SecretValue,
} from "../src";

const validApiEnvironment = {
  PUBLIC_WEB_URL: "http://localhost:3000",
  PUBLIC_ADMIN_URL: "http://localhost:3001",
  DATABASE_URL: "postgresql://example.invalid/socal",
  REDIS_URL: "redis://localhost:6379/0",
  OPENSEARCH_NODE: "http://localhost:9200",
  SESSION_SECRET: "test-session-secret-with-more-than-32-bytes",
  OTP_SECRET: "test-otp-secret-with-more-than-32-bytes",
  MFA_SECRET: "test-mfa-secret-with-more-than-32-bytes",
  PASSWORD_PEPPER: "test-password-pepper-with-more-than-32-bytes",
  CSRF_SECRET: "test-csrf-secret-with-more-than-32-bytes",
};

describe("runtime configuration", () => {
  it("applies safe defaults and wraps secrets", () => {
    const environment = parseApiEnvironment(validApiEnvironment);

    expect(environment.PORT).toBe(4000);
    expect(environment.API_BODY_LIMIT_BYTES).toBe(1_048_576);
    expect(environment.SESSION_COOKIE_NAME).toBe("socal_session");
    expect(environment.SESSION_ABSOLUTE_TTL_SECONDS).toBe(2_592_000);
    expect(environment.SESSION_IDLE_TTL_SECONDS).toBe(604_800);
    expect(environment.SESSION_TOUCH_INTERVAL_SECONDS).toBe(300);
    expect(environment.SESSION_SECRET).toBeInstanceOf(SecretValue);
    expect(environment.OTP_SECRET).toBeInstanceOf(SecretValue);
    expect(environment.MFA_SECRET).toBeInstanceOf(SecretValue);
    expect(environment.PASSWORD_PEPPER).toBeInstanceOf(SecretValue);
    expect(environment.OTP_TTL_SECONDS).toBe(600);
    expect(environment.OTP_MAX_ATTEMPTS).toBe(5);
    expect(environment.MFA_ENROLLMENT_TTL_SECONDS).toBe(600);
    expect(environment.MFA_MAX_ATTEMPTS).toBe(5);
    expect(environment.MFA_LOCK_SECONDS).toBe(300);
    expect(environment.ADMIN_SESSION_ABSOLUTE_TTL_SECONDS).toBe(28_800);
    expect(environment.ADMIN_SESSION_IDLE_TTL_SECONDS).toBe(1_800);
    expect(environment.ADMIN_STEP_UP_TTL_SECONDS).toBe(600);
    expect(environment.ORGANIZATION_INVITATION_TTL_SECONDS).toBe(259_200);
    expect(environment.S3_QUARANTINE_BUCKET).toBe("socal-media-quarantine-local");
    expect(environment.MEDIA_UPLOAD_URL_TTL_SECONDS).toBe(300);
    expect(environment.MEDIA_UPLOAD_MAX_ACTIVE).toBe(20);
    expect(environment.MEDIA_UPLOAD_DAILY_BYTES).toBe(209_715_200);
    expect(environment.OPENSEARCH_INDEX_PREFIX).toBe("socal_local");
    expect(environment.SEARCH_QUERY_TIMEOUT_MS).toBe(1_500);
    expect(environment.SEARCH_PIT_KEEP_ALIVE_SECONDS).toBe(120);
    expect(JSON.stringify(environment.SESSION_SECRET)).toBe('"[REDACTED]"');
    expect(JSON.stringify(environment.OTP_SECRET)).toBe('"[REDACTED]"');
    expect(JSON.stringify(environment.MFA_SECRET)).toBe('"[REDACTED]"');
    expect(JSON.stringify(environment.PASSWORD_PEPPER)).toBe('"[REDACTED]"');
  });

  it("fails fast without exposing a supplied value", () => {
    expect(() =>
      parseApiEnvironment({ ...validApiEnvironment, SESSION_SECRET: "do-not-log-this" }),
    ).toThrow(RuntimeConfigError);

    expect(
      redactSensitiveValue("payload", {
        authorization: "Bearer private",
        nested: { password: "private" },
      }),
    ).toEqual({
      authorization: "[REDACTED]",
      nested: { password: "[REDACTED]" },
    });
  });

  it("rejects session lifetimes that weaken absolute or idle expiry", () => {
    expect(() =>
      parseApiEnvironment({
        ...validApiEnvironment,
        SESSION_ABSOLUTE_TTL_SECONDS: "600",
        SESSION_IDLE_TTL_SECONDS: "601",
      }),
    ).toThrow(RuntimeConfigError);
    expect(() =>
      parseApiEnvironment({
        ...validApiEnvironment,
        SESSION_IDLE_TTL_SECONDS: "300",
        SESSION_TOUCH_INTERVAL_SECONDS: "300",
      }),
    ).toThrow(RuntimeConfigError);
  });

  it("requires a domain-separated OTP secret", () => {
    expect(() =>
      parseApiEnvironment({
        ...validApiEnvironment,
        OTP_SECRET: validApiEnvironment.SESSION_SECRET,
      }),
    ).toThrow(RuntimeConfigError);
  });

  it("requires a domain-separated MFA secret and safe Admin lifetimes", () => {
    expect(() =>
      parseApiEnvironment({
        ...validApiEnvironment,
        MFA_SECRET: validApiEnvironment.SESSION_SECRET,
      }),
    ).toThrow(RuntimeConfigError);
    expect(() =>
      parseApiEnvironment({
        ...validApiEnvironment,
        ADMIN_SESSION_ABSOLUTE_TTL_SECONDS: "1800",
        ADMIN_SESSION_IDLE_TTL_SECONDS: "1801",
      }),
    ).toThrow(RuntimeConfigError);
    expect(() =>
      parseApiEnvironment({
        ...validApiEnvironment,
        ADMIN_SESSION_ABSOLUTE_TTL_SECONDS: "600",
        ADMIN_STEP_UP_TTL_SECONDS: "601",
      }),
    ).toThrow(RuntimeConfigError);
  });

  it("requires a domain-separated password pepper and a bounded recovery cooldown", () => {
    expect(() =>
      parseApiEnvironment({
        ...validApiEnvironment,
        PASSWORD_PEPPER: validApiEnvironment.MFA_SECRET,
      }),
    ).toThrow(RuntimeConfigError);
    expect(() =>
      parseApiEnvironment({
        ...validApiEnvironment,
        PASSWORD_RECOVERY_TTL_SECONDS: "300",
        PASSWORD_RECOVERY_COOLDOWN_SECONDS: "300",
      }),
    ).toThrow(RuntimeConfigError);
  });

  it("requires object-storage static credentials as a pair", () => {
    expect(() =>
      parseApiEnvironment({
        ...validApiEnvironment,
        S3_ACCESS_KEY: "local-access-key",
      }),
    ).toThrow(RuntimeConfigError);
    expect(() =>
      parseApiEnvironment({
        ...validApiEnvironment,
        OPENSEARCH_USERNAME: "search-user",
      }),
    ).toThrow(RuntimeConfigError);
    expect(() =>
      parseApiEnvironment({
        ...validApiEnvironment,
        OPENSEARCH_INDEX_PREFIX: "Invalid-Prefix",
      }),
    ).toThrow(RuntimeConfigError);
    expect(() =>
      parseApiEnvironment({
        ...validApiEnvironment,
        SEARCH_QUERY_TIMEOUT_MS: "5001",
      }),
    ).toThrow(RuntimeConfigError);
    expect(() =>
      parseApiEnvironment({
        ...validApiEnvironment,
        SEARCH_PIT_KEEP_ALIVE_SECONDS: "301",
      }),
    ).toThrow(RuntimeConfigError);
  });

  it("validates bounded outbox worker controls and retry ordering", () => {
    const environment = parseWorkerEnvironment({
      DATABASE_URL: "postgresql://example.invalid/socal",
      REDIS_URL: "redis://localhost:6379/0",
      OPENSEARCH_NODE: "http://localhost:9200",
    });
    expect(environment.OUTBOX_QUEUE_NAME).toBe("platform-events");
    expect(environment.OUTBOX_BATCH_SIZE).toBe(25);
    expect(environment.OUTBOX_LEASE_SECONDS).toBe(60);
    expect(environment.OUTBOX_MAX_ATTEMPTS).toBe(10);
    expect(environment.OUTBOX_MAX_PAYLOAD_BYTES).toBe(131_072);
    expect(environment.S3_QUARANTINE_BUCKET).toBe("socal-media-quarantine-local");
    expect(environment.S3_MEDIA_BUCKET).toBe("socal-media-processed-local");
    expect(environment.CLAMAV_HOST).toBe("clamav");
    expect(environment.CLAMAV_PORT).toBe(3310);
    expect(environment.MEDIA_PROCESS_MAX_BYTES).toBe(20_971_520);
    expect(environment.MEDIA_IMAGE_MAX_PIXELS).toBe(40_000_000);
    expect(environment.OPENSEARCH_INDEX_PREFIX).toBe("socal_local");
    expect(environment.SEARCH_RECONCILIATION_BATCH_SIZE).toBe(100);
    expect(environment.SEARCH_RECONCILIATION_INTERVAL_MS).toBe(300_000);
    expect(environment.SEARCH_REBUILD_BATCH_SIZE).toBe(250);
    expect(environment.SEARCH_REBUILD_POLL_INTERVAL_MS).toBe(5_000);
    expect(environment.SEARCH_REBUILD_LEASE_SECONDS).toBe(300);

    expect(() =>
      parseWorkerEnvironment({
        DATABASE_URL: "postgresql://example.invalid/socal",
        REDIS_URL: "redis://localhost:6379/0",
        OPENSEARCH_NODE: "http://localhost:9200",
        OUTBOX_RETRY_BASE_SECONDS: "60",
        OUTBOX_RETRY_MAX_SECONDS: "30",
      }),
    ).toThrow(RuntimeConfigError);
    expect(() =>
      parseWorkerEnvironment({
        DATABASE_URL: "postgresql://example.invalid/socal",
        REDIS_URL: "redis://localhost:6379/0",
        OPENSEARCH_NODE: "http://localhost:9200",
        S3_ACCESS_KEY: "local-access-key",
      }),
    ).toThrow(RuntimeConfigError);
    expect(() =>
      parseWorkerEnvironment({
        DATABASE_URL: "postgresql://example.invalid/socal",
        REDIS_URL: "redis://localhost:6379/0",
        OPENSEARCH_NODE: "http://localhost:9200",
        OPENSEARCH_PASSWORD: "search-password",
      }),
    ).toThrow(RuntimeConfigError);
  });
});
