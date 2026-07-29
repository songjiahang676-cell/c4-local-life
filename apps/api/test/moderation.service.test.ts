import { parseApiEnvironment } from "@socal/config";
import type { ListModerationCasesInput } from "@socal/database/moderation-case";
import { describe, expect, it } from "vitest";
import type { PolicyRequestContext } from "../src/common/authorization/policy";
import { ModerationCursorError, ModerationService } from "../src/modules/admin/moderation.service";
import type { ModerationStore } from "../src/modules/admin/moderation.store";
import {
  buildModerationDetail,
  memoryModerationCaseId,
  MemoryModerationStore,
} from "./support/memory-moderation.store";

const environment = parseApiEnvironment({
  NODE_ENV: "test",
  APP_ENV: "test",
  APP_NAME: "socal-api-moderation-service-test",
  PUBLIC_WEB_URL: "https://web.example.invalid",
  PUBLIC_ADMIN_URL: "https://admin.example.invalid",
  DATABASE_URL: "postgresql://example.invalid/socal",
  REDIS_URL: "redis://localhost:6379/0",
  OPENSEARCH_NODE: "https://search.example.invalid",
  SESSION_SECRET: "moderation-cursor-secret-with-more-than-32-bytes",
  OTP_SECRET: "moderation-otp-secret-with-more-than-32-bytes",
  MFA_SECRET: "moderation-mfa-secret-with-more-than-32-bytes",
  PASSWORD_PEPPER: "moderation-password-pepper-with-more-than-32-bytes",
  CSRF_SECRET: "moderation-csrf-secret-with-more-than-32-bytes",
});
const actorUserId = "40000000-0000-4000-8000-000000000071";

function context(userId = actorUserId): PolicyRequestContext {
  return {
    requestId: "moderation-service-request",
    method: "GET",
    route: "/v1/admin/moderation/cases",
    actor: {
      kind: "authenticated",
      userId,
      sessionId: "40000000-0000-4000-8000-000000000072",
      accountStatus: "ACTIVE",
      verificationBadges: [],
      permissions: ["admin:console:privileged"],
      platformRoles: ["MODERATOR"],
      authenticationStrength: "MFA",
      mfaVerifiedAt: "2026-07-29T02:55:00.000Z",
      recentMfa: true,
      organizations: [],
    },
  };
}

describe("ModerationService cursor boundary", () => {
  it("signs actor/filter-bound cursors and rejects tampering or replay in another scope", async () => {
    const memory = new MemoryModerationStore();
    const inputs: ListModerationCasesInput[] = [];
    const store: ModerationStore = {
      list(input) {
        inputs.push(input);
        const detail = buildModerationDetail();
        return Promise.resolve(
          input.cursor
            ? { kind: "listed", items: [], nextCursor: null }
            : {
                kind: "listed",
                items: [detail.item],
                nextCursor: {
                  priority: detail.item.priority,
                  createdAt: detail.item.createdAt,
                  id: detail.item.id,
                },
              },
        );
      },
      get: memory.get.bind(memory),
      commit: memory.commit.bind(memory),
    };
    const service = new ModerationService(environment, store);
    const query = {
      queue: "listing-submission" as const,
      status: "OPEN" as const,
      riskTier: "HIGH" as const,
      minPriority: 50,
      limit: 1,
    };
    const first = await service.list(context(), query, new Date("2026-07-29T03:00:00.000Z"));
    expect(first.page.hasMore).toBe(true);
    expect(first.page.nextCursor).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    if (!first.page.nextCursor) throw new Error("Expected a signed cursor");

    const second = await service.list(
      context(),
      { ...query, cursor: first.page.nextCursor },
      new Date("2026-07-29T03:00:01.000Z"),
    );
    expect(second.page).toEqual({ hasMore: false, nextCursor: null });
    expect(inputs[1]?.cursor).toMatchObject({
      priority: 80,
      id: buildModerationDetail().item.id,
    });

    const lastCharacter = first.page.nextCursor.at(-1);
    const tampered = `${first.page.nextCursor.slice(0, -1)}${lastCharacter === "a" ? "b" : "a"}`;
    await expect(service.list(context(), { ...query, cursor: tampered })).rejects.toBeInstanceOf(
      ModerationCursorError,
    );
    await expect(
      service.list(context(), { ...query, minPriority: 60, cursor: first.page.nextCursor }),
    ).rejects.toBeInstanceOf(ModerationCursorError);
    await expect(
      service.list(context("40000000-0000-4000-8000-000000000073"), {
        ...query,
        cursor: first.page.nextCursor,
      }),
    ).rejects.toBeInstanceOf(ModerationCursorError);
  });
});

describe("ModerationService action outcomes", () => {
  it.each([
    {
      action: "APPROVE" as const,
      reasonCode: "CONTENT_POLICY_COMPLIANT" as const,
      status: "PUBLISHED",
      moderationStatus: "APPROVED",
      caseStatus: "RESOLVED",
    },
    {
      action: "REQUEST_CHANGES" as const,
      reasonCode: "NEEDS_CLARIFICATION" as const,
      status: "DRAFT",
      moderationStatus: "REJECTED",
      caseStatus: "RESOLVED",
    },
    {
      action: "REJECT" as const,
      reasonCode: "PROHIBITED_CONTENT" as const,
      status: "SUSPENDED",
      moderationStatus: "REJECTED",
      caseStatus: "RESOLVED",
    },
  ])(
    "maps $action to the expected atomic listing and case state",
    async ({ action, reasonCode, status, moderationStatus, caseStatus }) => {
      const store = new MemoryModerationStore();
      const service = new ModerationService(environment, store);

      const response = await service.act(
        context(),
        memoryModerationCaseId,
        1,
        `moderation-${action.toLowerCase()}-key`,
        { action, reasonCode },
        new Date("2026-07-29T03:00:00.000Z"),
      );

      expect(response.data).toMatchObject({
        action,
        currentCaseStatus: caseStatus,
        currentContentStatus: status,
        currentModerationStatus: moderationStatus,
      });
    },
  );

  it("keeps an escalated listing submitted while raising the case priority path", async () => {
    const pending = buildModerationDetail();
    pending.item.riskTier = "MEDIUM";
    pending.item.priority = 50;
    pending.listing.moderationStatus = "PENDING_REVIEW";
    const store = new MemoryModerationStore(pending);
    const service = new ModerationService(environment, store);

    const response = await service.act(
      context(),
      memoryModerationCaseId,
      1,
      "moderation-escalate-key",
      { action: "ESCALATE", reasonCode: "ESCALATE_SENIOR_REVIEW" },
      new Date("2026-07-29T03:00:00.000Z"),
    );

    expect(response.data).toMatchObject({
      action: "ESCALATE",
      currentCaseStatus: "OPEN",
      currentContentStatus: "SUBMITTED",
      currentModerationStatus: "ESCALATED",
    });
    expect(store.commitInputs[0]?.nextListing).toMatchObject({
      status: "SUBMITTED",
      moderationStatus: "ESCALATED",
    });
  });
});
