import { currentObservabilityContext } from "./context";

export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";
export type LogSink = (serializedRecord: string) => void;

export type LoggerConfiguration = {
  service: string;
  environment: string;
  version: string;
  minimumLevel?: LogLevel;
  sink?: LogSink;
  clock?: () => Date;
};

const levelPriority: Record<LogLevel, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
};

const sensitiveKeyPattern =
  /(?:secret|password|passcode|otp|token|authorization|cookie|credential|private[_-]?key|access[_-]?key|email|phone|mobile|address|street|postal|message|body|content|payload|query)/i;
const emailPattern = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const northAmericanPhonePattern =
  /(?<![A-Za-z0-9])(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}(?![A-Za-z0-9])/g;
const paymentCardPattern = /(?<!\d)(?:\d[ -]?){13,19}(?!\d)/g;

function sanitizeString(value: string): string {
  return value
    .replace(emailPattern, "[REDACTED_EMAIL]")
    .replace(northAmericanPhonePattern, "[REDACTED_PHONE]")
    .replace(paymentCardPattern, "[REDACTED_PAYMENT]");
}

function sanitizeValue(key: string, value: unknown, seen: WeakSet<object>): unknown {
  if (sensitiveKeyPattern.test(key)) return "[REDACTED]";
  if (typeof value === "string") return sanitizeString(value);
  if (
    value === null ||
    value === undefined ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) {
    return {
      errorType: value.name,
      errorCode: "UNCLASSIFIED_ERROR",
    };
  }
  if (typeof value === "symbol") return value.description ?? "[SYMBOL]";
  if (typeof value === "function") return "[FUNCTION]";
  if (typeof value !== "object") return "[UNSUPPORTED]";
  if (seen.has(value)) return "[CIRCULAR]";
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeValue(key, entry, seen));
  }

  return Object.fromEntries(
    Object.entries(value).map(([childKey, childValue]) => [
      childKey,
      sanitizeValue(childKey, childValue, seen),
    ]),
  );
}

export function sanitizeLogFields(fields: Record<string, unknown>): Record<string, unknown> {
  return sanitizeValue("", fields, new WeakSet()) as Record<string, unknown>;
}

export class StructuredLogger {
  readonly #clock: () => Date;
  readonly #configuration: LoggerConfiguration;
  readonly #minimumPriority: number;
  readonly #sink: LogSink;

  constructor(configuration: LoggerConfiguration) {
    this.#configuration = configuration;
    this.#clock = configuration.clock ?? (() => new Date());
    this.#minimumPriority = levelPriority[configuration.minimumLevel ?? "info"];
    this.#sink = configuration.sink ?? ((record) => console.log(record));
  }

  log(level: LogLevel, event: string, fields: Record<string, unknown> = {}): void {
    if (levelPriority[level] < this.#minimumPriority) return;

    const safeFields = sanitizeLogFields(fields);
    const safeContext = sanitizeLogFields({ ...currentObservabilityContext() });
    this.#sink(
      JSON.stringify({
        ...safeFields,
        ...safeContext,
        timestamp: this.#clock().toISOString(),
        level,
        event,
        service: this.#configuration.service,
        environment: this.#configuration.environment,
        version: this.#configuration.version,
      }),
    );
  }

  trace(event: string, fields?: Record<string, unknown>): void {
    this.log("trace", event, fields);
  }

  debug(event: string, fields?: Record<string, unknown>): void {
    this.log("debug", event, fields);
  }

  info(event: string, fields?: Record<string, unknown>): void {
    this.log("info", event, fields);
  }

  warn(event: string, fields?: Record<string, unknown>): void {
    this.log("warn", event, fields);
  }

  error(event: string, fields?: Record<string, unknown>): void {
    this.log("error", event, fields);
  }

  fatal(event: string, fields?: Record<string, unknown>): void {
    this.log("fatal", event, fields);
  }
}
