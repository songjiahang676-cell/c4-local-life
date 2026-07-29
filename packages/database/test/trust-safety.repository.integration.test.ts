import { randomUUID } from "node:crypto";
import {
  AuthenticationStrength,
  ContentStatus,
  ListingType,
  ModerationStatus,
  PlatformRole,
  RegionType,
  UserStatus,
} from "../generated/prisma/client";
import { NotificationRepository } from "../src/repositories/notification.repository";
import { TrustSafetyRepository } from "../src/repositories/trust-safety.repository";
import {
  createIntegrationDatabase,
  type IntegrationDatabase,
} from "../src/testing/integration-database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const databaseUrl = process.env.DATABASE_INTEGRATION_URL ?? "";
const integration = describe.skipIf(databaseUrl.length === 0);
const now = new Date("2026-07-29T10:00:00.000Z");

type Fixture = {
  categoryId: string;
  listingId: string;
  moderatorOneId: string;
  moderatorOneSessionId: string;
  moderatorTwoId: string;
  moderatorTwoSessionId: string;
  ownerId: string;
  ownerSessionId: string;
  regionId: string;
  reporterId: string;
  reporterSessionId: string;
  userIds: string[];
};

async function createFixture(database: IntegrationDatabase): Promise<Fixture> {
  const fixture: Fixture = {
    categoryId: randomUUID(),
    listingId: randomUUID(),
    moderatorOneId: randomUUID(),
    moderatorOneSessionId: randomUUID(),
    moderatorTwoId: randomUUID(),
    moderatorTwoSessionId: randomUUID(),
    ownerId: randomUUID(),
    ownerSessionId: randomUUID(),
    regionId: randomUUID(),
    reporterId: randomUUID(),
    reporterSessionId: randomUUID(),
    userIds: [],
  };
  fixture.userIds = [
    fixture.ownerId,
    fixture.reporterId,
    fixture.moderatorOneId,
    fixture.moderatorTwoId,
  ];
  await database.client.$transaction(async (transaction) => {
    await transaction.user.createMany({
      data: fixture.userIds.map((id) => ({
        id,
        email: `${id}@example.invalid`,
        status: UserStatus.ACTIVE,
        createdAt: new Date("2025-01-01T00:00:00.000Z"),
      })),
    });
    await transaction.userProfile.createMany({
      data: [
        {
          userId: fixture.ownerId,
          displayName: "Synthetic Reported Owner",
          preferredLocale: "en-US",
        },
        {
          userId: fixture.reporterId,
          displayName: "Synthetic Reporter",
          preferredLocale: "zh-Hans",
        },
        {
          userId: fixture.moderatorOneId,
          displayName: "Synthetic Moderator One",
          preferredLocale: "en-US",
        },
        {
          userId: fixture.moderatorTwoId,
          displayName: "Synthetic Moderator Two",
          preferredLocale: "en-US",
        },
      ],
    });
    await transaction.platformRoleAssignment.createMany({
      data: [
        {
          userId: fixture.moderatorOneId,
          role: PlatformRole.MODERATOR,
          reasonCode: "INTEGRATION_TEST",
          grantedAt: new Date("2026-07-29T09:00:00.000Z"),
        },
        {
          userId: fixture.moderatorTwoId,
          role: PlatformRole.SENIOR_MODERATOR,
          reasonCode: "INTEGRATION_TEST",
          grantedAt: new Date("2026-07-29T09:00:00.000Z"),
        },
      ],
    });
    await transaction.authSession.createMany({
      data: [
        {
          id: fixture.ownerSessionId,
          userId: fixture.ownerId,
          tokenHash: `owner-${fixture.ownerSessionId}`,
          expiresAt: new Date("2026-07-29T12:00:00.000Z"),
          idleExpiresAt: new Date("2026-07-29T12:00:00.000Z"),
          lastSeenAt: new Date("2026-07-29T09:55:00.000Z"),
        },
        {
          id: fixture.reporterSessionId,
          userId: fixture.reporterId,
          tokenHash: `reporter-${fixture.reporterSessionId}`,
          expiresAt: new Date("2026-07-29T12:00:00.000Z"),
          idleExpiresAt: new Date("2026-07-29T12:00:00.000Z"),
          lastSeenAt: new Date("2026-07-29T09:55:00.000Z"),
        },
        ...[
          [fixture.moderatorOneId, fixture.moderatorOneSessionId],
          [fixture.moderatorTwoId, fixture.moderatorTwoSessionId],
        ].map(([userId, id]) => ({
          id: id as string,
          userId: userId as string,
          tokenHash: `moderator-${id}`,
          authenticationStrength: AuthenticationStrength.MFA,
          mfaVerifiedAt: new Date("2026-07-29T09:55:00.000Z"),
          expiresAt: new Date("2026-07-29T12:00:00.000Z"),
          idleExpiresAt: new Date("2026-07-29T12:00:00.000Z"),
          lastSeenAt: new Date("2026-07-29T09:55:00.000Z"),
        })),
      ],
    });
    await transaction.region.create({
      data: {
        id: fixture.regionId,
        code: `TEST-REPORT-${fixture.regionId}`,
        type: RegionType.CITY,
        slug: `report-region-${fixture.regionId}`,
        nameZhHans: "举报测试城市",
        nameEn: "Synthetic Report City",
      },
    });
    await transaction.category.create({
      data: {
        id: fixture.categoryId,
        vertical: ListingType.JOB,
        slug: `report-category-${fixture.categoryId}`,
        nameZhHans: "举报测试招聘",
        nameEn: "Synthetic Report Jobs",
        formSchemaVersions: {
          create: {
            version: 1,
            definition: {
              categoryId: fixture.categoryId,
              version: 1,
              fields: [
                { key: "employmentType", type: "SELECT", visibility: "PUBLIC" },
                { key: "contactEmail", type: "EMAIL", visibility: "OWNER_ONLY" },
                { key: "exactAddress", type: "TEXT", visibility: "OWNER_ONLY" },
              ],
              publicationPolicy: { defaultLifetimeDays: 30 },
            },
            contentHash: "a".repeat(64),
            publishedAt: new Date("2026-07-29T09:00:00.000Z"),
          },
        },
      },
    });
    await transaction.listing.create({
      data: {
        id: fixture.listingId,
        type: ListingType.JOB,
        ownerId: fixture.ownerId,
        categoryId: fixture.categoryId,
        regionId: fixture.regionId,
        status: ContentStatus.PUBLISHED,
        moderationStatus: ModerationStatus.APPROVED,
        locale: "en-US",
        title: "Synthetic reportable job listing",
        slug: `report-listing-${fixture.listingId}`,
        summary: "Synthetic report integration summary",
        body: "Synthetic report integration body; never a real job advertisement.",
        contactMode: "EMAIL_REVEAL",
        attributes: {
          employmentType: "FULL_TIME",
          contactEmail: "private-owner@example.invalid",
          exactAddress: "Private exact address",
        },
        locationPrecision: "EXACT",
        publishedAt: new Date("2026-07-29T09:00:00.000Z"),
        expiresAt: new Date("2026-07-29T13:00:00.000Z"),
        createdAt: new Date("2026-07-28T09:00:00.000Z"),
        updatedAt: new Date("2026-07-29T09:00:00.000Z"),
        version: 4,
        jobDetail: {
          create: {
            employerName: "Synthetic Employer",
            employmentType: "FULL_TIME",
          },
        },
      },
    });
  });
  return fixture;
}

async function removeFixture(database: IntegrationDatabase, fixture: Fixture): Promise<void> {
  await database.client.$transaction(async (transaction) => {
    await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = replica");
    await transaction.notification.deleteMany({ where: { userId: { in: fixture.userIds } } });
    await transaction.outboxEvent.deleteMany({ where: { aggregateId: fixture.listingId } });
    await transaction.auditLog.deleteMany({
      where: { actorId: { in: fixture.userIds } },
    });
    await transaction.moderationCaseSnapshot.deleteMany({
      where: { moderationCase: { targetId: fixture.listingId } },
    });
    await transaction.moderationAction.deleteMany({
      where: {
        moderationCase: { targetId: fixture.listingId, queue: "listing-appeal" },
      },
    });
    await transaction.moderationCase.deleteMany({
      where: { targetId: fixture.listingId, queue: "listing-appeal" },
    });
    await transaction.moderationAppeal.deleteMany({
      where: { appellantId: fixture.ownerId },
    });
    await transaction.moderationAction.deleteMany({
      where: { moderationCase: { targetId: fixture.listingId } },
    });
    await transaction.moderationCase.deleteMany({
      where: { targetId: fixture.listingId },
    });
    await transaction.report.deleteMany({ where: { reporterId: fixture.reporterId } });
    await transaction.listing.deleteMany({ where: { id: fixture.listingId } });
    await transaction.categoryFormSchemaVersion.deleteMany({
      where: { categoryId: fixture.categoryId },
    });
    await transaction.category.deleteMany({ where: { id: fixture.categoryId } });
    await transaction.region.deleteMany({ where: { id: fixture.regionId } });
    await transaction.authSession.deleteMany({ where: { userId: { in: fixture.userIds } } });
    await transaction.platformRoleAssignment.deleteMany({
      where: { userId: { in: fixture.userIds } },
    });
    await transaction.userProfile.deleteMany({ where: { userId: { in: fixture.userIds } } });
    await transaction.user.deleteMany({ where: { id: { in: fixture.userIds } } });
  });
}

integration("TrustSafetyRepository with PostgreSQL", () => {
  let database: IntegrationDatabase;
  let fixture: Fixture;

  beforeAll(async () => {
    database = createIntegrationDatabase(databaseUrl);
    fixture = await createFixture(database);
  });

  afterAll(async () => {
    if (database && fixture) await removeFixture(database, fixture);
    await database?.close();
  });

  it("deduplicates concurrent reports and stores one immutable redacted snapshot", async () => {
    const first = new TrustSafetyRepository({
      connectionString: databaseUrl,
      poolMaximum: 2,
    });
    const second = new TrustSafetyRepository({
      connectionString: databaseUrl,
      poolMaximum: 2,
    });
    try {
      const results = await Promise.all([
        first.createReport({
          actorUserId: fixture.reporterId,
          sessionId: fixture.reporterSessionId,
          targetId: fixture.listingId,
          reasonCode: "SCAM_OR_FRAUD",
          details: "The listing asks applicants to pay an off-platform fee.",
          idempotencyKey: "report-concurrent-key-0001",
          requestHash: "b".repeat(64),
          requestId: randomUUID(),
          occurredAt: now,
        }),
        second.createReport({
          actorUserId: fixture.reporterId,
          sessionId: fixture.reporterSessionId,
          targetId: fixture.listingId,
          reasonCode: "MISLEADING_INFORMATION",
          details: "The listing contains materially inconsistent employer claims.",
          idempotencyKey: "report-concurrent-key-0002",
          requestHash: "c".repeat(64),
          requestId: randomUUID(),
          occurredAt: now,
        }),
      ]);
      expect(results.map((result) => result.kind).sort()).toEqual(["created", "deduplicated"]);
      const reports = await database.client.report.findMany({
        where: { reporterId: fixture.reporterId, targetId: fixture.listingId },
        include: {
          moderationCase: {
            include: { snapshot: true },
          },
        },
      });
      expect(reports).toHaveLength(1);
      const serialized = JSON.stringify(reports[0]?.moderationCase?.snapshot?.snapshot);
      expect(serialized).toContain("employmentType");
      expect(serialized).not.toContain("private-owner@example.invalid");
      expect(serialized).not.toContain("Private exact address");
      expect(reports[0]?.moderationCase?.snapshot?.snapshotHash).toMatch(/^[0-9a-f]{64}$/);
      const reportId = results.find((result) => "receipt" in result)?.receipt.id ?? "";
      const detail = await first.getReport({
        actorUserId: fixture.moderatorOneId,
        sessionId: fixture.moderatorOneSessionId,
        reportId,
        now,
      });
      expect(detail.kind).toBe("found");
      expect(JSON.stringify(detail)).not.toContain(fixture.reporterId);
      expect(JSON.stringify(detail)).not.toContain(`${fixture.reporterId}@example.invalid`);
    } finally {
      await first.close();
      await second.close();
    }
  });

  it("atomically removes, independently appeals, restores, audits, and notifies", async () => {
    const repository = new TrustSafetyRepository({
      connectionString: databaseUrl,
      poolMaximum: 3,
    });
    const notificationRepository = new NotificationRepository({
      connectionString: databaseUrl,
      poolMaximum: 2,
    });
    try {
      const report = await database.client.report.findFirstOrThrow({
        where: { reporterId: fixture.reporterId, targetId: fixture.listingId },
        include: { moderationCase: true },
      });
      const removedAt = new Date("2026-07-29T10:05:00.000Z");
      const removal = await repository.commitReportAction({
        actorUserId: fixture.moderatorOneId,
        sessionId: fixture.moderatorOneSessionId,
        recentMfaAfter: new Date("2026-07-29T09:50:00.000Z"),
        reportId: report.id,
        expectedCaseVersion: report.moderationCase?.version ?? 0,
        expectedListingVersion: 4,
        action: "REMOVE_CONTENT",
        reasonCode: "CONFIRMED_SCAM",
        idempotencyKey: "report-remove-key-0001",
        requestHash: "d".repeat(64),
        requestId: randomUUID(),
        occurredAt: removedAt,
        nextListing: {
          status: ContentStatus.SUSPENDED,
          moderationStatus: ModerationStatus.REJECTED,
          publishedAt: new Date("2026-07-29T09:00:00.000Z"),
          expiresAt: new Date("2026-07-29T13:00:00.000Z"),
          version: 5,
        },
      });
      expect(removal).toMatchObject({
        kind: "committed",
        action: {
          action: "REMOVE_CONTENT",
          currentContentStatus: "SUSPENDED",
          listingVersion: 5,
        },
      });
      if (!("action" in removal)) throw new Error("Expected removal action");
      const appeal = await repository.createAppeal({
        actorUserId: fixture.ownerId,
        sessionId: fixture.ownerSessionId,
        moderationActionId: removal.action.actionId,
        statement: "The requested fee is a disclosed licensing cost, not an applicant payment.",
        idempotencyKey: "listing-appeal-key-0001",
        requestHash: "e".repeat(64),
        requestId: randomUUID(),
        occurredAt: new Date("2026-07-29T10:10:00.000Z"),
      });
      expect(appeal.kind).toBe("created");
      if (!("receipt" in appeal)) throw new Error("Expected appeal receipt");

      const sameReviewer = await repository.commitAppealAction({
        actorUserId: fixture.moderatorOneId,
        sessionId: fixture.moderatorOneSessionId,
        recentMfaAfter: new Date("2026-07-29T09:50:00.000Z"),
        appealId: appeal.receipt.id,
        expectedCaseVersion: 1,
        expectedListingVersion: 5,
        action: "UPHOLD",
        reasonCode: "ACTION_CONFIRMED",
        idempotencyKey: "appeal-same-reviewer-0001",
        requestHash: "f".repeat(64),
        requestId: randomUUID(),
        occurredAt: new Date("2026-07-29T10:15:00.000Z"),
        nextListing: {
          status: ContentStatus.SUSPENDED,
          moderationStatus: ModerationStatus.REJECTED,
          publishedAt: new Date("2026-07-29T09:00:00.000Z"),
          expiresAt: new Date("2026-07-29T13:00:00.000Z"),
          version: 5,
        },
      });
      expect(sameReviewer.kind).toBe("same_reviewer");

      const restoredAt = new Date("2026-07-29T10:20:00.000Z");
      const restored = await repository.commitAppealAction({
        actorUserId: fixture.moderatorTwoId,
        sessionId: fixture.moderatorTwoSessionId,
        recentMfaAfter: new Date("2026-07-29T09:50:00.000Z"),
        appealId: appeal.receipt.id,
        expectedCaseVersion: 1,
        expectedListingVersion: 5,
        action: "RESTORE",
        reasonCode: "ACTION_OVERTURNED",
        idempotencyKey: "appeal-restore-key-0001",
        requestHash: "1".repeat(64),
        requestId: randomUUID(),
        occurredAt: restoredAt,
        nextListing: {
          status: ContentStatus.PUBLISHED,
          moderationStatus: ModerationStatus.APPROVED,
          publishedAt: new Date("2026-07-29T09:00:00.000Z"),
          expiresAt: new Date("2026-07-29T13:00:00.000Z"),
          version: 6,
        },
      });
      expect(restored).toMatchObject({
        kind: "committed",
        action: {
          action: "RESTORE",
          currentContentStatus: "PUBLISHED",
          listingVersion: 6,
        },
      });
      if (report.reasonCode !== "SCAM_OR_FRAUD" && report.reasonCode !== "MISLEADING_INFORMATION") {
        throw new Error("Unexpected fixture report reason");
      }
      const reportRetry = await repository.createReport({
        actorUserId: fixture.reporterId,
        sessionId: fixture.reporterSessionId,
        targetId: fixture.listingId,
        reasonCode: report.reasonCode,
        details: report.details ?? undefined,
        idempotencyKey: report.idempotencyKey,
        requestHash: report.requestHash,
        requestId: randomUUID(),
        occurredAt: new Date("2026-07-29T10:25:00.000Z"),
      });
      expect(reportRetry).toMatchObject({
        kind: "exact_retry",
        receipt: { id: report.id, status: "OPEN" },
      });
      const appealRetry = await repository.createAppeal({
        actorUserId: fixture.ownerId,
        sessionId: fixture.ownerSessionId,
        moderationActionId: removal.action.actionId,
        statement: "The requested fee is a disclosed licensing cost, not an applicant payment.",
        idempotencyKey: "listing-appeal-key-0001",
        requestHash: "e".repeat(64),
        requestId: randomUUID(),
        occurredAt: new Date("2026-07-29T10:25:00.000Z"),
      });
      expect(appealRetry).toMatchObject({
        kind: "exact_retry",
        receipt: { id: appeal.receipt.id, status: "OPEN" },
      });

      const events = await database.client.outboxEvent.findMany({
        where: {
          aggregateId: fixture.listingId,
          eventType: {
            in: ["listing.moderation.removed", "listing.appeal.restored"],
          },
        },
        orderBy: { createdAt: "asc" },
      });
      expect(events.map((event) => event.eventType)).toEqual([
        "listing.moderation.removed",
        "listing.appeal.restored",
      ]);
      for (const event of events) {
        const payload = event.payload as { aggregateVersion: number };
        const result = await notificationRepository.consumeListingEvent({
          eventId: event.id,
          eventType: event.eventType as "listing.moderation.removed" | "listing.appeal.restored",
          listingId: fixture.listingId,
          aggregateVersion: payload.aggregateVersion,
          occurredAt: event.createdAt,
        });
        expect(result.kind).toBe("created");
      }
      const notifications = await database.client.notification.findMany({
        where: { userId: fixture.ownerId },
        orderBy: { createdAt: "asc" },
      });
      expect(notifications.map((item) => item.templateKey)).toEqual([
        "listing.status.removed",
        "listing.status.appeal_restored",
      ]);
      expect(notifications.every((item) => item.templateVersion === 1)).toBe(true);
      expect(JSON.stringify(notifications)).not.toContain(fixture.reporterId);
      expect(
        await database.client.auditLog.count({
          where: {
            actorId: {
              in: [
                fixture.reporterId,
                fixture.ownerId,
                fixture.moderatorOneId,
                fixture.moderatorTwoId,
              ],
            },
            targetId: {
              in: [report.id, appeal.receipt.id],
            },
          },
        }),
      ).toBe(4);
    } finally {
      await repository.close();
      await notificationRepository.close();
    }
  });

  it("enforces the hourly report quota without exposing target existence", async () => {
    await database.client.report.createMany({
      data: Array.from({ length: 10 }, (_, index) => ({
        id: randomUUID(),
        reporterId: fixture.reporterId,
        targetType: "LISTING",
        targetId: randomUUID(),
        reasonCode: "OTHER",
        idempotencyKey: `report-quota-seed-${String(index).padStart(2, "0")}`,
        requestHash: `${index.toString(16)}${"a".repeat(63)}`,
        createdAt: new Date(now.getTime() - (index + 1) * 60_000),
        updatedAt: new Date(now.getTime() - (index + 1) * 60_000),
      })),
    });
    const repository = new TrustSafetyRepository({ connectionString: databaseUrl });
    try {
      const result = await repository.createReport({
        actorUserId: fixture.reporterId,
        sessionId: fixture.reporterSessionId,
        targetId: fixture.listingId,
        reasonCode: "OTHER",
        details: undefined,
        idempotencyKey: "report-quota-overflow",
        requestHash: "f".repeat(64),
        occurredAt: now,
        requestId: "trust-safety-quota-request",
      });
      expect(result).toEqual({ kind: "rate_limited" });
    } finally {
      await repository.close();
    }
  });
});
