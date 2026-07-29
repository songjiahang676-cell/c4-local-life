import type {
  AppealCaseDetailRecord,
  CommitAppealActionInput,
  CommitReportActionInput,
  CreateAppealResult,
  CreateReportResult,
  GetAppealCaseResult,
  GetReportCaseResult,
  ListAppealCasesInput,
  ListAppealCasesResult,
  ListReportCasesInput,
  ListReportCasesResult,
  ReportCaseDetailRecord,
  TrustSafetyActionProjection,
} from "@socal/database/trust-safety";
import type { TrustSafetyStore } from "../../src/modules/trust-safety/trust-safety.store";

export const memoryReportId = "40000000-0000-4000-8000-0000000000a1";
export const memoryReportCaseId = "40000000-0000-4000-8000-0000000000a2";
export const memoryAppealId = "40000000-0000-4000-8000-0000000000a3";
export const memoryAppealCaseId = "40000000-0000-4000-8000-0000000000a4";
export const memoryRemovalActionId = "40000000-0000-4000-8000-0000000000a5";
export const memoryListingId = "40000000-0000-4000-8000-0000000000a6";
export const memoryOriginalModeratorId = "40000000-0000-4000-8000-0000000000a7";

const createdAt = new Date("2026-07-29T08:00:00.000Z");
const snapshot = {
  listingId: memoryListingId,
  listingVersion: 4,
  type: "RENTAL" as const,
  locale: "zh-Hans" as const,
  title: "Synthetic report evidence listing",
  summary: "Synthetic summary",
  body: "Synthetic moderation evidence body; never a real advertisement.",
  price: { amount: "2500.00", currency: "USD" as const, unit: "MONTHLY" as const },
  attributes: { bedrooms: 2 },
  contactMode: "IN_APP" as const,
  locationPrecision: "NEIGHBORHOOD" as const,
  mediaIds: [],
  category: {
    id: "40000000-0000-4000-8000-0000000000a8",
    code: "rental",
    nameZhHans: "房屋出租",
    nameEn: "Rentals",
  },
  region: {
    id: "40000000-0000-4000-8000-0000000000a9",
    code: "US-CA-LA",
    nameZhHans: "洛杉矶",
    nameEn: "Los Angeles",
  },
  formSchemaVersion: 1,
  defaultLifetimeDays: 30,
  sensitiveFieldsRedacted: true as const,
  previous: null,
  revision: null,
  capturedAt: createdAt.toISOString(),
};

export function buildReportDetail(): ReportCaseDetailRecord {
  return {
    item: {
      reportId: memoryReportId,
      caseId: memoryReportCaseId,
      targetId: memoryListingId,
      reasonCode: "SCAM_OR_FRAUD",
      reportStatus: "OPEN",
      caseStatus: "OPEN",
      priority: 90,
      caseVersion: 1,
      title: snapshot.title,
      listingType: "RENTAL",
      createdAt,
      updatedAt: createdAt,
    },
    reporterStatement: "The publisher requested an off-platform deposit.",
    snapshot,
    snapshotHash: "a".repeat(64),
    evidenceCapturedAt: createdAt,
    listing: {
      id: memoryListingId,
      type: "RENTAL",
      status: "PUBLISHED",
      moderationStatus: "APPROVED",
      publishedAt: new Date("2026-07-28T08:00:00.000Z"),
      expiresAt: new Date("2026-08-28T08:00:00.000Z"),
      deletedAt: null,
      createdAt: new Date("2026-07-20T08:00:00.000Z"),
      updatedAt: createdAt,
      version: 4,
    },
    actions: [],
  };
}

export function buildAppealDetail(
  originalActorId = memoryOriginalModeratorId,
): AppealCaseDetailRecord {
  return {
    item: {
      appealId: memoryAppealId,
      caseId: memoryAppealCaseId,
      moderationActionId: memoryRemovalActionId,
      targetId: memoryListingId,
      appealStatus: "OPEN",
      caseStatus: "OPEN",
      priority: 80,
      caseVersion: 1,
      title: snapshot.title,
      listingType: "RENTAL",
      createdAt: new Date("2026-07-29T09:00:00.000Z"),
      updatedAt: new Date("2026-07-29T09:00:00.000Z"),
    },
    statement: "The cited claim is supported by the attached public record.",
    originalAction: {
      id: memoryRemovalActionId,
      actorId: originalActorId,
      action: "REMOVE_CONTENT",
      reasonCode: "CONFIRMED_SCAM",
      occurredAt: new Date("2026-07-29T08:30:00.000Z"),
    },
    snapshot: { ...snapshot, listingVersion: 5 },
    snapshotHash: "b".repeat(64),
    evidenceCapturedAt: new Date("2026-07-29T09:00:00.000Z"),
    listing: {
      id: memoryListingId,
      type: "RENTAL",
      status: "SUSPENDED",
      moderationStatus: "REJECTED",
      publishedAt: new Date("2026-07-28T08:00:00.000Z"),
      expiresAt: new Date("2026-08-28T08:00:00.000Z"),
      deletedAt: null,
      createdAt: new Date("2026-07-20T08:00:00.000Z"),
      updatedAt: new Date("2026-07-29T08:30:00.000Z"),
      version: 5,
    },
    actions: [],
  };
}

export class MemoryTrustSafetyStore implements TrustSafetyStore {
  readonly reportActions: CommitReportActionInput[] = [];
  readonly appealActions: CommitAppealActionInput[] = [];
  reportDetail = buildReportDetail();
  appealDetail = buildAppealDetail();
  createReportResultOverride?: CreateReportResult;

  createReport(): Promise<CreateReportResult> {
    if (this.createReportResultOverride) return Promise.resolve(this.createReportResultOverride);
    return Promise.resolve({
      kind: "created",
      receipt: {
        id: memoryReportId,
        targetId: memoryListingId,
        reasonCode: "SCAM_OR_FRAUD",
        status: "OPEN",
        deduplicated: false,
        submittedAt: createdAt,
      },
    });
  }

  createAppeal(): Promise<CreateAppealResult> {
    return Promise.resolve({
      kind: "created",
      receipt: {
        id: memoryAppealId,
        moderationActionId: memoryRemovalActionId,
        status: "OPEN",
        appealDeadline: new Date("2026-08-28T08:30:00.000Z"),
        deduplicated: false,
        submittedAt: new Date("2026-07-29T09:00:00.000Z"),
      },
    });
  }

  listReports(_input: ListReportCasesInput): Promise<ListReportCasesResult> {
    void _input;
    return Promise.resolve({
      kind: "listed",
      items: [this.reportDetail.item],
      nextCursor: null,
    });
  }

  listAppeals(_input: ListAppealCasesInput): Promise<ListAppealCasesResult> {
    void _input;
    return Promise.resolve({
      kind: "listed",
      items: [this.appealDetail.item],
      nextCursor: null,
    });
  }

  getReport(): Promise<GetReportCaseResult> {
    return Promise.resolve({ kind: "found", detail: this.reportDetail });
  }

  getAppeal(): Promise<GetAppealCaseResult> {
    return Promise.resolve({ kind: "found", detail: this.appealDetail });
  }

  commitReportAction(
    input: CommitReportActionInput,
  ): Promise<
    | { kind: "committed"; action: TrustSafetyActionProjection }
    | { kind: "version_conflict"; currentCaseVersion: number }
  > {
    this.reportActions.push(input);
    if (input.expectedCaseVersion !== this.reportDetail.item.caseVersion) {
      return Promise.resolve({
        kind: "version_conflict",
        currentCaseVersion: this.reportDetail.item.caseVersion,
      });
    }
    return Promise.resolve({
      kind: "committed",
      action: {
        caseId: this.reportDetail.item.caseId,
        actionId: "40000000-0000-4000-8000-0000000000aa",
        action: input.action,
        reasonCode: input.reasonCode,
        currentCaseStatus: input.action === "ESCALATE" ? "OPEN" : "RESOLVED",
        currentContentStatus: input.nextListing.status,
        currentModerationStatus: input.nextListing.moderationStatus,
        caseVersion: this.reportDetail.item.caseVersion + 1,
        listingVersion: input.nextListing.version,
        occurredAt: input.occurredAt,
      },
    });
  }

  commitAppealAction(input: CommitAppealActionInput): Promise<{
    kind: "committed";
    action: TrustSafetyActionProjection;
  }> {
    this.appealActions.push(input);
    return Promise.resolve({
      kind: "committed",
      action: {
        caseId: this.appealDetail.item.caseId,
        actionId: "40000000-0000-4000-8000-0000000000ab",
        action: input.action,
        reasonCode: input.reasonCode,
        currentCaseStatus: "RESOLVED",
        currentContentStatus: input.nextListing.status,
        currentModerationStatus: input.nextListing.moderationStatus,
        caseVersion: this.appealDetail.item.caseVersion + 1,
        listingVersion: input.nextListing.version,
        occurredAt: input.occurredAt,
      },
    });
  }
}
