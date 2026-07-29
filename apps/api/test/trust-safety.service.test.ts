import { parseApiEnvironment } from "@socal/config";
import type { ListReportCasesInput, ListReportCasesResult } from "@socal/database/trust-safety";
import { describe, expect, it } from "vitest";
import type { PolicyRequestContext } from "../src/common/authorization/policy";
import {
  TrustSafetyAccessDeniedError,
  TrustSafetyCursorError,
  TrustSafetyRateLimitError,
  TrustSafetyService,
} from "../src/modules/trust-safety/trust-safety.service";
import {
  buildAppealDetail,
  memoryAppealId,
  memoryListingId,
  memoryReportId,
  memoryRemovalActionId,
  MemoryTrustSafetyStore,
} from "./support/memory-trust-safety.store";

const environment = parseApiEnvironment({
  NODE_ENV: "test",
  APP_ENV: "test",
  APP_NAME: "socal-api-trust-safety-test",
  PUBLIC_WEB_URL: "https://web.example.invalid",
  PUBLIC_ADMIN_URL: "https://admin.example.invalid",
  DATABASE_URL: "postgresql://example.invalid/socal",
  REDIS_URL: "redis://localhost:6379/0",
  OPENSEARCH_NODE: "https://search.example.invalid",
  SESSION_SECRET: "trust-safety-session-secret-with-more-than-32-bytes",
  OTP_SECRET: "trust-safety-otp-secret-with-more-than-32-bytes",
  MFA_SECRET: "trust-safety-mfa-secret-with-more-than-32-bytes",
  PASSWORD_PEPPER: "trust-safety-password-pepper-with-more-than-32-bytes",
  CSRF_SECRET: "trust-safety-csrf-secret-with-more-than-32-bytes",
});
const actorUserId = "40000000-0000-4000-8000-0000000000b1";

function context(userId = actorUserId): PolicyRequestContext {
  return {
    requestId: "trust-safety-request",
    method: "POST",
    route: "/v1/reports",
    actor: {
      kind: "authenticated",
      userId,
      sessionId: "40000000-0000-4000-8000-0000000000b2",
      accountStatus: "ACTIVE",
      verificationBadges: [],
      permissions: [
        "moderation:report:create",
        "moderation:appeal:create",
        "admin:moderation:read",
        "admin:moderation:act",
      ],
      platformRoles: ["MODERATOR"],
      authenticationStrength: "MFA",
      mfaVerifiedAt: "2026-07-29T09:55:00.000Z",
      recentMfa: true,
      organizations: [],
    },
  };
}

describe("TrustSafetyService public receipts", () => {
  it("returns an opaque report receipt without reporter identity or evidence text", async () => {
    const service = new TrustSafetyService(new MemoryTrustSafetyStore(), environment);
    const response = await service.createReport(
      context(),
      "report-idempotency-key-0001",
      {
        targetType: "LISTING",
        targetId: memoryListingId,
        reasonCode: "SCAM_OR_FRAUD",
        details: "The publisher requested an off-platform deposit.",
      },
      new Date("2026-07-29T10:00:00.000Z"),
    );

    expect(response.data).toMatchObject({
      id: memoryReportId,
      targetType: "LISTING",
      targetId: memoryListingId,
      status: "OPEN",
      deduplicated: false,
    });
    expect(JSON.stringify(response)).not.toContain("reporter");
    expect(JSON.stringify(response)).not.toContain("off-platform");
  });

  it("returns an appeal receipt with an explicit fixed deadline", async () => {
    const service = new TrustSafetyService(new MemoryTrustSafetyStore(), environment);
    const response = await service.createAppeal(
      context(),
      "appeal-idempotency-key-0001",
      {
        moderationActionId: memoryRemovalActionId,
        statement: "The cited claim is supported by the attached public record.",
      },
      new Date("2026-07-29T10:00:00.000Z"),
    );

    expect(response.data).toEqual({
      id: memoryAppealId,
      moderationActionId: memoryRemovalActionId,
      status: "OPEN",
      appealDeadline: "2026-08-28T08:30:00.000Z",
      deduplicated: false,
      submittedAt: "2026-07-29T09:00:00.000Z",
    });
  });

  it("maps the per-user report quota to a rate-limit error", async () => {
    class RateLimitedStore extends MemoryTrustSafetyStore {
      override createReport(): Promise<{ kind: "rate_limited" }> {
        return Promise.resolve({ kind: "rate_limited" });
      }
    }

    const service = new TrustSafetyService(new RateLimitedStore(), environment);
    await expect(
      service.createReport(
        context(),
        "report-idempotency-key-rate-limit",
        {
          targetType: "LISTING",
          targetId: memoryListingId,
          reasonCode: "OTHER",
        },
        new Date("2026-07-29T10:00:00.000Z"),
      ),
    ).rejects.toBeInstanceOf(TrustSafetyRateLimitError);
  });
});

describe("TrustSafetyService moderation actions", () => {
  it("maps a confirmed report to one suspended Listing version", async () => {
    const store = new MemoryTrustSafetyStore();
    const service = new TrustSafetyService(store, environment);
    const response = await service.actOnReport(
      context(),
      memoryReportId,
      1,
      "report-action-key-0001",
      { action: "REMOVE_CONTENT", reasonCode: "CONFIRMED_SCAM" },
      new Date("2026-07-29T10:00:00.000Z"),
    );

    expect(response.data).toMatchObject({
      action: "REMOVE_CONTENT",
      currentCaseStatus: "RESOLVED",
      currentContentStatus: "SUSPENDED",
      currentModerationStatus: "REJECTED",
      listingVersion: 5,
    });
    expect(store.reportActions[0]?.nextListing).toMatchObject({
      status: "SUSPENDED",
      moderationStatus: "REJECTED",
      version: 5,
    });
  });

  it("prevents the original moderator from reviewing the appeal", async () => {
    const store = new MemoryTrustSafetyStore();
    store.appealDetail = buildAppealDetail(actorUserId);
    const service = new TrustSafetyService(store, environment);

    await expect(
      service.actOnAppeal(
        context(),
        memoryAppealId,
        1,
        "appeal-action-key-0001",
        { action: "UPHOLD", reasonCode: "ACTION_CONFIRMED" },
        new Date("2026-07-29T10:00:00.000Z"),
      ),
    ).rejects.toBeInstanceOf(TrustSafetyAccessDeniedError);
    expect(store.appealActions).toHaveLength(0);
  });

  it("allows a different moderator to restore a still-current Listing", async () => {
    const store = new MemoryTrustSafetyStore();
    const service = new TrustSafetyService(store, environment);
    const response = await service.actOnAppeal(
      context(),
      memoryAppealId,
      1,
      "appeal-action-key-0002",
      { action: "RESTORE", reasonCode: "ACTION_OVERTURNED" },
      new Date("2026-07-29T10:00:00.000Z"),
    );

    expect(response.data).toMatchObject({
      action: "RESTORE",
      currentContentStatus: "PUBLISHED",
      currentModerationStatus: "APPROVED",
      listingVersion: 6,
    });
    expect(store.appealActions[0]?.nextListing).toMatchObject({
      status: "PUBLISHED",
      moderationStatus: "APPROVED",
      version: 6,
    });
  });
});

describe("TrustSafetyService queue cursor", () => {
  it("binds the signed cursor to actor, queue and status", async () => {
    class CursorStore extends MemoryTrustSafetyStore {
      readonly inputs: ListReportCasesInput[] = [];

      override listReports(input: ListReportCasesInput): Promise<ListReportCasesResult> {
        this.inputs.push(input);
        return Promise.resolve(
          input.cursor
            ? { kind: "listed", items: [], nextCursor: null }
            : {
                kind: "listed",
                items: [this.reportDetail.item],
                nextCursor: {
                  priority: this.reportDetail.item.priority,
                  createdAt: this.reportDetail.item.createdAt,
                  id: this.reportDetail.item.caseId,
                },
              },
        );
      }
    }
    const store = new CursorStore();
    const service = new TrustSafetyService(store, environment);
    const first = await service.listReports(
      context(),
      { status: "OPEN", limit: 1 },
      new Date("2026-07-29T10:00:00.000Z"),
    );
    if (!first.page.nextCursor) throw new Error("Expected a signed cursor");
    await service.listReports(
      context(),
      { status: "OPEN", limit: 1, cursor: first.page.nextCursor },
      new Date("2026-07-29T10:00:01.000Z"),
    );
    expect(store.inputs[1]?.cursor?.id).toBe(store.reportDetail.item.caseId);
    await expect(
      service.listReports(context(), {
        status: "CLOSED",
        limit: 1,
        cursor: first.page.nextCursor,
      }),
    ).rejects.toBeInstanceOf(TrustSafetyCursorError);
    await expect(
      service.listReports(context("40000000-0000-4000-8000-0000000000b3"), {
        status: "OPEN",
        limit: 1,
        cursor: first.page.nextCursor,
      }),
    ).rejects.toBeInstanceOf(TrustSafetyCursorError);
  });
});
