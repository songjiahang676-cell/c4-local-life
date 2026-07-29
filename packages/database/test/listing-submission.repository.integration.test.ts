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
  categoryId: string;
  listingId: string;
  regionId: string;
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
  return { actorUserId, categoryId, listingId, regionId };
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
    contactFingerprints: [],
    duplicateCandidates: [],
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
      const revision = await transaction.listingRevision.findFirstOrThrow({
        where: { listingId: fixture.listingId },
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
      expect(revision).toMatchObject({
        revisionNumber: 1,
        baseListingVersion: 1,
        resultListingVersion: 3,
        classification: "SUBMISSION",
        reasonCodes: ["INITIAL_SUBMISSION"],
        riskTier: ModerationRiskTier.LOW,
      });
      expect(revision.snapshotHash).toMatch(/^[0-9a-f]{64}$/);
      expect(revision.diff).toEqual(
        expect.arrayContaining([expect.objectContaining({ field: "title", kind: "ADDED" })]),
      );
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
      await transaction.$executeRawUnsafe(`
        DO $$
        BEGIN
          BEGIN
            DELETE FROM "listing_revisions"
            WHERE "id" = '${revision.id}'::uuid;
            RAISE EXCEPTION 'immutability trigger did not reject deletion';
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

      await transaction.listing.update({
        where: { id: fixture.listingId },
        data: {
          status: ContentStatus.DRAFT,
          moderationStatus: ModerationStatus.REJECTED,
          title: "Synthetic corrected resubmission listing",
          version: 5,
          updatedAt: new Date(occurredAt.getTime() + 2_000),
        },
      });
      const resubmittedAt = new Date(occurredAt.getTime() + 3_000);
      const resubmitted = await repository.submit({
        ...lowRiskInput(fixture),
        expectedVersion: 5,
        idempotencyKey: "repository-submit-resubmission-0001",
        requestHash: "e".repeat(64),
        occurredAt: resubmittedAt,
        inputHash: "f".repeat(64),
        decision: {
          contentStatus: ContentStatus.PUBLISHED,
          moderationStatus: ModerationStatus.AUTO_APPROVED,
          publishedAt: resubmittedAt,
          expiresAt: new Date(resubmittedAt.getTime() + 30 * 86_400_000),
          resultVersion: 7,
          transitions: [
            {
              eventType: "listing.submitted",
              previousStatus: ContentStatus.DRAFT,
              currentStatus: ContentStatus.SUBMITTED,
              previousModerationStatus: ModerationStatus.REJECTED,
              currentModerationStatus: ModerationStatus.PENDING_REVIEW,
              aggregateVersion: 6,
              reasonCode: "RISK_EVALUATED",
            },
            {
              eventType: "listing.published",
              previousStatus: ContentStatus.SUBMITTED,
              currentStatus: ContentStatus.PUBLISHED,
              previousModerationStatus: ModerationStatus.PENDING_REVIEW,
              currentModerationStatus: ModerationStatus.AUTO_APPROVED,
              aggregateVersion: 7,
              reasonCode: "LOW_RISK_AUTO_APPROVED",
            },
          ],
        },
      });
      expect(resubmitted).toMatchObject({
        kind: "submitted",
        submission: {
          previousModerationStatus: ModerationStatus.REJECTED,
          currentStatus: ContentStatus.PUBLISHED,
          version: 7,
        },
      });
      const revisions = await transaction.listingRevision.findMany({
        where: { listingId: fixture.listingId },
        orderBy: { revisionNumber: "asc" },
      });
      expect(revisions).toHaveLength(2);
      expect(revisions[1]).toMatchObject({
        revisionNumber: 2,
        classification: "SUBMISSION",
        reasonCodes: ["RESUBMISSION"],
        baseListingVersion: 5,
        resultListingVersion: 7,
      });
      expect(revisions[1]?.diff).toEqual(
        expect.arrayContaining([expect.objectContaining({ field: "title", kind: "CHANGED" })]),
      );
    });
  });

  it("finds bounded text/contact candidates and stores versioned duplicate evidence", async () => {
    await database.withRollback(async (transaction) => {
      const fixture = await createFixture(transaction);
      const candidateListingId = randomUUID();
      const contactFingerprint = "9".repeat(64);
      await transaction.listing.create({
        data: {
          id: candidateListingId,
          type: ListingType.RENTAL,
          ownerId: fixture.actorUserId,
          categoryId: fixture.categoryId,
          regionId: fixture.regionId,
          status: ContentStatus.PUBLISHED,
          moderationStatus: ModerationStatus.AUTO_APPROVED,
          locale: "zh-Hans",
          title: "Synthetic submission integration listing",
          slug: `duplicate-candidate-${candidateListingId}`,
          body: "Synthetic repository content, never a real advertisement.",
          publishedAt: new Date("2026-07-19T00:00:00.000Z"),
          expiresAt: new Date("2026-08-19T00:00:00.000Z"),
          createdAt: new Date("2026-07-19T00:00:00.000Z"),
          updatedAt: new Date("2026-07-19T00:00:00.000Z"),
          contactFingerprints: {
            create: { fingerprint: contactFingerprint },
          },
        },
      });
      const repository = new ListingSubmissionRepository(transaction);
      const matches = await repository.findDuplicateCandidates({
        listingId: fixture.listingId,
        listingType: ListingType.RENTAL,
        title: "Synthetic submission integration listing",
        body: "Synthetic repository content, never a real advertisement.",
        contactFingerprints: [contactFingerprint],
        mediaPerceptualHashes: [],
        occurredAt,
        lookbackDays: 365,
        titleCandidateThreshold: 0.62,
        bodyCandidateThreshold: 0.72,
        imageCandidateDistance: 10,
        limit: 10,
      });
      const distance = await transaction.$queryRaw<Array<{ distance: number }>>`
        SELECT socal_hamming_distance_hex64(
          '0000000000000000',
          '0000000000000003'
        ) AS "distance"
      `;

      expect(matches).toEqual([
        expect.objectContaining({
          listingId: candidateListingId,
          titleScore: 1,
          bodyScore: 1,
          contactMatchCount: 1,
        }),
      ]);
      expect(distance).toEqual([{ distance: 2 }]);
      await expect(
        repository.findDuplicateCandidates({
          listingId: fixture.listingId,
          listingType: ListingType.RENTAL,
          title: "Synthetic bounded candidate",
          body: "Synthetic bounded candidate body.",
          contactFingerprints: Array.from({ length: 21 }, (_, index) =>
            index.toString(16).padStart(64, "0"),
          ),
          mediaPerceptualHashes: [],
          occurredAt,
          lookbackDays: 365,
          titleCandidateThreshold: 0.62,
          bodyCandidateThreshold: 0.72,
          imageCandidateDistance: 10,
          limit: 10,
        }),
      ).rejects.toThrow("outside its bounded policy");
      await expect(
        repository.findDuplicateCandidates({
          listingId: fixture.listingId,
          listingType: ListingType.RENTAL,
          title: "Synthetic malformed hash candidate",
          body: "Synthetic malformed hash candidate body.",
          contactFingerprints: [],
          mediaPerceptualHashes: ["not-a-perceptual-hash"],
          occurredAt,
          lookbackDays: 365,
          titleCandidateThreshold: 0.62,
          bodyCandidateThreshold: 0.72,
          imageCandidateDistance: 10,
          limit: 10,
        }),
      ).rejects.toThrow("outside its bounded policy");

      const base = lowRiskInput(fixture);
      const submitted = await repository.submit({
        ...base,
        idempotencyKey: "repository-submit-duplicate-0001",
        riskTier: ModerationRiskTier.MEDIUM,
        hits: [
          {
            ruleCode: "POSSIBLE_DUPLICATE",
            ruleVersion: 1,
            severity: ModerationRiskTier.MEDIUM,
            evidenceKey: "duplicate_candidates",
          },
        ],
        contactFingerprints: [contactFingerprint],
        duplicateCandidates: [
          {
            candidateListingId,
            candidateListingVersion: matches[0]!.listingVersion,
            candidateType: ListingType.RENTAL,
            candidateTitle: matches[0]!.title,
            candidateStatus: matches[0]!.status,
            thresholdVersion: 1,
            mode: "ENFORCE",
            confidence: "HIGH",
            matchedSignals: ["TEXT", "CONTACT"],
            titleScore: matches[0]!.titleScore,
            bodyScore: matches[0]!.bodyScore,
            imageDistance: null,
            contactMatchCount: 1,
          },
        ],
        decision: {
          contentStatus: ContentStatus.SUBMITTED,
          moderationStatus: ModerationStatus.PENDING_REVIEW,
          publishedAt: null,
          expiresAt: null,
          resultVersion: 2,
          transitions: [base.decision.transitions[0]!],
        },
      });
      const evidence = await transaction.moderationDuplicateCandidate.findFirstOrThrow({
        where: { evaluation: { listingId: fixture.listingId } },
      });

      expect(submitted).toMatchObject({
        kind: "submitted",
        submission: {
          currentStatus: ContentStatus.SUBMITTED,
          currentModerationStatus: ModerationStatus.PENDING_REVIEW,
          riskTier: ModerationRiskTier.MEDIUM,
        },
      });
      expect(evidence).toMatchObject({
        candidateListingId,
        thresholdVersion: 1,
        mode: "ENFORCE",
        confidence: "HIGH",
        matchedSignals: ["TEXT", "CONTACT"],
        reviewOutcome: "UNREVIEWED",
      });
      await expect(
        transaction.listingContactFingerprint.findMany({
          where: { listingId: fixture.listingId },
          select: { fingerprint: true },
        }),
      ).resolves.toEqual([{ fingerprint: contactFingerprint }]);
      expect(JSON.stringify(evidence)).not.toContain("example.invalid");
    });
  });
});
