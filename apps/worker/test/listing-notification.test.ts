import { randomUUID } from "node:crypto";
import {
  NotificationEventValidationError,
  NotificationTemplateUnavailableError,
  type ConsumeListingNotificationResult,
  type ListingNotificationEventInput,
} from "@socal/database/notification";
import { describe, expect, it, vi } from "vitest";
import {
  ListingNotificationHandler,
  PermanentListingNotificationError,
  parseListingNotificationEnvelope,
  type ListingNotificationOutcome,
} from "../src/notification/listing-notification";

const eventId = "10000000-0000-4000-8000-000000000001";
const listingId = "20000000-0000-4000-8000-000000000001";

function envelope(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 1,
    eventId,
    aggregateType: "LISTING",
    aggregateId: listingId,
    eventType: "listing.submitted",
    occurredAt: "2026-07-30T01:00:00.000Z",
    payload: {
      schemaVersion: 1,
      aggregateVersion: 2,
      listingId,
      type: "RENTAL",
      riskTier: "MEDIUM",
    },
    ...overrides,
  };
}

function createdResult(): ConsumeListingNotificationResult {
  return {
    kind: "created",
    notification: {
      id: randomUUID(),
      userId: randomUUID(),
      templateKey: "listing.status.submitted",
      templateVersion: 1,
      locale: "zh-Hans",
      title: "信息已提交",
      body: "你的信息已提交审核。",
      resourceType: "LISTING",
      resourceId: listingId,
      status: "UNREAD",
      createdAt: new Date("2026-07-30T01:00:00.000Z"),
      readAt: null,
    },
  };
}

describe("listing notification worker", () => {
  it("parses a strict outbox envelope without retaining unrelated payload fields", () => {
    const input = parseListingNotificationEnvelope(
      envelope({
        payload: {
          schemaVersion: 1,
          aggregateVersion: 2,
          listingId,
          riskTier: "MEDIUM",
          email: "private@example.invalid",
        },
      }),
      "listing.submitted",
    );

    expect(input).toEqual({
      eventId,
      eventType: "listing.submitted",
      listingId,
      aggregateVersion: 2,
      occurredAt: new Date("2026-07-30T01:00:00.000Z"),
      riskTier: "MEDIUM",
    });
    expect(JSON.stringify(input)).not.toContain("private@example.invalid");
  });

  it.each([
    ["wrong version", { version: 2 }],
    ["wrong aggregate type", { aggregateType: "USER" }],
    ["aggregate mismatch", { aggregateId: randomUUID() }],
    ["event mismatch", { eventType: "listing.published" }],
    ["non-canonical time", { occurredAt: "2026-07-30T01:00:00Z" }],
    [
      "invalid payload",
      { payload: { schemaVersion: 1, aggregateVersion: 0, listingId, riskTier: "MEDIUM" } },
    ],
    ["missing submitted risk", { payload: { schemaVersion: 1, aggregateVersion: 2, listingId } }],
  ])("rejects %s as a permanent failure", (_name, overrides) => {
    expect(() =>
      parseListingNotificationEnvelope(envelope(overrides), "listing.submitted"),
    ).toThrow(PermanentListingNotificationError);
  });

  it.each([
    ["created", "created"],
    ["existing", "duplicate"],
    ["ignored", "ignored"],
    ["recipient_unavailable", "recipient_unavailable"],
  ] as const)("records the bounded %s repository result", async (kind, expectedOutcome) => {
    let result: ConsumeListingNotificationResult;
    if (kind === "created") {
      result = createdResult();
    } else if (kind === "existing") {
      const created = createdResult();
      if (created.kind !== "created") throw new Error("Expected a created fixture");
      result = { kind: "existing", notification: created.notification };
    } else {
      result = { kind };
    }
    const consumeListingEvent = vi.fn<
      (input: ListingNotificationEventInput) => Promise<ConsumeListingNotificationResult>
    >(() => Promise.resolve(result));
    const outcomes: ListingNotificationOutcome[] = [];
    const handler = new ListingNotificationHandler({ consumeListingEvent }, (value) =>
      outcomes.push(value),
    );

    await handler.handle(envelope(), "listing.submitted");

    expect(consumeListingEvent).toHaveBeenCalledTimes(1);
    expect(outcomes).toEqual([expectedOutcome]);
  });

  it.each([new NotificationEventValidationError(), new NotificationTemplateUnavailableError()])(
    "converts invalid source/template data into an unrecoverable failure",
    async (error) => {
      const handler = new ListingNotificationHandler({
        consumeListingEvent: () => Promise.reject(error),
      });

      await expect(handler.handle(envelope(), "listing.submitted")).rejects.toBeInstanceOf(
        PermanentListingNotificationError,
      );
    },
  );

  it("preserves transient repository failures for queue retry and records failure once", async () => {
    const transient = new Error("connection unavailable");
    const outcomes: ListingNotificationOutcome[] = [];
    const handler = new ListingNotificationHandler(
      { consumeListingEvent: () => Promise.reject(transient) },
      (value) => outcomes.push(value),
    );

    await expect(handler.handle(envelope(), "listing.submitted")).rejects.toBe(transient);
    expect(outcomes).toEqual(["failed"]);
  });
});
