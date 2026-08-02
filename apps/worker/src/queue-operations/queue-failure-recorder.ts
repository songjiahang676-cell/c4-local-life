import { createHash } from "node:crypto";
import { UnrecoverableError, type Job } from "bullmq";
import type { RecordQueueDeadLetterInput } from "@socal/database/queue-operations";

type QueueDeadLetterWriter = {
  recordQueueDeadLetter(input: RecordQueueDeadLetterInput): Promise<void>;
};

type OutboxEnvelope = {
  version: 1;
  eventId: string;
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  occurredAt: string;
  payload: unknown;
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const eventTypePattern = /^[a-z][a-z0-9.-]{0,119}$/;
const envelopeKeys = new Set([
  "version",
  "eventId",
  "aggregateType",
  "aggregateId",
  "eventType",
  "occurredAt",
  "payload",
]);

export function parseOutboxEnvelope(value: unknown): OutboxEnvelope | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Partial<OutboxEnvelope>;
  if (
    Object.keys(value).length !== envelopeKeys.size ||
    Object.keys(value).some((key) => !envelopeKeys.has(key)) ||
    candidate.version !== 1 ||
    !uuidPattern.test(candidate.eventId ?? "") ||
    typeof candidate.aggregateType !== "string" ||
    candidate.aggregateType.length < 1 ||
    candidate.aggregateType.length > 80 ||
    !uuidPattern.test(candidate.aggregateId ?? "") ||
    !eventTypePattern.test(candidate.eventType ?? "") ||
    typeof candidate.occurredAt !== "string" ||
    !Number.isFinite(new Date(candidate.occurredAt).getTime()) ||
    !("payload" in candidate)
  ) {
    return null;
  }
  return candidate as OutboxEnvelope;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
    .join(",")}}`;
}

function payloadHash(payload: unknown): string {
  return createHash("sha256").update(canonicalJson(payload), "utf8").digest("hex");
}

function failureCode(error: Error): string {
  if (error instanceof UnrecoverableError && /^[A-Z][A-Z0-9_.-]{1,119}$/.test(error.message)) {
    return error.message;
  }
  return "JOB_HANDLER_FAILED";
}

export function isTerminalJobFailure(job: Job, error: Error): boolean {
  const attempts = job.opts.attempts ?? 1;
  return error instanceof UnrecoverableError || job.attemptsMade >= attempts;
}

export async function recordTerminalJobFailure(input: {
  repository: QueueDeadLetterWriter;
  queueName: string;
  job: Job;
  error: Error;
  failedAt?: Date;
}): Promise<"recorded" | "invalid_envelope" | "retrying"> {
  if (!isTerminalJobFailure(input.job, input.error)) return "retrying";
  const envelope = parseOutboxEnvelope(input.job.data);
  if (!envelope || envelope.eventType !== input.job.name) return "invalid_envelope";
  await input.repository.recordQueueDeadLetter({
    eventId: envelope.eventId,
    queueName: input.queueName,
    eventType: envelope.eventType,
    aggregateType: envelope.aggregateType,
    aggregateId: envelope.aggregateId,
    attemptCount: Math.max(1, input.job.attemptsMade),
    failureCode: failureCode(input.error),
    payloadHash: payloadHash(envelope.payload),
    failedAt: input.failedAt ?? new Date(),
  });
  return "recorded";
}

export function queueFailurePayloadHash(payload: unknown): string {
  return payloadHash(payload);
}
