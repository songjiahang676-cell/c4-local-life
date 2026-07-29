import { randomUUID } from "node:crypto";
import {
  ContactMode,
  ContentStatus,
  ListingType,
  MembershipRole,
  ModerationStatus,
  PlatformRole,
  RegionType,
  UserStatus,
  type Prisma,
} from "../generated/prisma/client";
import { ListingRepository } from "../src/repositories/listing.repository";
import {
  createIntegrationDatabase,
  type IntegrationDatabase,
} from "../src/testing/integration-database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const databaseUrl = process.env.DATABASE_INTEGRATION_URL ?? "";
const integration = describe.skipIf(databaseUrl.length === 0);
const now = new Date("2026-07-29T12:00:00.000Z");

type ListingFixture = {
  categoryId: string;
  expiredListingId: string;
  malformedSchemaListingId: string;
  organizationId: string;
  organizationMemberId: string;
  outsiderId: string;
  ownerId: string;
  publishedListingId: string;
  regionId: string;
  regionSlug: string;
  moderatorId: string;
  outOfScopeModeratorId: string;
  malformedScopeModeratorId: string;
  revokedModeratorId: string;
  expiredModeratorId: string;
  taxonomyAdminId: string;
  draftListingId: string;
  unreviewedListingId: string;
};

async function createUser(
  transaction: Prisma.TransactionClient,
  id: string,
  displayName: string,
  status: UserStatus = UserStatus.ACTIVE,
): Promise<void> {
  await transaction.user.create({
    data: {
      id,
      email: `${id}@example.invalid`,
      status,
      profile: {
        create: {
          displayName,
          avatarUrl: `https://cdn.example.invalid/avatar/${id}.webp`,
          preferredLocale: "zh-Hans",
        },
      },
    },
  });
}

async function createFixture(transaction: Prisma.TransactionClient): Promise<ListingFixture> {
  const fixture: ListingFixture = {
    categoryId: randomUUID(),
    expiredListingId: randomUUID(),
    malformedSchemaListingId: randomUUID(),
    organizationId: randomUUID(),
    organizationMemberId: randomUUID(),
    outsiderId: randomUUID(),
    ownerId: randomUUID(),
    publishedListingId: randomUUID(),
    regionId: randomUUID(),
    regionSlug: `synthetic-region-${randomUUID()}`,
    moderatorId: randomUUID(),
    outOfScopeModeratorId: randomUUID(),
    malformedScopeModeratorId: randomUUID(),
    revokedModeratorId: randomUUID(),
    expiredModeratorId: randomUUID(),
    taxonomyAdminId: randomUUID(),
    draftListingId: randomUUID(),
    unreviewedListingId: randomUUID(),
  };
  for (const [id, name] of [
    [fixture.ownerId, "Synthetic Listing Owner"],
    [fixture.organizationMemberId, "Synthetic Organization Analyst"],
    [fixture.outsiderId, "Synthetic Outsider"],
    [fixture.moderatorId, "Synthetic Scoped Moderator"],
    [fixture.outOfScopeModeratorId, "Synthetic Out Of Scope Moderator"],
    [fixture.malformedScopeModeratorId, "Synthetic Malformed Scope Moderator"],
    [fixture.revokedModeratorId, "Synthetic Revoked Moderator"],
    [fixture.expiredModeratorId, "Synthetic Expired Moderator"],
    [fixture.taxonomyAdminId, "Synthetic Taxonomy Admin"],
  ] as const) {
    await createUser(transaction, id, name);
  }

  await transaction.region.create({
    data: {
      id: fixture.regionId,
      type: RegionType.CITY,
      code: `TEST-${fixture.regionId}`,
      slug: fixture.regionSlug,
      nameZhHans: "测试城市",
      nameEn: "Synthetic City",
    },
  });
  await transaction.category.create({
    data: {
      id: fixture.categoryId,
      vertical: ListingType.RENTAL,
      slug: `synthetic-rental-${fixture.categoryId}`,
      nameZhHans: "测试租房",
      nameEn: "Synthetic Rentals",
      formSchemaVersions: {
        create: {
          version: 1,
          definition: {
            categoryId: fixture.categoryId,
            version: 1,
            fields: [
              { key: "publicHeadline", visibility: "PUBLIC" },
              { key: "ownerPrivate", visibility: "OWNER_ONLY" },
              { key: "moderatorNote", visibility: "MODERATOR_ONLY" },
            ],
          },
          contentHash: "0".repeat(64),
          publishedAt: new Date("2026-07-01T00:00:00.000Z"),
        },
      },
    },
  });
  await transaction.organization.create({
    data: {
      id: fixture.organizationId,
      type: "MERCHANT",
      displayName: "Synthetic Property Team",
      legalName: "Confidential Synthetic Legal Name LLC",
      slug: `synthetic-property-${fixture.organizationId}`,
      memberships: {
        create: [
          { userId: fixture.ownerId, role: MembershipRole.OWNER },
          { userId: fixture.organizationMemberId, role: MembershipRole.ANALYST },
        ],
      },
    },
  });

  const sharedListing = {
    type: ListingType.RENTAL,
    ownerId: fixture.ownerId,
    organizationId: fixture.organizationId,
    categoryId: fixture.categoryId,
    regionId: fixture.regionId,
    locale: "zh-Hans",
    summary: "Deliberately fictional repository integration fixture.",
    body: "This is synthetic listing copy for isolated repository projection tests.",
    priceAmount: "3250.00",
    currency: "USD",
    priceUnit: "MONTHLY" as const,
    contactMode: ContactMode.EMAIL_REVEAL,
    locationPrecision: "EXACT",
    latitude: "33.684600",
    longitude: "-117.826500",
    attributes: {
      publicHeadline: "Public synthetic attribute",
      ownerPrivate: "Owner confidential synthetic value",
      moderatorNote: "Moderator-only synthetic risk note",
      injectedUnknown: "Must never escape a projection",
    },
    qualityScore: 0.37,
    isFeatured: true,
    featuredUntil: new Date("2026-08-05T00:00:00.000Z"),
    publishedAt: new Date("2026-07-20T12:00:00.000Z"),
    expiresAt: new Date("2026-08-20T12:00:00.000Z"),
  } satisfies Omit<
    Prisma.ListingCreateManyInput,
    "id" | "title" | "slug" | "status" | "moderationStatus"
  >;
  await transaction.listing.createMany({
    data: [
      {
        ...sharedListing,
        id: fixture.publishedListingId,
        title: "Published synthetic rental",
        slug: `published-${fixture.publishedListingId}`,
        status: ContentStatus.PUBLISHED,
        moderationStatus: ModerationStatus.APPROVED,
      },
      {
        ...sharedListing,
        id: fixture.draftListingId,
        title: "Draft synthetic rental",
        slug: `draft-${fixture.draftListingId}`,
        status: ContentStatus.DRAFT,
        moderationStatus: ModerationStatus.NOT_REVIEWED,
        publishedAt: null,
        expiresAt: null,
      },
      {
        ...sharedListing,
        id: fixture.unreviewedListingId,
        title: "Unreviewed synthetic rental",
        slug: `unreviewed-${fixture.unreviewedListingId}`,
        status: ContentStatus.PUBLISHED,
        moderationStatus: ModerationStatus.PENDING_REVIEW,
      },
      {
        ...sharedListing,
        id: fixture.expiredListingId,
        title: "Expired synthetic rental",
        slug: `expired-${fixture.expiredListingId}`,
        status: ContentStatus.PUBLISHED,
        moderationStatus: ModerationStatus.APPROVED,
        expiresAt: new Date("2026-07-28T12:00:00.000Z"),
      },
      {
        ...sharedListing,
        id: fixture.malformedSchemaListingId,
        title: "Missing schema synthetic rental",
        slug: `missing-schema-${fixture.malformedSchemaListingId}`,
        status: ContentStatus.PUBLISHED,
        moderationStatus: ModerationStatus.APPROVED,
        formSchemaVersion: 2,
      },
    ],
  });

  const grantedAt = new Date("2026-07-01T00:00:00.000Z");
  await transaction.platformRoleAssignment.createMany({
    data: [
      {
        userId: fixture.moderatorId,
        role: PlatformRole.MODERATOR,
        reasonCode: "TEST_SCOPED_MODERATOR",
        grantedAt,
        scope: { regions: [fixture.regionSlug] },
      },
      {
        userId: fixture.outOfScopeModeratorId,
        role: PlatformRole.MODERATOR,
        reasonCode: "TEST_OTHER_REGION",
        grantedAt,
        scope: { regions: ["different-region"] },
      },
      {
        userId: fixture.malformedScopeModeratorId,
        role: PlatformRole.MODERATOR,
        reasonCode: "TEST_MALFORMED_SCOPE",
        grantedAt,
        scope: { regions: fixture.regionSlug },
      },
      {
        userId: fixture.revokedModeratorId,
        role: PlatformRole.MODERATOR,
        reasonCode: "TEST_REVOKED_MODERATOR",
        grantedAt,
        revokedAt: new Date("2026-07-20T00:00:00.000Z"),
        revokedById: fixture.ownerId,
      },
      {
        userId: fixture.expiredModeratorId,
        role: PlatformRole.SENIOR_MODERATOR,
        reasonCode: "TEST_EXPIRED_MODERATOR",
        grantedAt,
        expiresAt: new Date("2026-07-20T00:00:00.000Z"),
      },
      {
        userId: fixture.taxonomyAdminId,
        role: PlatformRole.TAXONOMY_ADMIN,
        reasonCode: "TEST_WRONG_PLATFORM_ROLE",
        grantedAt,
      },
    ],
  });
  return fixture;
}

integration("ListingRepository safe PostgreSQL projections", () => {
  let database: IntegrationDatabase;

  beforeAll(() => {
    database = createIntegrationDatabase(databaseUrl);
  });

  afterAll(async () => {
    await database?.close();
  });

  it("returns only current approved public content and strips private/internal fields", async () => {
    await database.withRollback(async (transaction) => {
      const fixture = await createFixture(transaction);
      const repository = new ListingRepository(transaction);

      const visible = await repository.findPublicById({
        listingId: fixture.publishedListingId,
        now,
      });
      const draft = await repository.findPublicById({
        listingId: fixture.draftListingId,
        now,
      });
      const unreviewed = await repository.findPublicById({
        listingId: fixture.unreviewedListingId,
        now,
      });
      const expired = await repository.findPublicById({
        listingId: fixture.expiredListingId,
        now,
      });

      expect(visible).toMatchObject({
        id: fixture.publishedListingId,
        status: ContentStatus.PUBLISHED,
        attributes: { publicHeadline: "Public synthetic attribute" },
        location: { precision: "EXACT" },
        featured: true,
        owner: { id: fixture.ownerId, displayName: "Synthetic Listing Owner" },
        organization: { id: fixture.organizationId, displayName: "Synthetic Property Team" },
      });
      expect(visible?.attributes).toEqual({ publicHeadline: "Public synthetic attribute" });
      expect(visible?.location).not.toHaveProperty("point");
      for (const field of [
        "moderationStatus",
        "contactMode",
        "qualityScore",
        "ownerId",
        "organizationId",
        "formSchemaVersion",
      ]) {
        expect(visible).not.toHaveProperty(field);
      }
      const serialized = JSON.stringify(visible);
      expect(serialized).not.toContain("Owner confidential synthetic value");
      expect(serialized).not.toContain("Moderator-only synthetic risk note");
      expect(serialized).not.toContain("Must never escape a projection");
      expect(serialized).not.toContain("@example.invalid");
      expect(serialized).not.toContain("Confidential Synthetic Legal Name");
      expect(serialized).not.toContain("33.6846");
      expect(draft).toBeNull();
      expect(unreviewed).toBeNull();
      expect(expired).toBeNull();

      await transaction.category.update({
        where: { id: fixture.categoryId },
        data: { isActive: false },
      });
      expect(
        await repository.findPublicById({ listingId: fixture.publishedListingId, now }),
      ).toBeNull();
    });
  });

  it("scopes owner views to the direct owner or a current organization member", async () => {
    await database.withRollback(async (transaction) => {
      const fixture = await createFixture(transaction);
      const repository = new ListingRepository(transaction);

      const ownerView = await repository.findByIdForOwner({
        actorUserId: fixture.ownerId,
        listingId: fixture.publishedListingId,
        now,
      });
      const organizationView = await repository.findByIdForOwner({
        actorUserId: fixture.organizationMemberId,
        listingId: fixture.publishedListingId,
        now,
      });
      const outsiderView = await repository.findByIdForOwner({
        actorUserId: fixture.outsiderId,
        listingId: fixture.publishedListingId,
        now,
      });

      expect(ownerView).toMatchObject({
        ownerId: fixture.ownerId,
        organizationId: fixture.organizationId,
        moderationStatus: ModerationStatus.APPROVED,
        contactMode: ContactMode.EMAIL_REVEAL,
        attributes: {
          publicHeadline: "Public synthetic attribute",
          ownerPrivate: "Owner confidential synthetic value",
        },
        location: {
          precision: "EXACT",
          point: { latitude: "33.6846", longitude: "-117.8265" },
        },
      });
      expect(organizationView?.id).toBe(fixture.publishedListingId);
      expect(outsiderView).toBeNull();
      expect(ownerView?.attributes).not.toHaveProperty("moderatorNote");
      expect(ownerView?.attributes).not.toHaveProperty("injectedUnknown");
      expect(JSON.stringify(ownerView)).not.toContain("@example.invalid");
      expect(ownerView).not.toHaveProperty("qualityScore");

      await transaction.organizationMembership.delete({
        where: {
          organizationId_userId: {
            organizationId: fixture.organizationId,
            userId: fixture.ownerId,
          },
        },
      });
      expect(
        await repository.findByIdForOwner({
          actorUserId: fixture.ownerId,
          listingId: fixture.publishedListingId,
          now,
        }),
      ).toBeNull();

      await transaction.user.update({
        where: { id: fixture.organizationMemberId },
        data: { status: UserStatus.SUSPENDED },
      });
      expect(
        await repository.findByIdForOwner({
          actorUserId: fixture.organizationMemberId,
          listingId: fixture.publishedListingId,
          now,
        }),
      ).toBeNull();
    });
  });

  it("requires an active scoped moderation role before returning an internal projection", async () => {
    await database.withRollback(async (transaction) => {
      const fixture = await createFixture(transaction);
      const repository = new ListingRepository(transaction);

      const moderatorView = await repository.findByIdForModerator({
        actorUserId: fixture.moderatorId,
        listingId: fixture.publishedListingId,
        now,
      });
      expect(moderatorView).toMatchObject({
        id: fixture.publishedListingId,
        owner: {
          id: fixture.ownerId,
          accountStatus: UserStatus.ACTIVE,
        },
        attributes: {
          publicHeadline: "Public synthetic attribute",
          ownerPrivate: "Owner confidential synthetic value",
          moderatorNote: "Moderator-only synthetic risk note",
        },
        qualityScore: 0.37,
      });
      expect(moderatorView?.attributes).not.toHaveProperty("injectedUnknown");
      expect(moderatorView?.location).not.toHaveProperty("point");
      const serialized = JSON.stringify(moderatorView);
      expect(serialized).not.toContain("@example.invalid");
      expect(serialized).not.toContain("Confidential Synthetic Legal Name");
      expect(serialized).not.toContain("33.6846");

      for (const actorUserId of [
        fixture.outOfScopeModeratorId,
        fixture.malformedScopeModeratorId,
        fixture.revokedModeratorId,
        fixture.expiredModeratorId,
        fixture.taxonomyAdminId,
        fixture.outsiderId,
      ]) {
        expect(
          await repository.findByIdForModerator({
            actorUserId,
            listingId: fixture.publishedListingId,
            now,
          }),
        ).toBeNull();
      }
    });
  });

  it("fails closed on a missing exact form-schema version instead of returning raw attributes", async () => {
    await database.withRollback(async (transaction) => {
      const fixture = await createFixture(transaction);
      const repository = new ListingRepository(transaction);

      const publicView = await repository.findPublicById({
        listingId: fixture.malformedSchemaListingId,
        now,
      });
      const ownerView = await repository.findByIdForOwner({
        actorUserId: fixture.ownerId,
        listingId: fixture.malformedSchemaListingId,
        now,
      });
      const moderatorView = await repository.findByIdForModerator({
        actorUserId: fixture.moderatorId,
        listingId: fixture.malformedSchemaListingId,
        now,
      });

      expect(publicView?.attributes).toEqual({});
      expect(ownerView?.attributes).toEqual({});
      expect(moderatorView?.attributes).toEqual({});
    });
  });
});
