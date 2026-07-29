import { describe, expect, it } from "vitest";
import {
  assertListingInvariants,
  createDraftListing,
  ListingDomainError,
  transitionListing,
  type CreateDraftListingInput,
  type ListingAggregate,
  type ListingDetail,
  type ListingTransitionCommand,
  type ListingType,
} from "../src/modules/listings/listing-domain";

const listingId = "81000000-0000-4000-8000-000000000001";
const actorId = "81000000-0000-4000-8000-000000000002";
const createdAt = new Date("2026-07-29T01:00:00.000Z");

const details: Record<ListingType, ListingDetail> = {
  JOB: { kind: "JOB", wageMinMinor: 2_500n, wageMaxMinor: 4_000n, wageUnit: "HOURLY" },
  RENTAL: { kind: "RENTAL", bedrooms: 2, bathrooms: 1.5, depositMinor: 250_000n },
  TRANSFER: {
    kind: "TRANSFER",
    askingPriceMinor: 2_500_000n,
    monthlyRentMinor: 350_000n,
    leaseRemainingMonths: 36,
  },
  SECONDHAND: { kind: "SECONDHAND", condition: "GOOD" },
  SERVICE: { kind: "SERVICE", serviceRadiusMiles: 50 },
};

function draft(overrides: Partial<CreateDraftListingInput> = {}): ListingAggregate {
  return createDraftListing({
    id: listingId,
    type: "RENTAL",
    detail: details.RENTAL,
    price: { amountMinor: 325_000n, currency: "USD", unit: "MONTHLY" },
    createdAt,
    ...overrides,
  });
}

function command(
  kind: ListingTransitionCommand["kind"],
  listing: ListingAggregate,
  overrides: Partial<ListingTransitionCommand> = {},
): ListingTransitionCommand {
  return {
    kind,
    actorId,
    expectedVersion: listing.version,
    occurredAt: new Date(listing.updatedAt.getTime() + 1_000),
    reasonCode: `TEST_${kind}`,
    ...(kind === "AUTO_APPROVE" || kind === "MODERATOR_APPROVE" ? { lifetimeDays: 30 } : {}),
    ...overrides,
  } as ListingTransitionCommand;
}

function submit(listing: ListingAggregate = draft()): ListingAggregate {
  return transitionListing(listing, command("SUBMIT", listing)).listing;
}

function publish(
  listing: ListingAggregate = submit(),
  kind: "AUTO_APPROVE" | "MODERATOR_APPROVE" = "MODERATOR_APPROVE",
): ListingAggregate {
  return transitionListing(listing, command(kind, listing)).listing;
}

function expectDomainError(run: () => unknown, code: ListingDomainError["code"]): void {
  try {
    run();
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(ListingDomainError);
    expect((error as ListingDomainError).code).toBe(code);
    return;
  }
  throw new Error(`Expected ${code}`);
}

describe("Listing domain", () => {
  it("creates all five types only with their matching detail", () => {
    for (const type of Object.keys(details) as ListingType[]) {
      const listing = draft({ type, detail: details[type], price: null });
      expect(listing).toMatchObject({
        type,
        status: "DRAFT",
        moderationStatus: "NOT_REVIEWED",
        version: 1,
      });
    }

    expectDomainError(() => draft({ type: "JOB", detail: details.RENTAL }), "DETAIL_TYPE_MISMATCH");
    expectDomainError(
      () =>
        draft({
          type: "JOB",
          detail: {
            kind: "JOB",
            wageMinMinor: 5_000n,
            wageMaxMinor: 4_000n,
            wageUnit: "HOURLY",
          },
        }),
      "INVALID_DETAIL",
    );
    expectDomainError(
      () => draft({ type: "SERVICE", detail: { kind: "SERVICE", serviceRadiusMiles: 251 } }),
      "INVALID_DETAIL",
    );
    expectDomainError(
      () =>
        draft({
          type: "JOB",
          detail: {
            kind: "JOB",
            wageUnit: "SQFT" as NonNullable<Extract<ListingDetail, { kind: "JOB" }>["wageUnit"]>,
          },
        }),
      "INVALID_DETAIL",
    );
  });

  it("enforces integer-minor-unit price semantics including FREE and NEGOTIABLE", () => {
    expect(
      draft({ price: { amountMinor: null, currency: "USD", unit: "FREE" } }).price,
    ).toMatchObject({ amountMinor: null, unit: "FREE" });
    expect(
      draft({ price: { amountMinor: null, currency: "USD", unit: "NEGOTIABLE" } }).price,
    ).toMatchObject({ amountMinor: null, unit: "NEGOTIABLE" });

    for (const price of [
      { amountMinor: 0n, currency: "USD", unit: "FIXED" },
      { amountMinor: null, currency: "USD", unit: "MONTHLY" },
      { amountMinor: 1n, currency: "USD", unit: "FREE" },
      { amountMinor: -1n, currency: "USD", unit: "HOURLY" },
    ] as const) {
      expectDomainError(() => draft({ price }), "INVALID_PRICE");
    }
  });

  it("runs submit, escalation, rejection and resubmission with versioned evidence", () => {
    const submitted = transitionListing(draft(), command("SUBMIT", draft()));
    expect(submitted.listing).toMatchObject({
      status: "SUBMITTED",
      moderationStatus: "PENDING_REVIEW",
      version: 2,
    });
    expect(submitted.event).toMatchObject({
      previousStatus: "DRAFT",
      currentStatus: "SUBMITTED",
      previousVersion: 1,
      currentVersion: 2,
      actorId,
    });

    const escalated = transitionListing(
      submitted.listing,
      command("ESCALATE", submitted.listing),
    ).listing;
    expect(escalated.moderationStatus).toBe("ESCALATED");

    const rejected = transitionListing(escalated, command("REJECT_TO_DRAFT", escalated)).listing;
    expect(rejected).toMatchObject({ status: "DRAFT", moderationStatus: "REJECTED" });
    expect(submit(rejected)).toMatchObject({
      status: "SUBMITTED",
      moderationStatus: "PENDING_REVIEW",
    });
  });

  it("publishes only reviewed submissions with a bounded UTC expiry", () => {
    const submitted = submit();
    const approved = transitionListing(
      submitted,
      command("MODERATOR_APPROVE", submitted, { lifetimeDays: 30 }),
    ).listing;
    expect(approved).toMatchObject({
      status: "PUBLISHED",
      moderationStatus: "APPROVED",
      version: 3,
    });
    expect(approved.expiresAt?.getTime()).toBe(
      (approved.publishedAt?.getTime() ?? 0) + 30 * 86_400_000,
    );

    const escalated = transitionListing(submitted, command("ESCALATE", submitted)).listing;
    expectDomainError(
      () => transitionListing(escalated, command("AUTO_APPROVE", escalated)),
      "INVALID_STATE_TRANSITION",
    );
    expectDomainError(
      () =>
        transitionListing(
          submitted,
          command("MODERATOR_APPROVE", submitted, { lifetimeDays: 366 }),
        ),
      "INVALID_EXPIRY",
    );
  });

  it("approves a major revision without granting a fresh publication window", () => {
    const originalPublishedAt = new Date("2026-07-20T00:00:00.000Z");
    const originalExpiresAt = new Date("2026-08-19T00:00:00.000Z");
    const submittedRevision: ListingAggregate = {
      ...submit(),
      createdAt: new Date("2026-07-01T00:00:00.000Z"),
      updatedAt: new Date("2026-07-29T00:00:00.000Z"),
    };
    const approved = transitionListing(submittedRevision, {
      kind: "MODERATOR_APPROVE_REVISION",
      actorId,
      expectedVersion: submittedRevision.version,
      occurredAt: new Date("2026-07-30T00:00:00.000Z"),
      reasonCode: "CONTENT_POLICY_COMPLIANT",
      originalPublishedAt,
      originalExpiresAt,
    }).listing;
    expect(approved).toMatchObject({
      status: "PUBLISHED",
      moderationStatus: "APPROVED",
      publishedAt: originalPublishedAt,
      expiresAt: originalExpiresAt,
    });

    const expired = transitionListing(submittedRevision, {
      kind: "MODERATOR_APPROVE_REVISION",
      actorId,
      expectedVersion: submittedRevision.version,
      occurredAt: originalExpiresAt,
      reasonCode: "CONTENT_POLICY_COMPLIANT",
      originalPublishedAt,
      originalExpiresAt,
    }).listing;
    expect(expired).toMatchObject({
      status: "EXPIRED",
      publishedAt: originalPublishedAt,
      expiresAt: originalExpiresAt,
    });
  });

  it("expires at the policy instant, archives by owner action, and preserves publication evidence", () => {
    const published = publish();
    expectDomainError(
      () =>
        transitionListing(
          published,
          command("EXPIRE", published, {
            occurredAt: new Date((published.expiresAt?.getTime() ?? 0) - 1),
          }),
        ),
      "INVALID_STATE_TRANSITION",
    );

    const expired = transitionListing(
      published,
      command("EXPIRE", published, { occurredAt: published.expiresAt ?? createdAt }),
    ).listing;
    expect(expired).toMatchObject({
      status: "EXPIRED",
      publishedAt: published.publishedAt,
      expiresAt: published.expiresAt,
    });

    const archived = transitionListing(publish(), command("ARCHIVE", publish())).listing;
    expect(archived.status).toBe("ARCHIVED");
  });

  it("suspends submitted or published content and soft-deletes every non-deleted state once", () => {
    expect(transitionListing(submit(), command("SUSPEND", submit())).listing).toMatchObject({
      status: "SUSPENDED",
      moderationStatus: "REJECTED",
    });
    const published = publish();
    const suspended = transitionListing(published, command("SUSPEND", published)).listing;
    expect(suspended.publishedAt).toEqual(published.publishedAt);
    const restored = transitionListing(
      suspended,
      command("RESTORE", suspended, {
        occurredAt: new Date(suspended.updatedAt.getTime() + 1_000),
      }),
    ).listing;
    expect(restored).toMatchObject({
      status: "PUBLISHED",
      moderationStatus: "APPROVED",
      publishedAt: published.publishedAt,
      expiresAt: published.expiresAt,
      version: suspended.version + 1,
    });

    for (const listing of [draft(), submit(), published, suspended, restored]) {
      const deleted = transitionListing(listing, command("DELETE", listing)).listing;
      expect(deleted.status).toBe("DELETED");
      expect(deleted.deletedAt).toEqual(deleted.updatedAt);
      expectDomainError(
        () => transitionListing(deleted, command("DELETE", deleted)),
        "INVALID_STATE_TRANSITION",
      );
    }
  });

  it("rejects illegal transitions, stale versions and unsafe transition metadata", () => {
    expectDomainError(
      () => transitionListing(draft(), command("ARCHIVE", draft())),
      "INVALID_STATE_TRANSITION",
    );
    expectDomainError(
      () => transitionListing(draft(), command("RESTORE", draft())),
      "INVALID_STATE_TRANSITION",
    );
    const submitted = submit();
    expectDomainError(
      () =>
        transitionListing(
          submitted,
          command("MODERATOR_APPROVE", submitted, {
            expectedVersion: submitted.version - 1,
          }),
        ),
      "VERSION_CONFLICT",
    );
    expectDomainError(
      () =>
        transitionListing(
          submitted,
          command("MODERATOR_APPROVE", submitted, { reasonCode: "unsafe reason" }),
        ),
      "INVALID_TRANSITION_METADATA",
    );
    expectDomainError(
      () =>
        transitionListing(
          submitted,
          command("MODERATOR_APPROVE", submitted, {
            occurredAt: new Date(submitted.updatedAt.getTime() - 1),
          }),
        ),
      "INVALID_TRANSITION_METADATA",
    );
  });

  it("rejects externally reconstructed snapshots that violate lifecycle invariants", () => {
    expectDomainError(
      () =>
        assertListingInvariants({
          ...draft(),
          status: "PUBLISHED",
          moderationStatus: "APPROVED",
        }),
      "INVALID_EXPIRY",
    );
    expectDomainError(
      () =>
        assertListingInvariants({
          ...draft(),
          status: "PUBLISHED",
          moderationStatus: "NOT_REVIEWED",
          publishedAt: createdAt,
          expiresAt: new Date(createdAt.getTime() + 86_400_000),
        }),
      "INVALID_MODERATION_STATE",
    );
    expectDomainError(
      () =>
        assertListingInvariants({
          ...draft(),
          type: "UNKNOWN" as ListingAggregate["type"],
          detail: { kind: "UNKNOWN" } as unknown as ListingDetail,
        }),
      "INVALID_DETAIL",
    );
    expectDomainError(
      () =>
        assertListingInvariants({
          ...draft(),
          price: {
            amountMinor: 100n,
            currency: "USD",
            unit: "UNKNOWN" as NonNullable<ListingAggregate["price"]>["unit"],
          },
        }),
      "INVALID_PRICE",
    );
    expectDomainError(
      () =>
        assertListingInvariants({
          ...draft(),
          moderationStatus: "UNKNOWN" as ListingAggregate["moderationStatus"],
        }),
      "INVALID_MODERATION_STATE",
    );
    expectDomainError(
      () => transitionListing(draft(), command("SUBMIT", draft(), { actorId: "not-a-uuid" })),
      "INVALID_IDENTIFIER",
    );
    expectDomainError(() => draft({ id: "not-a-uuid" }), "INVALID_IDENTIFIER");
  });
});
