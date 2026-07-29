import type { OutboxJobEnvelope } from "../outbox/bullmq-outbox.publisher";

export const homepageLayoutPublishedEventType = "homepage.layout.published";

export type HomepageCacheInvalidationOutcome = "invalidated" | "stale" | "failed";

export type HomepageCacheInvalidator = {
  invalidate(input: {
    locale: "zh-Hans" | "en-US";
    regionCode: string;
    version: number;
  }): Promise<"invalidated" | "stale">;
};

type HomepageLayoutPublishedEvent = {
  locale: "zh-Hans" | "en-US";
  regionCode: string;
  version: number;
};

export class PermanentHomepageCacheInvalidationError extends Error {
  readonly code = "HOMEPAGE_CACHE_INVALIDATION_EVENT_INVALID";

  constructor() {
    super("The homepage cache invalidation event cannot be processed");
    this.name = "PermanentHomepageCacheInvalidationError";
  }
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const regionCodePattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{1,79}$/;
const contentHashPattern = /^[0-9a-f]{64}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function canonicalInstant(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const instant = new Date(value);
  return Number.isFinite(instant.getTime()) && instant.toISOString() === value;
}

export function parseHomepageLayoutPublishedEnvelope(value: unknown): HomepageLayoutPublishedEvent {
  if (!isRecord(value)) throw new PermanentHomepageCacheInvalidationError();
  const envelope = value as Partial<OutboxJobEnvelope>;
  const payload = envelope.payload;
  if (
    envelope.version !== 1 ||
    typeof envelope.eventId !== "string" ||
    !uuidPattern.test(envelope.eventId) ||
    envelope.aggregateType !== "HOMEPAGE_LAYOUT" ||
    typeof envelope.aggregateId !== "string" ||
    !uuidPattern.test(envelope.aggregateId) ||
    envelope.eventType !== homepageLayoutPublishedEventType ||
    !canonicalInstant(envelope.occurredAt) ||
    !isRecord(payload) ||
    payload.schemaVersion !== 1 ||
    payload.layoutId !== envelope.aggregateId ||
    (payload.locale !== "zh-Hans" && payload.locale !== "en-US") ||
    typeof payload.regionCode !== "string" ||
    !regionCodePattern.test(payload.regionCode) ||
    !Number.isInteger(payload.version) ||
    (payload.version as number) < 1 ||
    typeof payload.contentHash !== "string" ||
    !contentHashPattern.test(payload.contentHash) ||
    (payload.operation !== "publish" && payload.operation !== "rollback") ||
    !canonicalInstant(payload.occurredAt) ||
    (payload.basedOnVersion !== undefined &&
      (!Number.isInteger(payload.basedOnVersion) || (payload.basedOnVersion as number) < 1))
  ) {
    throw new PermanentHomepageCacheInvalidationError();
  }
  return {
    locale: payload.locale,
    regionCode: payload.regionCode,
    version: payload.version as number,
  };
}

export class HomepageCacheInvalidationHandler {
  constructor(
    private readonly invalidator: HomepageCacheInvalidator,
    private readonly observe: (outcome: HomepageCacheInvalidationOutcome) => void,
  ) {}

  async handle(value: unknown): Promise<"invalidated" | "stale"> {
    const event = parseHomepageLayoutPublishedEnvelope(value);
    try {
      const outcome = await this.invalidator.invalidate(event);
      this.observe(outcome);
      return outcome;
    } catch {
      this.observe("failed");
      throw new Error("Homepage cache invalidation dependency failed");
    }
  }
}
