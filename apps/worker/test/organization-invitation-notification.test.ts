import type {
  ConsumeListingNotificationResult,
  OrganizationInvitationNotificationEventInput,
} from "@socal/database/notification";
import { describe, expect, it, vi } from "vitest";
import {
  OrganizationInvitationNotificationHandler,
  PermanentOrganizationInvitationNotificationError,
  parseOrganizationInvitationNotificationEnvelope,
} from "../src/notification/organization-invitation-notification";

const eventId = "10000000-0000-4000-8000-000000000001";
const invitationId = "20000000-0000-4000-8000-000000000001";

function envelope(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 1,
    eventId,
    aggregateType: "ORGANIZATION_INVITATION",
    aggregateId: invitationId,
    eventType: "organization.invitation.created",
    occurredAt: "2026-07-30T02:00:00.000Z",
    payload: {
      schemaVersion: 1,
      invitationId,
      aggregateVersion: 1,
    },
    ...overrides,
  };
}

describe("organization invitation notification worker", () => {
  it("parses only the strict minimal invitation envelope", () => {
    expect(parseOrganizationInvitationNotificationEnvelope(envelope())).toEqual({
      eventId,
      eventType: "organization.invitation.created",
      invitationId,
      aggregateVersion: 1,
      occurredAt: new Date("2026-07-30T02:00:00.000Z"),
    });
  });

  it.each([
    ["wrong aggregate", { aggregateType: "ORGANIZATION" }],
    ["wrong event", { eventType: "organization.invitation.revoked" }],
    ["non-canonical time", { occurredAt: "2026-07-30T02:00:00Z" }],
    ["wrong version", { payload: { schemaVersion: 1, invitationId, aggregateVersion: 2 } }],
  ])("rejects %s permanently", (_name, overrides) => {
    expect(() => parseOrganizationInvitationNotificationEnvelope(envelope(overrides))).toThrow(
      PermanentOrganizationInvitationNotificationError,
    );
  });

  it("maps an existing projection to a duplicate outcome", async () => {
    const result: ConsumeListingNotificationResult = {
      kind: "existing",
      notification: {
        id: "30000000-0000-4000-8000-000000000001",
        userId: "40000000-0000-4000-8000-000000000001",
        templateKey: "organization.invitation.created",
        templateVersion: 1,
        locale: "en-US",
        title: "You received an organization invitation",
        body: "Review the invitation before it expires.",
        resourceType: "ORGANIZATION_INVITATION",
        resourceId: invitationId,
        status: "UNREAD",
        createdAt: new Date("2026-07-30T02:00:00.000Z"),
        readAt: null,
      },
    };
    const consumeOrganizationInvitationEvent = vi.fn<
      (
        input: OrganizationInvitationNotificationEventInput,
      ) => Promise<ConsumeListingNotificationResult>
    >(() => Promise.resolve(result));
    const outcomes: string[] = [];
    const handler = new OrganizationInvitationNotificationHandler(
      { consumeOrganizationInvitationEvent },
      (value) => outcomes.push(value),
    );

    await handler.handle(envelope());

    expect(consumeOrganizationInvitationEvent).toHaveBeenCalledOnce();
    expect(outcomes).toEqual(["duplicate"]);
  });

  it("preserves transient failures for queue retry", async () => {
    const transient = new Error("database unavailable");
    const handler = new OrganizationInvitationNotificationHandler({
      consumeOrganizationInvitationEvent: () => Promise.reject(transient),
    });

    await expect(handler.handle(envelope())).rejects.toBe(transient);
  });
});
