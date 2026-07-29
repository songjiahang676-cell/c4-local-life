import type {
  CommitModerationActionInput,
  CommitModerationActionResult,
  GetModerationCaseInput,
  GetModerationCaseResult,
  ListModerationCasesResult,
  ModerationActionProjection,
  ModerationCaseDetail,
} from "@socal/database/moderation-case";
import type { ModerationStore } from "../../src/modules/admin/moderation.store";

export const memoryModerationCaseId = "40000000-0000-4000-8000-000000000081";
export const memoryModerationListingId = "40000000-0000-4000-8000-000000000082";

export function buildModerationDetail(
  overrides: Partial<ModerationCaseDetail> = {},
): ModerationCaseDetail {
  const createdAt = new Date("2026-07-29T01:00:00.000Z");
  const detail: ModerationCaseDetail = {
    item: {
      id: memoryModerationCaseId,
      targetType: "LISTING",
      targetId: memoryModerationListingId,
      queue: "listing-submission",
      priority: 80,
      riskTier: "HIGH",
      status: "OPEN",
      version: 1,
      listing: {
        id: memoryModerationListingId,
        type: "RENTAL",
        locale: "zh-Hans",
        title: "Synthetic rental submission",
        category: {
          id: "40000000-0000-4000-8000-000000000083",
          code: "rental",
          nameZhHans: "房屋出租",
          nameEn: "Rentals",
        },
        region: {
          id: "40000000-0000-4000-8000-000000000084",
          code: "US-CA-LA",
          nameZhHans: "洛杉矶",
          nameEn: "Los Angeles",
        },
      },
      ruleCodes: ["EXTERNAL_PAYMENT_REQUEST"],
      createdAt,
      updatedAt: createdAt,
    },
    snapshot: {
      listingId: memoryModerationListingId,
      listingVersion: 3,
      type: "RENTAL",
      locale: "zh-Hans",
      title: "Synthetic rental submission",
      summary: "Synthetic summary",
      body: "Synthetic moderation body with enough content.",
      price: { amount: "2500.00", currency: "USD", unit: "MONTHLY" },
      attributes: { bedrooms: 2 },
      contactMode: "IN_APP",
      locationPrecision: "NEIGHBORHOOD",
      mediaIds: [],
      category: {
        id: "40000000-0000-4000-8000-000000000083",
        code: "rental",
        nameZhHans: "房屋出租",
        nameEn: "Rentals",
      },
      region: {
        id: "40000000-0000-4000-8000-000000000084",
        code: "US-CA-LA",
        nameZhHans: "洛杉矶",
        nameEn: "Los Angeles",
      },
      formSchemaVersion: 1,
      defaultLifetimeDays: 30,
      sensitiveFieldsRedacted: true,
      capturedAt: createdAt.toISOString(),
    },
    rules: [
      {
        ruleCode: "EXTERNAL_PAYMENT_REQUEST",
        ruleVersion: 1,
        severity: "HIGH",
        evidenceKey: "body",
      },
    ],
    media: [],
    publisherHistory: {
      accountAgeDays: 3,
      submittedCount: 1,
      publishedCount: 0,
      rejectedCount: 0,
      suspendedCount: 0,
    },
    listing: {
      id: memoryModerationListingId,
      type: "RENTAL",
      status: "SUBMITTED",
      moderationStatus: "ESCALATED",
      detail: {
        kind: "RENTAL",
        bedrooms: 2,
        bathrooms: 1,
        depositMinor: 250_000n,
      },
      price: { amountMinor: 250_000n, currency: "USD", unit: "MONTHLY" },
      publishedAt: null,
      expiresAt: null,
      deletedAt: null,
      createdAt: new Date("2026-07-28T01:00:00.000Z"),
      updatedAt: createdAt,
      version: 3,
    },
  };
  return { ...detail, ...overrides };
}

export class MemoryModerationStore implements ModerationStore {
  readonly commitInputs: CommitModerationActionInput[] = [];
  readonly #actions = new Map<
    string,
    { requestHash: string; action: ModerationActionProjection }
  >();

  constructor(readonly detail = buildModerationDetail()) {}

  list(): Promise<ListModerationCasesResult> {
    return Promise.resolve({
      kind: "listed",
      items: [this.detail.item],
      nextCursor: null,
    });
  }

  get(input: GetModerationCaseInput): Promise<GetModerationCaseResult> {
    return Promise.resolve(
      input.caseId === this.detail.item.id
        ? { kind: "found", detail: this.detail }
        : { kind: "not_found" },
    );
  }

  commit(input: CommitModerationActionInput): Promise<CommitModerationActionResult> {
    this.commitInputs.push(input);
    const prior = this.#actions.get(`${input.actorUserId}:${input.idempotencyKey}`);
    if (prior) {
      return Promise.resolve(
        prior.requestHash === input.requestHash
          ? { kind: "exact_retry", action: prior.action }
          : { kind: "idempotency_conflict" },
      );
    }
    if (input.caseId !== this.detail.item.id) return Promise.resolve({ kind: "not_found" });
    if (input.expectedCaseVersion !== this.detail.item.version) {
      return Promise.resolve({
        kind: "version_conflict",
        currentCaseVersion: this.detail.item.version,
      });
    }
    const projection: ModerationActionProjection = {
      caseId: input.caseId,
      actionId: "40000000-0000-4000-8000-000000000085",
      action: input.action,
      reasonCode: input.reasonCode,
      previousCaseStatus: this.detail.item.status,
      currentCaseStatus: input.action === "ESCALATE" ? "OPEN" : "RESOLVED",
      previousContentStatus: this.detail.listing.status,
      currentContentStatus: input.nextListing.status,
      previousModerationStatus: this.detail.listing.moderationStatus,
      currentModerationStatus: input.nextListing.moderationStatus,
      caseVersion: this.detail.item.version + 1,
      listingVersion: input.nextListing.version,
      occurredAt: input.occurredAt,
    };
    this.#actions.set(`${input.actorUserId}:${input.idempotencyKey}`, {
      requestHash: input.requestHash,
      action: projection,
    });
    return Promise.resolve({ kind: "committed", action: projection });
  }
}
