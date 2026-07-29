import { describe, expect, it, vi } from "vitest";
import type { OutboxJobEnvelope } from "../src/outbox/bullmq-outbox.publisher";
import {
  HomepageCacheInvalidationHandler,
  PermanentHomepageCacheInvalidationError,
  parseHomepageLayoutPublishedEnvelope,
} from "../src/homepage/homepage-cache-invalidation";
import { RedisHomepageCacheInvalidator } from "../src/homepage/redis-homepage-cache-invalidator";

const eventId = "77000000-0000-4000-8000-000000000001";
const layoutId = "77000000-0000-4000-8000-000000000002";

function envelope(): OutboxJobEnvelope {
  return {
    version: 1,
    eventId,
    aggregateType: "HOMEPAGE_LAYOUT",
    aggregateId: layoutId,
    eventType: "homepage.layout.published",
    occurredAt: "2026-07-29T12:00:00.000Z",
    payload: {
      schemaVersion: 1,
      layoutId,
      locale: "zh-Hans",
      regionCode: "US-CA-SOCAL",
      version: 4,
      contentHash: "a".repeat(64),
      operation: "publish",
      occurredAt: "2026-07-29T12:00:00.000Z",
      phone: "must-not-be-consumed",
    },
  };
}

describe("homepage cache invalidation consumer", () => {
  it("parses only the bounded cache identity and rejects malformed envelopes", () => {
    expect(parseHomepageLayoutPublishedEnvelope(envelope())).toEqual({
      locale: "zh-Hans",
      regionCode: "US-CA-SOCAL",
      version: 4,
    });
    expect(() =>
      parseHomepageLayoutPublishedEnvelope({
        ...envelope(),
        aggregateType: "USER",
      }),
    ).toThrow(PermanentHomepageCacheInvalidationError);
    expect(() =>
      parseHomepageLayoutPublishedEnvelope({
        ...envelope(),
        payload: { ...(envelope().payload as Record<string, unknown>), contentHash: "bad" },
      }),
    ).toThrow(PermanentHomepageCacheInvalidationError);
  });

  it("records fixed invalidated, stale, and failed outcomes without payload labels", async () => {
    const observed: string[] = [];
    const invalidate = vi
      .fn()
      .mockResolvedValueOnce("invalidated")
      .mockResolvedValueOnce("stale")
      .mockRejectedValueOnce(new Error("Redis secret detail"));
    const handler = new HomepageCacheInvalidationHandler({ invalidate }, (outcome) =>
      observed.push(outcome),
    );

    await expect(handler.handle(envelope())).resolves.toBe("invalidated");
    await expect(handler.handle(envelope())).resolves.toBe("stale");
    await expect(handler.handle(envelope())).rejects.toThrow(
      "Homepage cache invalidation dependency failed",
    );
    expect(observed).toEqual(["invalidated", "stale", "failed"]);
  });

  it("atomically advances the layout version and deletes all device variants", async () => {
    const evalScript = vi.fn(() => Promise.resolve(1));
    const invalidator = new RedisHomepageCacheInvalidator({ eval: evalScript });
    await expect(
      invalidator.invalidate({
        locale: "en-US",
        regionCode: "US-CA-SOCAL",
        version: 5,
      }),
    ).resolves.toBe("invalidated");
    expect(evalScript).toHaveBeenCalledWith(
      expect.stringContaining('redis.call("DEL"'),
      4,
      "socal:homepage:v1:en-US:US-CA-SOCAL:layout-version",
      "socal:homepage:v1:en-US:US-CA-SOCAL:desktop",
      "socal:homepage:v1:en-US:US-CA-SOCAL:tablet",
      "socal:homepage:v1:en-US:US-CA-SOCAL:mobile",
      5,
    );
  });

  it("treats an older or duplicate version as stale", async () => {
    const invalidator = new RedisHomepageCacheInvalidator({
      eval: () => Promise.resolve(0),
    });
    await expect(
      invalidator.invalidate({
        locale: "zh-Hans",
        regionCode: "US-CA-SOCAL",
        version: 4,
      }),
    ).resolves.toBe("stale");
  });
});
