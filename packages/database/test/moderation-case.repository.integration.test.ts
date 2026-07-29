import { randomUUID } from "node:crypto";
import {
  AuthenticationStrength,
  ContentStatus,
  ListingType,
  ModerationCaseStatus,
  ModerationRiskTier,
  ModerationStatus,
  PlatformRole,
  RegionType,
  UserStatus,
  type Prisma,
} from "../generated/prisma/client";
import {
  ModerationCaseRepository,
  type CommitModerationActionInput,
} from "../src/repositories/moderation-case.repository";
import {
  createIntegrationDatabase,
  type IntegrationDatabase,
} from "../src/testing/integration-database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const databaseUrl = process.env.DATABASE_INTEGRATION_URL ?? "";
const integration = describe.skipIf(databaseUrl.length === 0);
const now = new Date("2026-07-29T03:00:00.000Z");

type Fixture = {
  actorUserId: string;
  actorSessionId: string;
  unauthorizedUserId: string;
  unauthorizedSessionId: string;
  caseId: string;
  candidateListingId: string;
  listingId: string;
  snapshotId: string;
};

async function createFixture(
  transaction: Prisma.TransactionClient,
  options: {
    priority?: number;
    createdAt?: Date;
    title?: string;
    includeDuplicateCandidate?: boolean;
  } = {},
): Promise<Fixture> {
  const actorUserId = randomUUID();
  const unauthorizedUserId = randomUUID();
  const actorSessionId = randomUUID();
  const unauthorizedSessionId = randomUUID();
  const categoryId = randomUUID();
  const regionId = randomUUID();
  const listingId = randomUUID();
  const candidateListingId = randomUUID();
  const evaluationId = randomUUID();
  const caseId = randomUUID();
  const snapshotId = randomUUID();
  const createdAt = options.createdAt ?? new Date("2026-07-29T01:00:00.000Z");
  const title = options.title ?? "Synthetic moderation integration rental";

  await transaction.user.createMany({
    data: [
      {
        id: actorUserId,
        email: `${actorUserId}@example.invalid`,
        status: UserStatus.ACTIVE,
        createdAt: new Date("2025-01-01T00:00:00.000Z"),
      },
      {
        id: unauthorizedUserId,
        email: `${unauthorizedUserId}@example.invalid`,
        status: UserStatus.ACTIVE,
        createdAt: new Date("2025-06-01T00:00:00.000Z"),
      },
    ],
  });
  await transaction.userProfile.createMany({
    data: [
      { userId: actorUserId, displayName: "Synthetic Moderator" },
      { userId: unauthorizedUserId, displayName: "Synthetic Publisher" },
    ],
  });
  await transaction.platformRoleAssignment.create({
    data: {
      userId: actorUserId,
      role: PlatformRole.MODERATOR,
      reasonCode: "INTEGRATION_TEST",
      grantedAt: new Date("2026-07-29T00:00:00.000Z"),
    },
  });
  await transaction.authSession.createMany({
    data: [
      {
        id: actorSessionId,
        userId: actorUserId,
        tokenHash: `actor-${actorSessionId}`,
        authenticationStrength: AuthenticationStrength.MFA,
        mfaVerifiedAt: new Date("2026-07-29T02:55:00.000Z"),
        expiresAt: new Date("2026-07-29T04:00:00.000Z"),
        idleExpiresAt: new Date("2026-07-29T04:00:00.000Z"),
        lastSeenAt: new Date("2026-07-29T02:55:00.000Z"),
      },
      {
        id: unauthorizedSessionId,
        userId: unauthorizedUserId,
        tokenHash: `publisher-${unauthorizedSessionId}`,
        authenticationStrength: AuthenticationStrength.MFA,
        mfaVerifiedAt: new Date("2026-07-29T02:55:00.000Z"),
        expiresAt: new Date("2026-07-29T04:00:00.000Z"),
        idleExpiresAt: new Date("2026-07-29T04:00:00.000Z"),
        lastSeenAt: new Date("2026-07-29T02:55:00.000Z"),
      },
    ],
  });
  await transaction.region.create({
    data: {
      id: regionId,
      code: `TEST-MOD-${regionId}`,
      type: RegionType.CITY,
      slug: `moderation-region-${regionId}`,
      nameZhHans: "审核测试城市",
      nameEn: "Synthetic Moderation City",
    },
  });
  await transaction.category.create({
    data: {
      id: categoryId,
      vertical: ListingType.RENTAL,
      slug: `moderation-category-${categoryId}`,
      nameZhHans: "审核测试出租",
      nameEn: "Synthetic Moderation Rentals",
      formSchemaVersions: {
        create: {
          version: 1,
          definition: {
            categoryId,
            version: 1,
            fields: [],
            publicationPolicy: { defaultLifetimeDays: 30 },
          },
          contentHash: "a".repeat(64),
          publishedAt: createdAt,
        },
      },
    },
  });
  await transaction.listing.create({
    data: {
      id: listingId,
      type: ListingType.RENTAL,
      ownerId: unauthorizedUserId,
      categoryId,
      regionId,
      status: ContentStatus.SUBMITTED,
      moderationStatus: ModerationStatus.ESCALATED,
      locale: "en-US",
      title,
      slug: `moderation-listing-${listingId}`,
      summary: "Synthetic summary",
      body: "Synthetic moderation repository body.",
      priceAmount: "2500.00",
      priceUnit: "MONTHLY",
      contactMode: "PHONE_REVEAL",
      attributes: {
        bedrooms: 2,
        phone: "+15555550100",
        exactAddress: "Must not enter the snapshot",
      },
      latitude: "34.052235",
      longitude: "-118.243683",
      locationPrecision: "EXACT",
      version: 3,
      createdAt: new Date("2026-07-28T01:00:00.000Z"),
      updatedAt: createdAt,
      rentalDetail: {
        create: {
          bedrooms: "2.0",
          bathrooms: "1.0",
          depositAmount: "2500.00",
        },
      },
    },
  });
  await transaction.listing.create({
    data: {
      id: candidateListingId,
      type: ListingType.RENTAL,
      ownerId: unauthorizedUserId,
      categoryId,
      regionId,
      status: ContentStatus.PUBLISHED,
      moderationStatus: ModerationStatus.AUTO_APPROVED,
      locale: "en-US",
      title: "Earlier synthetic moderation rental",
      slug: `moderation-candidate-${candidateListingId}`,
      body: "Earlier synthetic moderation candidate.",
      publishedAt: new Date("2026-07-20T00:00:00.000Z"),
      expiresAt: new Date("2026-08-20T00:00:00.000Z"),
      version: 2,
      createdAt: new Date("2026-07-20T00:00:00.000Z"),
      updatedAt: new Date("2026-07-20T00:00:00.000Z"),
    },
  });
  await transaction.moderationEvaluation.create({
    data: {
      id: evaluationId,
      listingId,
      actorUserId: unauthorizedUserId,
      listingVersion: 1,
      ruleSetKey: "listing-submission",
      ruleSetVersion: 1,
      riskTier: ModerationRiskTier.HIGH,
      inputHash: "b".repeat(64),
      idempotencyKey: `submission-${listingId}`,
      requestHash: "c".repeat(64),
      resultContentStatus: ContentStatus.SUBMITTED,
      resultModerationStatus: ModerationStatus.ESCALATED,
      resultListingVersion: 3,
      occurredAt: createdAt,
      ruleHits: {
        create: {
          ruleCode: "EXTERNAL_PAYMENT_REQUEST",
          ruleVersion: 1,
          severity: ModerationRiskTier.HIGH,
          evidenceKey: "body",
        },
      },
      ...(options.includeDuplicateCandidate === false
        ? {}
        : {
            duplicateCandidates: {
              create: {
                candidateListingId,
                candidateListingVersion: 2,
                candidateType: ListingType.RENTAL,
                candidateTitle: "Earlier synthetic moderation rental",
                candidateStatus: ContentStatus.PUBLISHED,
                thresholdVersion: 1,
                mode: "ENFORCE",
                confidence: "HIGH",
                matchedSignals: ["TEXT", "CONTACT"],
                titleScore: 0.96,
                contactMatchCount: 1,
                createdAt,
              },
            },
          }),
    },
  });
  await transaction.moderationCase.create({
    data: {
      id: caseId,
      evaluationId,
      targetType: "LISTING",
      targetId: listingId,
      queue: "listing-submission",
      priority: options.priority ?? 80,
      status: ModerationCaseStatus.OPEN,
      version: 1,
      createdAt,
      updatedAt: createdAt,
    },
  });
  await transaction.moderationCaseSnapshot.create({
    data: {
      id: snapshotId,
      caseId,
      listingVersion: 3,
      snapshotHash: "d".repeat(64),
      capturedAt: createdAt,
      snapshot: {
        listingId,
        listingVersion: 3,
        type: "RENTAL",
        locale: "en-US",
        title,
        summary: "Synthetic summary",
        body: "Synthetic moderation repository body.",
        price: { amount: "2500.00", currency: "USD", unit: "MONTHLY" },
        attributes: { bedrooms: 2 },
        contactMode: "PHONE_REVEAL",
        locationPrecision: "EXACT",
        mediaIds: [],
        category: {
          id: categoryId,
          code: `moderation-category-${categoryId}`,
          nameZhHans: "审核测试出租",
          nameEn: "Synthetic Moderation Rentals",
        },
        region: {
          id: regionId,
          code: `TEST-MOD-${regionId}`,
          nameZhHans: "审核测试城市",
          nameEn: "Synthetic Moderation City",
        },
        formSchemaVersion: 1,
        defaultLifetimeDays: 30,
        sensitiveFieldsRedacted: true,
        capturedAt: createdAt.toISOString(),
      },
    },
  });
  return {
    actorUserId,
    actorSessionId,
    unauthorizedUserId,
    unauthorizedSessionId,
    caseId,
    candidateListingId,
    listingId,
    snapshotId,
  };
}

function actionInput(fixture: Fixture): CommitModerationActionInput {
  return {
    actorUserId: fixture.actorUserId,
    sessionId: fixture.actorSessionId,
    recentMfaAfter: new Date("2026-07-29T02:50:00.000Z"),
    caseId: fixture.caseId,
    expectedCaseVersion: 1,
    expectedListingVersion: 3,
    action: "APPROVE",
    reasonCode: "CONTENT_POLICY_COMPLIANT",
    note: "Synthetic internal moderation note.",
    idempotencyKey: "moderation-repository-action-0001",
    requestHash: "e".repeat(64),
    requestId: randomUUID(),
    occurredAt: now,
    nextListing: {
      status: ContentStatus.PUBLISHED,
      moderationStatus: ModerationStatus.APPROVED,
      publishedAt: now,
      expiresAt: new Date("2026-08-28T03:00:00.000Z"),
      version: 4,
    },
  };
}

integration("ModerationCaseRepository with PostgreSQL", () => {
  let database: IntegrationDatabase;

  beforeAll(() => {
    database = createIntegrationDatabase(databaseUrl);
  });

  afterAll(async () => {
    await database?.close();
  });

  it("authorizes current MFA moderators and pages immutable redacted snapshots deterministically", async () => {
    await database.withRollback(async (transaction) => {
      const high = await createFixture(transaction, {
        priority: 90,
        createdAt: new Date("2026-07-29T01:00:00.000Z"),
        title: "Synthetic high-priority rental",
      });
      const medium = await createFixture(transaction, {
        priority: 80,
        createdAt: new Date("2026-07-29T01:01:00.000Z"),
        title: "Synthetic second-priority rental",
      });
      const repository = new ModerationCaseRepository(transaction);
      const unauthorized = await repository.list({
        actorUserId: high.unauthorizedUserId,
        sessionId: high.unauthorizedSessionId,
        queue: "listing-submission",
        status: ModerationCaseStatus.OPEN,
        limit: 1,
        now,
      });
      const firstPage = await repository.list({
        actorUserId: high.actorUserId,
        sessionId: high.actorSessionId,
        queue: "listing-submission",
        status: ModerationCaseStatus.OPEN,
        limit: 1,
        now,
      });
      expect(unauthorized).toEqual({ kind: "actor_unavailable" });
      expect(firstPage).toMatchObject({
        kind: "listed",
        items: [{ id: high.caseId, priority: 90 }],
      });
      if (firstPage.kind !== "listed" || !firstPage.nextCursor) {
        throw new Error("Expected a second moderation queue page");
      }
      const secondPage = await repository.list({
        actorUserId: high.actorUserId,
        sessionId: high.actorSessionId,
        queue: "listing-submission",
        status: ModerationCaseStatus.OPEN,
        cursor: firstPage.nextCursor,
        limit: 1,
        now,
      });
      expect(secondPage).toMatchObject({
        kind: "listed",
        items: [{ id: medium.caseId, priority: 80 }],
        nextCursor: null,
      });

      const detail = await repository.get({
        actorUserId: high.actorUserId,
        sessionId: high.actorSessionId,
        caseId: high.caseId,
        now,
      });
      expect(detail).toMatchObject({
        kind: "found",
        detail: {
          snapshot: {
            attributes: { bedrooms: 2 },
            sensitiveFieldsRedacted: true,
          },
          rules: [
            {
              ruleCode: "EXTERNAL_PAYMENT_REQUEST",
              severity: ModerationRiskTier.HIGH,
              evidenceKey: "body",
            },
          ],
          duplicateCandidates: [
            {
              candidateListingId: high.candidateListingId,
              thresholdVersion: 1,
              mode: "ENFORCE",
              confidence: "HIGH",
              matchedSignals: ["TEXT", "CONTACT"],
            },
          ],
        },
      });
      if (detail.kind !== "found") throw new Error("Expected moderation case detail");
      expect(JSON.stringify(detail.detail.snapshot)).not.toMatch(
        /\\+1555|Must not enter|exactAddress/i,
      );

      await transaction.$executeRawUnsafe(`
        DO $$
        BEGIN
          BEGIN
            UPDATE "moderation_case_snapshots"
            SET "snapshot_hash" = '${"f".repeat(64)}'
            WHERE "id" = '${high.snapshotId}'::uuid;
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

  it("commits one auditable action atomically and preserves exact retry semantics", async () => {
    await database.withRollback(async (transaction) => {
      const fixture = await createFixture(transaction);
      const repository = new ModerationCaseRepository(transaction);
      const input = actionInput(fixture);
      const committed = await repository.commit(input);
      const retried = await repository.commit(input);
      const idempotencyConflict = await repository.commit({
        ...input,
        requestHash: "f".repeat(64),
      });
      expect(committed).toMatchObject({
        kind: "committed",
        duplicateReview: {
          outcome: "FALSE_POSITIVE",
          candidateCount: 1,
        },
        action: {
          caseId: fixture.caseId,
          action: "APPROVE",
          currentCaseStatus: ModerationCaseStatus.RESOLVED,
          currentContentStatus: ContentStatus.PUBLISHED,
          currentModerationStatus: ModerationStatus.APPROVED,
          caseVersion: 2,
          listingVersion: 4,
        },
      });
      expect(retried).toEqual({
        kind: "exact_retry",
        action: committed.kind === "committed" ? committed.action : undefined,
      });
      expect(idempotencyConflict).toEqual({ kind: "idempotency_conflict" });
      const [listing, moderationCase, actions, audits, events, duplicateEvidence] =
        await Promise.all([
          transaction.listing.findUniqueOrThrow({ where: { id: fixture.listingId } }),
          transaction.moderationCase.findUniqueOrThrow({ where: { id: fixture.caseId } }),
          transaction.moderationAction.findMany({ where: { caseId: fixture.caseId } }),
          transaction.auditLog.findMany({
            where: { targetId: fixture.caseId, action: "moderation.case.action.applied" },
          }),
          transaction.outboxEvent.findMany({
            where: { aggregateId: fixture.listingId, eventType: "listing.published" },
          }),
          transaction.moderationDuplicateCandidate.findFirstOrThrow({
            where: { evaluation: { moderationCase: { id: fixture.caseId } } },
          }),
        ]);
      expect(listing).toMatchObject({
        status: ContentStatus.PUBLISHED,
        moderationStatus: ModerationStatus.APPROVED,
        version: 4,
      });
      expect(moderationCase).toMatchObject({
        status: ModerationCaseStatus.RESOLVED,
        version: 2,
        assignedToId: fixture.actorUserId,
      });
      expect(actions).toHaveLength(1);
      expect(audits).toHaveLength(1);
      expect(events).toHaveLength(1);
      expect(duplicateEvidence).toMatchObject({
        reviewOutcome: "FALSE_POSITIVE",
        reviewedAt: now,
      });
      expect(JSON.stringify(audits[0]?.metadata)).not.toContain(input.note);
      expect(JSON.stringify(events[0]?.payload)).not.toContain(input.note);

      await transaction.$executeRawUnsafe(`
        DO $$
        BEGIN
          BEGIN
            UPDATE "moderation_duplicate_candidates"
            SET "review_outcome" = 'CONFIRMED'
            WHERE "id" = '${duplicateEvidence.id}'::uuid;
            RAISE EXCEPTION 'review immutability trigger did not reject mutation';
          EXCEPTION
            WHEN OTHERS THEN
              IF SQLERRM NOT LIKE '%review outcome is immutable%' THEN
                RAISE;
              END IF;
          END;
        END
        $$;
      `);

      const confirmedFixture = await createFixture(transaction, {
        title: "Confirmed duplicate integration rental",
      });
      const confirmedInput: CommitModerationActionInput = {
        ...actionInput(confirmedFixture),
        action: "REJECT",
        reasonCode: "DUPLICATE_CONTENT",
        idempotencyKey: "moderation-confirmed-duplicate-0001",
        requestHash: "c".repeat(64),
        nextListing: {
          status: ContentStatus.SUSPENDED,
          moderationStatus: ModerationStatus.REJECTED,
          publishedAt: null,
          expiresAt: null,
          version: 4,
        },
      };
      await expect(repository.commit(confirmedInput)).resolves.toMatchObject({
        kind: "committed",
        duplicateReview: {
          outcome: "CONFIRMED",
          candidateCount: 1,
        },
      });
      await expect(
        transaction.moderationDuplicateCandidate.findFirstOrThrow({
          where: {
            evaluation: { moderationCase: { id: confirmedFixture.caseId } },
          },
          select: { reviewOutcome: true, reviewedAt: true },
        }),
      ).resolves.toEqual({
        reviewOutcome: "CONFIRMED",
        reviewedAt: now,
      });

      const noEvidenceFixture = await createFixture(transaction, {
        title: "No duplicate evidence integration rental",
        includeDuplicateCandidate: false,
      });
      await expect(
        repository.commit({
          ...actionInput(noEvidenceFixture),
          action: "REJECT",
          reasonCode: "DUPLICATE_CONTENT",
          idempotencyKey: "moderation-duplicate-without-evidence-0001",
          requestHash: "d".repeat(64),
          nextListing: {
            status: ContentStatus.SUSPENDED,
            moderationStatus: ModerationStatus.REJECTED,
            publishedAt: null,
            expiresAt: null,
            version: 4,
          },
        }),
      ).resolves.toEqual({ kind: "state_conflict", currentCaseVersion: 1 });

      await transaction.$executeRawUnsafe(`
        DO $$
        BEGIN
          BEGIN
            DELETE FROM "moderation_actions"
            WHERE "id" = '${actions[0]!.id}'::uuid;
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

      await transaction.platformRoleAssignment.updateMany({
        where: { userId: fixture.actorUserId },
        data: { revokedAt: now, revokedById: fixture.actorUserId },
      });
      await expect(
        repository.get({
          actorUserId: fixture.actorUserId,
          sessionId: fixture.actorSessionId,
          caseId: fixture.caseId,
          now: new Date("2026-07-29T03:00:01.000Z"),
        }),
      ).resolves.toEqual({ kind: "actor_unavailable" });
    });
  });
});
