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
