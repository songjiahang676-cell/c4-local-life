import { randomUUID } from "node:crypto";
import {
  ContactMode,
  ContentStatus,
  ListingRevisionClassification,
  ListingType,
  ModerationRiskTier,
  ModerationStatus,
  RegionType,
  UserStatus,
  type Prisma,
} from "../generated/prisma/client";
import { ListingRepository } from "../src/repositories/listing.repository";
import {
  ListingRevisionRepository,
  type RevisePublishedListingInput,
} from "../src/repositories/listing-revision.repository";
import {
  createIntegrationDatabase,
  type IntegrationDatabase,
} from "../src/testing/integration-database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const databaseUrl = process.env.DATABASE_INTEGRATION_URL ?? "";
const integration = describe.skipIf(databaseUrl.length === 0);
const publishedAt = new Date("2026-07-29T18:00:00.000Z");
const expiresAt = new Date("2026-08-28T18:00:00.000Z");
const editAt = new Date("2026-07-29T19:00:00.000Z");

async function createFixture(transaction: Prisma.TransactionClient): Promise<{
  actorUserId: string;
  categoryId: string;
  listingId: string;
  outsiderId: string;
  regionId: string;
}> {
  const actorUserId = randomUUID();
  const categoryId = randomUUID();
  const listingId = randomUUID();
  const outsiderId = randomUUID();
  const regionId = randomUUID();
  for (const [id, displayName] of [
    [actorUserId, "Synthetic Revision Owner"],
    [outsiderId, "Synthetic Revision Outsider"],
  ] as const) {
    await transaction.user.create({
      data: {
        id,
        email: `${id}@example.invalid`,
        status: UserStatus.ACTIVE,
        profile: { create: { displayName } },
      },
    });
  }
  await transaction.region.create({
    data: {
      id: regionId,
      code: `TEST-REVISION-${regionId}`,
      type: RegionType.CITY,
      slug: `revision-region-${regionId}`,
      nameZhHans: "修订测试城市",
      nameEn: "Synthetic Revision City",
    },
  });
  await transaction.category.create({
    data: {
      id: categoryId,
      vertical: ListingType.RENTAL,
      slug: `revision-category-${categoryId}`,
      nameZhHans: "修订测试租房",
      nameEn: "Synthetic Revision Rentals",
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
          publishedAt,
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
      status: ContentStatus.PUBLISHED,
      moderationStatus: ModerationStatus.AUTO_APPROVED,
      locale: "zh-Hans",
      title: "Synthetic published revision listing",
      slug: `revision-listing-${listingId}`,
      body: "Synthetic revision content, never a real advertisement.",
      contactMode: ContactMode.IN_APP,
      publishedAt,
      expiresAt,
      createdAt: new Date("2026-07-20T00:00:00.000Z"),
      updatedAt: publishedAt,
      version: 3,
    },
  });
  return { actorUserId, categoryId, listingId, outsiderId, regionId };
}

function revisionInput(
  fixture: Awaited<ReturnType<typeof createFixture>>,
): RevisePublishedListingInput {
  const title = "Synthetic published revision listing!";
  return {
    actorUserId: fixture.actorUserId,
    listingId: fixture.listingId,
    expectedVersion: 3,
    idempotencyKey: "published-revision-0001",
    requestHash: "b".repeat(64),
    requestId: randomUUID(),
    occurredAt: editAt,
    classification: ListingRevisionClassification.MINOR_EDIT,
    reasonCodes: ["MINOR_TEXT_EDIT"],
    categoryId: fixture.categoryId,
    formSchemaVersion: 1,
    regionId: fixture.regionId,
    locale: "zh-Hans",
    title,
    slug: `revision-listing-${fixture.listingId}`,
    summary: null,
    body: "Synthetic revision content, never a real advertisement.",
    priceAmount: null,
    currency: "USD",
    priceUnit: null,
    contactMode: ContactMode.IN_APP,
    attributes: {},
    latitude: null,
    longitude: null,
    locationPrecision: "CITY",
    mediaIds: [],
    jobDetail: null,
    transferDetail: null,
    secondhandDetail: null,
    serviceDetail: null,
    snapshot: {
      locale: "zh-Hans",
      title,
      summary: null,
      body: "Synthetic revision content, never a real advertisement.",
      price: null,
      category: {
        id: fixture.categoryId,
        code: `revision-category-${fixture.categoryId}`,
        nameZhHans: "修订测试租房",
        nameEn: "Synthetic Revision Rentals",
      },
      region: {
        id: fixture.regionId,
        code: `TEST-REVISION-${fixture.regionId}`,
        nameZhHans: "修订测试城市",
        nameEn: "Synthetic Revision City",
      },
      location: { precision: "CITY" },
      contactMode: ContactMode.IN_APP,
      attributes: {},
      mediaIds: [],
      formSchemaVersion: 1,
      defaultLifetimeDays: 30,
    },
    diff: [
      {
        field: "title",
        kind: "CHANGED",
        before: "Synthetic published revision listing",
        after: title,
      },
    ],
    inputHash: "c".repeat(64),
    ruleSetKey: "listing-submission",
    ruleSetVersion: 3,
    riskTier: ModerationRiskTier.LOW,
    hits: [],
  };
}

integration("ListingRevisionRepository with PostgreSQL", () => {
  let database: IntegrationDatabase;

  beforeAll(() => {
    database = createIntegrationDatabase(databaseUrl);
  });

  afterAll(async () => {
    await database?.close();
  });

  it("keeps a low-risk typo public and routes a material edit through immutable review", async () => {
    await database.withRollback(async (transaction) => {
      const fixture = await createFixture(transaction);
      const repository = new ListingRevisionRepository(transaction);
      const minorInput = revisionInput(fixture);
      const minor = await repository.revise(minorInput);
      const minorRetry = await repository.revise(minorInput);
      expect(minor).toMatchObject({
        kind: "revised",
        listing: {
          status: ContentStatus.PUBLISHED,
          moderationStatus: ModerationStatus.AUTO_APPROVED,
          publishedAt,
          expiresAt,
          version: 4,
        },
        revision: {
          classification: ListingRevisionClassification.MINOR_EDIT,
          reasonCodes: ["MINOR_TEXT_EDIT"],
          reviewState: "NOT_REQUIRED",
          riskTier: ModerationRiskTier.LOW,
        },
      });
      expect(minorRetry).toEqual({
        kind: "exact_retry",
        listing: minor.kind === "revised" ? minor.listing : undefined,
        revision: minor.kind === "revised" ? minor.revision : undefined,
      });

      const majorInput: RevisePublishedListingInput = {
        ...minorInput,
        expectedVersion: 4,
        idempotencyKey: "published-revision-0002",
        requestHash: "d".repeat(64),
        occurredAt: new Date(editAt.getTime() + 1_000),
        classification: ListingRevisionClassification.MAJOR_EDIT,
        reasonCodes: ["PRICE_CHANGED"],
        priceAmount: "2500.00",
        priceUnit: "MONTHLY",
        snapshot: {
          ...minorInput.snapshot,
          price: { amount: "2500.00", currency: "USD", unit: "MONTHLY" },
        },
        diff: [
          {
            field: "price",
            kind: "ADDED",
            before: null,
            after: { amount: "2500.00", currency: "USD", unit: "MONTHLY" },
          },
        ],
        inputHash: "e".repeat(64),
      };
      const major = await repository.revise(majorInput);
      expect(major).toMatchObject({
        kind: "revised",
        listing: {
          status: ContentStatus.SUBMITTED,
          moderationStatus: ModerationStatus.PENDING_REVIEW,
          publishedAt: null,
          expiresAt: null,
          version: 5,
        },
        revision: {
          revisionNumber: 2,
          classification: ListingRevisionClassification.MAJOR_EDIT,
          reasonCodes: ["PRICE_CHANGED"],
          reviewState: "PENDING",
          riskTier: ModerationRiskTier.MEDIUM,
        },
      });
      expect(
        await new ListingRepository(transaction).findPublicById({
          listingId: fixture.listingId,
          now: majorInput.occurredAt,
        }),
      ).toBeNull();
      const history = await repository.list({
        actorUserId: fixture.actorUserId,
        listingId: fixture.listingId,
        limit: 1,
        now: majorInput.occurredAt,
      });
      expect(history).toMatchObject({
        kind: "listed",
        items: [{ classification: ListingRevisionClassification.MAJOR_EDIT }],
      });
      if (history.kind !== "listed") throw new Error("Expected revision history");
      expect(history.nextCursor).not.toBeNull();
      expect(
        await repository.list({
          actorUserId: fixture.outsiderId,
          listingId: fixture.listingId,
          limit: 20,
          now: majorInput.occurredAt,
        }),
      ).toEqual({ kind: "not_found" });
      const moderationCase = await transaction.moderationCase.findFirstOrThrow({
        where: { targetId: fixture.listingId },
        include: { snapshot: true },
      });
      expect(moderationCase.priority).toBe(50);
      expect(moderationCase.snapshot?.snapshot).toMatchObject({
        previous: { title: minorInput.snapshot.title },
        revision: {
          classification: "MAJOR_EDIT",
          originalPublishedAt: publishedAt.toISOString(),
          originalExpiresAt: expiresAt.toISOString(),
        },
      });
    });
  });
});
