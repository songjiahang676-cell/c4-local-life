import { randomUUID } from "node:crypto";
import {
  ContentStatus,
  ListingType,
  ModerationRiskTier,
  ModerationStatus,
  RegionType,
  UserStatus,
  type Prisma,
} from "../generated/prisma/client";
import {
  ListingSubmissionRepository,
  type SubmitListingInput,
} from "../src/repositories/listing-submission.repository";
import {
  createIntegrationDatabase,
  type IntegrationDatabase,
} from "../src/testing/integration-database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const databaseUrl = process.env.DATABASE_INTEGRATION_URL ?? "";
const integration = describe.skipIf(databaseUrl.length === 0);
const occurredAt = new Date("2026-07-29T20:00:00.000Z");

async function createFixture(transaction: Prisma.TransactionClient): Promise<{
  actorUserId: string;
  listingId: string;
}> {
  const actorUserId = randomUUID();
  const categoryId = randomUUID();
  const listingId = randomUUID();
  const regionId = randomUUID();
  await transaction.user.create({
    data: {
      id: actorUserId,
      email: `${actorUserId}@example.invalid`,
      status: UserStatus.ACTIVE,
      createdAt: new Date("2025-01-01T00:00:00.000Z"),
      profile: { create: { displayName: "Synthetic Submission Owner" } },
    },
  });
  await transaction.region.create({
    data: {
      id: regionId,
      code: `TEST-SUBMISSION-${regionId}`,
      type: RegionType.CITY,
      slug: `submission-region-${regionId}`,
      nameZhHans: "测试提交城市",
      nameEn: "Synthetic Submission City",
    },
  });
  await transaction.category.create({
    data: {
      id: categoryId,
      vertical: ListingType.RENTAL,
      slug: `submission-category-${categoryId}`,
      nameZhHans: "测试提交分类",
      nameEn: "Synthetic Submission Rentals",
      formSchemaVersions: {
        create: {
          version: 1,
          definition: {
            categoryId,
            version: 1,
            fields: [],
            publicationPolicy: {
              defaultLifetimeDays: 30,
              manualReviewRequired: false,
            },
          },
          contentHash: "a".repeat(64),
          publishedAt: occurredAt,
        },
      },
    },
  });
  await transaction.listing.create({
    data: {
      id: listingId,
      type: ListingType.RENTAL,
      ownerId: actorUserId,
      categoryId,
      regionId,
      status: ContentStatus.DRAFT,
      moderationStatus: ModerationStatus.NOT_REVIEWED,
      locale: "zh-Hans",
      title: "Synthetic submission integration listing",
      slug: `submission-listing-${listingId}`,
      body: "Synthetic repository content, never a real advertisement.",
      createdAt: new Date("2026-07-20T00:00:00.000Z"),
      updatedAt: new Date("2026-07-20T00:00:00.000Z"),
    },
  });
  return { actorUserId, listingId };
}

function lowRiskInput(fixture: { actorUserId: string; listingId: string }): SubmitListingInput {
  return {
    ...fixture,
    expectedVersion: 1,
    idempotencyKey: "repository-submit-0001",
    requestHash: "b".repeat(64),
    requestId: randomUUID(),
    occurredAt,
    inputHash: "c".repeat(64),
    ruleSetKey: "listing-submission",
    ruleSetVersion: 1,
    riskTier: ModerationRiskTier.LOW,
    hits: [],
    decision: {
      contentStatus: ContentStatus.PUBLISHED,
      moderationStatus: ModerationStatus.AUTO_APPROVED,
      publishedAt: occurredAt,
      expiresAt: new Date("2026-08-28T20:00:00.000Z"),
      resultVersion: 3,
      transitions: [
        {
          eventType: "listing.submitted",
          previousStatus: ContentStatus.DRAFT,
          currentStatus: ContentStatus.SUBMITTED,
          previousModerationStatus: ModerationStatus.NOT_REVIEWED,
          currentModerationStatus: ModerationStatus.PENDING_REVIEW,
          aggregateVersion: 2,
          reasonCode: "RISK_EVALUATED",
        },
        {
          eventType: "listing.published",
          previousStatus: ContentStatus.SUBMITTED,
          currentStatus: ContentStatus.PUBLISHED,
          previousModerationStatus: ModerationStatus.PENDING_REVIEW,
          currentModerationStatus: ModerationStatus.AUTO_APPROVED,
          aggregateVersion: 3,
          reasonCode: "LOW_RISK_AUTO_APPROVED",
        },
      ],
    },
  };
}

integration("ListingSubmissionRepository with PostgreSQL", () => {
  let database: IntegrationDatabase;

  beforeAll(() => {
    database = createIntegrationDatabase(databaseUrl);
  });

  afterAll(async () => {
    await database?.close();
  });

  it("commits one immutable, auditable low-risk decision and exact retry", async () => {
    await database.withRollback(async (transaction) => {
      const fixture = await createFixture(transaction);
      const repository = new ListingSubmissionRepository(transaction);
      const candidate = await repository.findCandidate(fixture);
      const input = lowRiskInput(fixture);
      const submitted = await repository.submit(input);
      const retried = await repository.submit(input);
      const conflict = await repository.submit({
        ...input,
        requestHash: "d".repeat(64),
      });
      const listing = await transaction.listing.findUniqueOrThrow({
        where: { id: fixture.listingId },
      });
      const evaluation = await transaction.moderationEvaluation.findFirstOrThrow({
        where: { listingId: fixture.listingId },
        include: { ruleHits: true, moderationCase: true },
      });

      expect(candidate).toMatchObject({
        id: fixture.listingId,
        actorCreatedAt: new Date("2025-01-01T00:00:00.000Z"),
        formSchemaDefinition: {
          publicationPolicy: { defaultLifetimeDays: 30, manualReviewRequired: false },
        },
      });
      expect(submitted).toMatchObject({
        kind: "submitted",
        submission: {
          currentStatus: ContentStatus.PUBLISHED,
          currentModerationStatus: ModerationStatus.AUTO_APPROVED,
          riskTier: ModerationRiskTier.LOW,
          caseId: null,
          version: 3,
        },
      });
      if (submitted.kind !== "submitted") throw new Error("Expected a submitted result");
      expect(retried).toEqual({
        kind: "exact_retry",
        submission: submitted.submission,
      });
      expect(conflict).toEqual({ kind: "idempotency_conflict" });
      expect(listing).toMatchObject({
        status: ContentStatus.PUBLISHED,
        moderationStatus: ModerationStatus.AUTO_APPROVED,
        version: 3,
      });
      expect(evaluation.ruleHits).toEqual([]);
      expect(evaluation.moderationCase).toBeNull();
      expect(
        await transaction.auditLog.count({
          where: { targetId: fixture.listingId, action: "listing.submission.evaluated" },
        }),
      ).toBe(1);
      expect(
        await transaction.outboxEvent.findMany({
          where: { aggregateId: fixture.listingId },
          orderBy: { createdAt: "asc" },
          select: { eventType: true },
        }),
      ).toEqual([{ eventType: "listing.submitted" }, { eventType: "listing.published" }]);
      await transaction.$executeRawUnsafe(`
        DO $$
        BEGIN
          BEGIN
            UPDATE "moderation_evaluations"
            SET "rule_set_version" = 2
            WHERE "id" = '${evaluation.id}'::uuid;
            RAISE EXCEPTION 'immutability trigger did not reject mutation';
          EXCEPTION
            WHEN OTHERS THEN
              IF SQLERRM NOT LIKE '%immutable%' THEN
                RAISE;
              END IF;
          END;
        END
        $$;
      `);
    });
  });

  it("creates a priority case and non-sensitive rule-hit evidence for high risk", async () => {
    await database.withRollback(async (transaction) => {
      const fixture = await createFixture(transaction);
      const repository = new ListingSubmissionRepository(transaction);
      const input = lowRiskInput(fixture);
      const submitted = await repository.submit({
        ...input,
        idempotencyKey: "repository-submit-0002",
        riskTier: ModerationRiskTier.HIGH,
        hits: [
          {
            ruleCode: "EXTERNAL_PAYMENT_REQUEST",
            ruleVersion: 1,
            severity: ModerationRiskTier.HIGH,
            evidenceKey: "body",
          },
        ],
        decision: {
          contentStatus: ContentStatus.SUBMITTED,
          moderationStatus: ModerationStatus.ESCALATED,
          publishedAt: null,
          expiresAt: null,
          resultVersion: 3,
          transitions: [
            input.decision.transitions[0]!,
            {
              eventType: "listing.moderation.escalated",
              previousStatus: ContentStatus.SUBMITTED,
              currentStatus: ContentStatus.SUBMITTED,
              previousModerationStatus: ModerationStatus.PENDING_REVIEW,
              currentModerationStatus: ModerationStatus.ESCALATED,
              aggregateVersion: 3,
              reasonCode: "HIGH_RISK_ESCALATED",
            },
          ],
        },
      });
      const moderationCase = await transaction.moderationCase.findFirstOrThrow({
        where: { targetId: fixture.listingId },
        include: { evaluation: { include: { ruleHits: true } } },
      });

      expect(submitted).toMatchObject({
        kind: "submitted",
        submission: {
          riskTier: ModerationRiskTier.HIGH,
          currentModerationStatus: ModerationStatus.ESCALATED,
          caseId: moderationCase.id,
        },
      });
      expect(moderationCase).toMatchObject({
        queue: "listing-submission",
        priority: 80,
        evaluation: {
          ruleHits: [
            {
              ruleCode: "EXTERNAL_PAYMENT_REQUEST",
              ruleVersion: 1,
              severity: ModerationRiskTier.HIGH,
              evidenceKey: "body",
            },
          ],
        },
      });
      if (!moderationCase.evaluation) throw new Error("Expected linked evaluation");
      expect(JSON.stringify(moderationCase.evaluation.ruleHits)).not.toMatch(
        /gift|bitcoin|phone|email/i,
      );
    });
  });
});
