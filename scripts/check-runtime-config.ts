import assert from "node:assert/strict";
import {
  parseApiEnvironment,
  parseWorkerEnvironment,
  redactSensitiveValue,
  RuntimeConfigError,
} from "../packages/config/src/index";

const apiInput = {
  NODE_ENV: "test",
  APP_ENV: "test",
  APP_NAME: "socal-api-test",
  LOG_LEVEL: "warn",
  PORT: "4000",
  PUBLIC_WEB_URL: "http://localhost:3000",
  PUBLIC_ADMIN_URL: "http://localhost:3001",
  DATABASE_URL: "postgresql://user:password@localhost:5432/socal_test",
  DATABASE_POOL_MAX: "10",
  REDIS_URL: "redis://localhost:6379/0",
  OPENSEARCH_NODE: "http://localhost:9200",
  SESSION_SECRET: "session-secret-value-that-is-long-enough",
  OTP_SECRET: "otp-secret-value-that-is-long-enough",
  MFA_SECRET: "mfa-secret-value-that-is-long-enough",
  PASSWORD_PEPPER: "password-pepper-value-that-is-long-enough",
  CSRF_SECRET: "csrf-secret-value-that-is-long-enough",
};

const apiEnvironment = parseApiEnvironment(apiInput);
assert.equal(apiEnvironment.PORT, 4000);
assert.equal(apiEnvironment.API_BODY_LIMIT_BYTES, 1_048_576);
assert.equal(apiEnvironment.SESSION_COOKIE_NAME, "socal_session");
assert.equal(apiEnvironment.SESSION_ABSOLUTE_TTL_SECONDS, 2_592_000);
assert.equal(apiEnvironment.SESSION_IDLE_TTL_SECONDS, 604_800);
assert.equal(apiEnvironment.SESSION_TOUCH_INTERVAL_SECONDS, 300);
assert.equal(apiEnvironment.OTP_TTL_SECONDS, 600);
assert.equal(apiEnvironment.OTP_MAX_ATTEMPTS, 5);
assert.equal(apiEnvironment.MFA_ENROLLMENT_TTL_SECONDS, 600);
assert.equal(apiEnvironment.MFA_MAX_ATTEMPTS, 5);
assert.equal(apiEnvironment.MFA_LOCK_SECONDS, 300);
assert.equal(apiEnvironment.ADMIN_SESSION_ABSOLUTE_TTL_SECONDS, 28_800);
assert.equal(apiEnvironment.ADMIN_SESSION_IDLE_TTL_SECONDS, 1_800);
assert.equal(apiEnvironment.ADMIN_STEP_UP_TTL_SECONDS, 600);
assert.equal(apiEnvironment.FEATURE_PAYMENTS, false);
assert.equal(apiEnvironment.SESSION_SECRET.reveal(), apiInput.SESSION_SECRET);
assert.equal(apiEnvironment.OTP_SECRET.reveal(), apiInput.OTP_SECRET);
assert.equal(apiEnvironment.MFA_SECRET.reveal(), apiInput.MFA_SECRET);
assert.equal(apiEnvironment.PASSWORD_PEPPER.reveal(), apiInput.PASSWORD_PEPPER);
assert.equal(JSON.stringify(apiEnvironment).includes(apiInput.SESSION_SECRET), false);
assert.equal(JSON.stringify(apiEnvironment).includes(apiInput.OTP_SECRET), false);
assert.equal(JSON.stringify(apiEnvironment).includes(apiInput.MFA_SECRET), false);
assert.equal(JSON.stringify(apiEnvironment).includes(apiInput.PASSWORD_PEPPER), false);

const workerEnvironment = parseWorkerEnvironment({
  NODE_ENV: "test",
  APP_ENV: "test",
  DATABASE_URL: "postgresql://user:password@localhost:5432/socal_test",
  REDIS_URL: "redis://localhost:6379/0",
  WORKER_CONCURRENCY: "7",
});
assert.equal(workerEnvironment.WORKER_CONCURRENCY, 7);
assert.equal(workerEnvironment.OUTBOX_BATCH_SIZE, 25);
assert.equal(workerEnvironment.OUTBOX_MAX_ATTEMPTS, 10);

let missingConfigurationError: RuntimeConfigError | undefined;
try {
  parseApiEnvironment({ NODE_ENV: "test", APP_ENV: "test" });
} catch (error: unknown) {
  assert.ok(error instanceof RuntimeConfigError);
  missingConfigurationError = error;
}
assert.ok(missingConfigurationError);
assert.match(missingConfigurationError.message, /DATABASE_URL/);
assert.equal(missingConfigurationError.message.includes(apiInput.SESSION_SECRET), false);

const redacted = redactSensitiveValue("root", {
  authorization: "Bearer private-token",
  nested: { password: "private-password", safe: "visible" },
});
assert.deepEqual(redacted, {
  authorization: "[REDACTED]",
  nested: { password: "[REDACTED]", safe: "visible" },
});

console.log("Runtime configuration checks passed: validation, fail-fast, and redaction.");
