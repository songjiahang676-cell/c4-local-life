import { z, type ZodType } from "zod";

type EnvironmentInput = Record<string, string | undefined>;

const logLevelSchema = z.enum(["trace", "debug", "info", "warn", "error", "fatal"]).default("info");

const applicationEnvironmentSchema = z
  .enum(["local", "test", "preview", "dev", "staging", "production"])
  .default("local");

const nodeEnvironmentSchema = z.enum(["development", "test", "production"]).default("development");

const positiveInteger = (defaultValue: number, maximum: number) =>
  z.preprocess(
    (value) => (value === undefined || value === "" ? defaultValue : value),
    z.coerce.number().int().positive().max(maximum),
  );

const booleanValue = (defaultValue: boolean) =>
  z.preprocess((value) => {
    if (value === undefined || value === "") return defaultValue;
    if (typeof value === "boolean") return value;
    if (value === "true") return true;
    if (value === "false") return false;
    return value;
  }, z.boolean());

const secretSchema = (minimumLength = 1) =>
  z
    .string()
    .min(minimumLength)
    .transform((value) => new SecretValue(value));

const optionalSecretSchema = () =>
  z.preprocess((value) => (value === "" ? undefined : value), secretSchema().optional());

const optionalStringSchema = () =>
  z.preprocess((value) => (value === "" ? undefined : value), z.string().min(1).optional());

const commonServerSchema = z.object({
  NODE_ENV: nodeEnvironmentSchema,
  APP_ENV: applicationEnvironmentSchema,
  APP_NAME: z.string().min(1).default("socal-life-platform"),
  LOG_LEVEL: logLevelSchema,
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().optional().or(z.literal("")),
  OTEL_SERVICE_NAME: z.string().max(100).default(""),
  OTEL_SERVICE_VERSION: z.string().max(50).default("0.1.0"),
});

const apiEnvironmentSchema = commonServerSchema
  .extend({
    PORT: positiveInteger(4000, 65_535),
    API_BODY_LIMIT_BYTES: positiveInteger(1_048_576, 10_485_760),
    PUBLIC_WEB_URL: z.string().url(),
    PUBLIC_ADMIN_URL: z.string().url(),
    DATABASE_URL: z.string().url(),
    DATABASE_POOL_MAX: positiveInteger(20, 200),
    REDIS_URL: z.string().url(),
    OPENSEARCH_NODE: z.string().url(),
    OPENSEARCH_USERNAME: z.string().optional().default(""),
    OPENSEARCH_PASSWORD: optionalSecretSchema(),
    S3_ENDPOINT: z.string().url().optional().or(z.literal("")).default(""),
    S3_REGION: z.string().min(1).max(64).default("us-west-2"),
    S3_QUARANTINE_BUCKET: z
      .string()
      .regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/)
      .default("socal-media-quarantine-local"),
    S3_ACCESS_KEY: optionalStringSchema(),
    S3_SECRET_KEY: optionalSecretSchema(),
    S3_FORCE_PATH_STYLE: booleanValue(false),
    MEDIA_UPLOAD_URL_TTL_SECONDS: positiveInteger(300, 900),
    MEDIA_UPLOAD_MAX_ACTIVE: positiveInteger(20, 100),
    MEDIA_UPLOAD_DAILY_BYTES: positiveInteger(209_715_200, 10_737_418_240),
    SESSION_SECRET: secretSchema(32),
    SESSION_COOKIE_NAME: z
      .string()
      .regex(/^[A-Za-z0-9_-]+$/)
      .default("socal_session"),
    SESSION_ABSOLUTE_TTL_SECONDS: positiveInteger(2_592_000, 31_536_000),
    SESSION_IDLE_TTL_SECONDS: positiveInteger(604_800, 2_592_000),
    SESSION_TOUCH_INTERVAL_SECONDS: positiveInteger(300, 86_400),
    CSRF_SECRET: secretSchema(32),
    OTP_SECRET: secretSchema(32),
    OTP_TTL_SECONDS: positiveInteger(600, 1_800),
    OTP_MAX_ATTEMPTS: positiveInteger(5, 20),
    OTP_DESTINATION_LIMIT: positiveInteger(3, 100),
    OTP_DESTINATION_WINDOW_SECONDS: positiveInteger(900, 86_400),
    OTP_IP_LIMIT: positiveInteger(20, 1_000),
    OTP_IP_WINDOW_SECONDS: positiveInteger(3_600, 86_400),
    OTP_DEVICE_LIMIT: positiveInteger(10, 500),
    OTP_DEVICE_WINDOW_SECONDS: positiveInteger(3_600, 86_400),
    MFA_SECRET: secretSchema(32),
    MFA_ENROLLMENT_TTL_SECONDS: positiveInteger(600, 1_800),
    MFA_MAX_ATTEMPTS: positiveInteger(5, 20),
    MFA_LOCK_SECONDS: positiveInteger(300, 3_600),
    ADMIN_SESSION_ABSOLUTE_TTL_SECONDS: positiveInteger(28_800, 86_400),
    ADMIN_SESSION_IDLE_TTL_SECONDS: positiveInteger(1_800, 14_400),
    ADMIN_STEP_UP_TTL_SECONDS: positiveInteger(600, 3_600),
    PASSWORD_PEPPER: secretSchema(32),
    PASSWORD_LOGIN_MAX_FAILURES: positiveInteger(5, 20),
    PASSWORD_LOGIN_LOCK_SECONDS: positiveInteger(300, 3_600),
    PASSWORD_LOGIN_IDENTIFIER_LIMIT: positiveInteger(10, 100),
    PASSWORD_LOGIN_IDENTIFIER_WINDOW_SECONDS: positiveInteger(900, 86_400),
    PASSWORD_LOGIN_IP_LIMIT: positiveInteger(50, 1_000),
    PASSWORD_LOGIN_IP_WINDOW_SECONDS: positiveInteger(3_600, 86_400),
    PASSWORD_LOGIN_DEVICE_LIMIT: positiveInteger(30, 500),
    PASSWORD_LOGIN_DEVICE_WINDOW_SECONDS: positiveInteger(3_600, 86_400),
    PASSWORD_RECOVERY_TTL_SECONDS: positiveInteger(1_800, 86_400),
    PASSWORD_RECOVERY_COOLDOWN_SECONDS: positiveInteger(300, 3_600),
    PASSWORD_RECOVERY_MAX_ATTEMPTS: positiveInteger(5, 20),
    PASSWORD_RECOVERY_DESTINATION_LIMIT: positiveInteger(3, 100),
    PASSWORD_RECOVERY_DESTINATION_WINDOW_SECONDS: positiveInteger(3_600, 86_400),
    PASSWORD_RECOVERY_IP_LIMIT: positiveInteger(20, 1_000),
    PASSWORD_RECOVERY_IP_WINDOW_SECONDS: positiveInteger(3_600, 86_400),
    PASSWORD_RECOVERY_DEVICE_LIMIT: positiveInteger(10, 500),
    PASSWORD_RECOVERY_DEVICE_WINDOW_SECONDS: positiveInteger(3_600, 86_400),
    FEATURE_PAYMENTS: booleanValue(false),
    FEATURE_MESSAGING: booleanValue(true),
    FEATURE_COMMUNITY: booleanValue(false),
    FEATURE_CROSS_BORDER: booleanValue(false),
  })
  .superRefine((value, context) => {
    if (value.SESSION_IDLE_TTL_SECONDS > value.SESSION_ABSOLUTE_TTL_SECONDS) {
      context.addIssue({
        code: "custom",
        path: ["SESSION_IDLE_TTL_SECONDS"],
        message: "Idle session lifetime cannot exceed the absolute lifetime",
      });
    }
    if (value.SESSION_TOUCH_INTERVAL_SECONDS >= value.SESSION_IDLE_TTL_SECONDS) {
      context.addIssue({
        code: "custom",
        path: ["SESSION_TOUCH_INTERVAL_SECONDS"],
        message: "Session touch interval must be shorter than the idle lifetime",
      });
    }
    if (
      value.OTP_SECRET instanceof SecretValue &&
      value.SESSION_SECRET instanceof SecretValue &&
      value.CSRF_SECRET instanceof SecretValue &&
      (value.OTP_SECRET.reveal() === value.SESSION_SECRET.reveal() ||
        value.OTP_SECRET.reveal() === value.CSRF_SECRET.reveal())
    ) {
      context.addIssue({
        code: "custom",
        path: ["OTP_SECRET"],
        message: "OTP secret must be distinct from session and CSRF secrets",
      });
    }
    if (
      value.MFA_SECRET instanceof SecretValue &&
      value.SESSION_SECRET instanceof SecretValue &&
      value.CSRF_SECRET instanceof SecretValue &&
      value.OTP_SECRET instanceof SecretValue &&
      [
        value.SESSION_SECRET.reveal(),
        value.CSRF_SECRET.reveal(),
        value.OTP_SECRET.reveal(),
      ].includes(value.MFA_SECRET.reveal())
    ) {
      context.addIssue({
        code: "custom",
        path: ["MFA_SECRET"],
        message: "MFA secret must be distinct from session, CSRF, and OTP secrets",
      });
    }
    if (
      value.PASSWORD_PEPPER instanceof SecretValue &&
      value.SESSION_SECRET instanceof SecretValue &&
      value.CSRF_SECRET instanceof SecretValue &&
      value.OTP_SECRET instanceof SecretValue &&
      value.MFA_SECRET instanceof SecretValue &&
      [
        value.SESSION_SECRET.reveal(),
        value.CSRF_SECRET.reveal(),
        value.OTP_SECRET.reveal(),
        value.MFA_SECRET.reveal(),
      ].includes(value.PASSWORD_PEPPER.reveal())
    ) {
      context.addIssue({
        code: "custom",
        path: ["PASSWORD_PEPPER"],
        message: "Password pepper must be distinct from session, CSRF, OTP, and MFA secrets",
      });
    }
    if (value.PASSWORD_RECOVERY_COOLDOWN_SECONDS >= value.PASSWORD_RECOVERY_TTL_SECONDS) {
      context.addIssue({
        code: "custom",
        path: ["PASSWORD_RECOVERY_COOLDOWN_SECONDS"],
        message: "Password recovery cooldown must be shorter than the recovery lifetime",
      });
    }
    if (value.ADMIN_SESSION_IDLE_TTL_SECONDS > value.ADMIN_SESSION_ABSOLUTE_TTL_SECONDS) {
      context.addIssue({
        code: "custom",
        path: ["ADMIN_SESSION_IDLE_TTL_SECONDS"],
        message: "Admin idle session lifetime cannot exceed the absolute lifetime",
      });
    }
    if (value.ADMIN_STEP_UP_TTL_SECONDS > value.ADMIN_SESSION_ABSOLUTE_TTL_SECONDS) {
      context.addIssue({
        code: "custom",
        path: ["ADMIN_STEP_UP_TTL_SECONDS"],
        message: "Admin step-up lifetime cannot exceed the absolute session lifetime",
      });
    }
    if (Boolean(value.S3_ACCESS_KEY) !== Boolean(value.S3_SECRET_KEY)) {
      context.addIssue({
        code: "custom",
        path: ["S3_ACCESS_KEY"],
        message: "S3 access key and secret key must be supplied together",
      });
    }
  });

const workerEnvironmentSchema = commonServerSchema.extend({
  REDIS_URL: z.string().url(),
  WORKER_CONCURRENCY: positiveInteger(5, 100),
  WORKER_HEALTH_PORT: positiveInteger(4001, 65_535),
});

export class RuntimeConfigError extends Error {
  readonly code = "INVALID_RUNTIME_CONFIGURATION";

  constructor(issues: readonly string[]) {
    super(`Invalid runtime configuration: ${issues.join("; ")}`);
    this.name = "RuntimeConfigError";
  }
}

export class SecretValue {
  readonly #value: string;

  constructor(value: string) {
    this.#value = value;
  }

  reveal(): string {
    return this.#value;
  }

  toJSON(): string {
    return "[REDACTED]";
  }

  toString(): string {
    return "[REDACTED]";
  }
}

function parseEnvironment<T>(schema: ZodType<T>, input: EnvironmentInput): T {
  const result = schema.safeParse(input);
  if (result.success) return result.data;

  const issues = result.error.issues.map((issue) => {
    const field = issue.path.join(".") || "environment";
    return `${field}: ${issue.message}`;
  });
  throw new RuntimeConfigError(issues);
}

export type ApiEnvironment = z.infer<typeof apiEnvironmentSchema>;
export type WorkerEnvironment = z.infer<typeof workerEnvironmentSchema>;

export function parseApiEnvironment(input: EnvironmentInput): ApiEnvironment {
  return parseEnvironment(apiEnvironmentSchema, input);
}

export function parseWorkerEnvironment(input: EnvironmentInput): WorkerEnvironment {
  return parseEnvironment(workerEnvironmentSchema, input);
}

const sensitiveKeyPattern =
  /(?:secret|password|token|authorization|cookie|credential|private[_-]?key|access[_-]?key)/i;

export function redactSensitiveValue(key: string, value: unknown): unknown {
  if (value instanceof SecretValue || sensitiveKeyPattern.test(key)) return "[REDACTED]";
  if (Array.isArray(value)) {
    return value.map((entry) => redactSensitiveValue(key, entry));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([childKey, childValue]) => [
        childKey,
        redactSensitiveValue(childKey, childValue),
      ]),
    );
  }
  return value;
}

export function runtimeConfigSummary(
  environment: ApiEnvironment | WorkerEnvironment,
): Record<string, unknown> {
  return {
    appEnv: environment.APP_ENV,
    appName: environment.APP_NAME,
    logLevel: environment.LOG_LEVEL,
    nodeEnv: environment.NODE_ENV,
    otelEnabled: Boolean(environment.OTEL_EXPORTER_OTLP_ENDPOINT),
  };
}
