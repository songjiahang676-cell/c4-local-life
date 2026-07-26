import { describe, expect, it } from "vitest";
import { parseApiEnvironment, redactSensitiveValue, RuntimeConfigError, SecretValue } from "../src";

const validApiEnvironment = {
  PUBLIC_WEB_URL: "http://localhost:3000",
  PUBLIC_ADMIN_URL: "http://localhost:3001",
  DATABASE_URL: "postgresql://example.invalid/socal",
  REDIS_URL: "redis://localhost:6379/0",
  OPENSEARCH_NODE: "http://localhost:9200",
  SESSION_SECRET: "test-session-secret-with-more-than-32-bytes",
  CSRF_SECRET: "test-csrf-secret-with-more-than-32-bytes",
};

describe("runtime configuration", () => {
  it("applies safe defaults and wraps secrets", () => {
    const environment = parseApiEnvironment(validApiEnvironment);

    expect(environment.PORT).toBe(4000);
    expect(environment.API_BODY_LIMIT_BYTES).toBe(1_048_576);
    expect(environment.SESSION_COOKIE_NAME).toBe("socal_session");
    expect(environment.SESSION_SECRET).toBeInstanceOf(SecretValue);
    expect(JSON.stringify(environment.SESSION_SECRET)).toBe('"[REDACTED]"');
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
});
