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
  personalDraftListingId: string;
  publishedListingId: string;
  submittedListingId: string;
  archivedListingId: string;
  suspendedListingId: string;
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
    personalDraftListingId: randomUUID(),
    publishedListingId: randomUUID(),
    submittedListingId: randomUUID(),
    archivedListingId: randomUUID(),
    suspendedListingId: randomUUID(),
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
        id: fixture.personalDraftListingId,
        organizationId: null,
        title: "Personal draft synthetic rental",
        slug: `personal-draft-${fixture.personalDraftListingId}`,
        status: ContentStatus.DRAFT,
        moderationStatus: ModerationStatus.NOT_REVIEWED,
        publishedAt: null,
        expiresAt: null,
      },
      {
        ...sharedListing,
        id: fixture.submittedListingId,
        title: "Submitted synthetic rental",
        slug: `submitted-${fixture.submittedListingId}`,
        status: ContentStatus.SUBMITTED,
        moderationStatus: ModerationStatus.PENDING_REVIEW,
        publishedAt: null,
        expiresAt: null,
      },
      {
        ...sharedListing,
        id: fixture.archivedListingId,
        title: "Archived synthetic rental",
        slug: `archived-${fixture.archivedListingId}`,
        status: ContentStatus.ARCHIVED,
        moderationStatus: ModerationStatus.APPROVED,
      },
      {
        ...sharedListing,
        id: fixture.suspendedListingId,
        title: "Suspended synthetic rental",
        slug: `suspended-${fixture.suspendedListingId}`,
        status: ContentStatus.SUSPENDED,
        moderationStatus: ModerationStatus.REJECTED,
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

  it("paginates the approved public Rental projection with a stable compound cursor", async () => {
    await database.withRollback(async (transaction) => {
      const fixture = await createFixture(transaction);
      const repository = new ListingRepository(transaction);

      const first = await repository.listPublic({
        type: "RENTAL",
        now,
        limit: 1,
      });
      expect(first.items).toHaveLength(1);
      expect(first.nextCursor).not.toBeNull();
      expect([fixture.publishedListingId, fixture.malformedSchemaListingId]).toContain(
        first.items[0]?.id,
      );
      expect(first.items[0]?.attributes).not.toHaveProperty("ownerPrivate");
      expect(first.items[0]?.location).not.toHaveProperty("point");

      const second = await repository.listPublic({
        type: "RENTAL",
        now,
        limit: 1,
        cursor: first.nextCursor ?? undefined,
      });
      expect(second.items).toHaveLength(1);
      expect(second.items[0]?.id).not.toBe(first.items[0]?.id);
      expect(second.nextCursor).toBeNull();

      const filtered = await repository.listPublic({
        type: "RENTAL",
        categoryId: fixture.categoryId,
        regionCode: `TEST-${fixture.regionId}`,
        now,
        limit: 10,
      });
      expect(filtered.items).toHaveLength(2);
      expect(filtered.items.map((item) => item.id)).not.toContain(fixture.draftListingId);
      expect(filtered.items.map((item) => item.id)).not.toContain(fixture.unreviewedListingId);
      expect(filtered.items.map((item) => item.id)).not.toContain(fixture.expiredListingId);
    });
  });

  it("groups the private account projection with stable pagination and membership isolation", async () => {
    await database.withRollback(async (transaction) => {
      const fixture = await createFixture(transaction);
      const repository = new ListingRepository(transaction);

      const first = await repository.listForOwner({
        actorUserId: fixture.ownerId,
        bucket: "DRAFT",
        limit: 1,
        now,
      });
      expect(first.items).toHaveLength(1);
      expect(first.nextCursor).not.toBeNull();
      expect(first.counts).toEqual({
        draft: 2,
        pending: 1,
        published: 3,
        archived: 3,
      });
      const second = await repository.listForOwner({
        actorUserId: fixture.ownerId,
        bucket: "DRAFT",
        cursor: first.nextCursor ?? undefined,
        limit: 1,
        now,
      });
      expect(second.items).toHaveLength(1);
      expect(new Set([...first.items, ...second.items].map((item) => item.id))).toEqual(
        new Set([fixture.draftListingId, fixture.personalDraftListingId]),
      );
      expect(JSON.stringify([...first.items, ...second.items])).not.toMatch(
        /ownerPrivate|moderatorNote|injectedUnknown|latitude|longitude|contactMode|body/i,
      );

      const analyst = await repository.listForOwner({
        actorUserId: fixture.organizationMemberId,
        bucket: "DRAFT",
        limit: 20,
        now,
      });
      expect(analyst.items.map((item) => item.id)).toEqual([fixture.draftListingId]);
      expect(analyst.counts.draft).toBe(1);
      expect(analyst.items.map((item) => item.id)).not.toContain(fixture.personalDraftListingId);

      const filteredOrganization = await repository.listForOwner({
        actorUserId: fixture.ownerId,
        bucket: "DRAFT",
        organizationId: fixture.organizationId,
        limit: 20,
        now,
      });
      expect(filteredOrganization.items.map((item) => item.id)).toEqual([fixture.draftListingId]);
      expect(filteredOrganization.counts.draft).toBe(1);

      const archived = await repository.listForOwner({
        actorUserId: fixture.ownerId,
        bucket: "ARCHIVED",
        limit: 20,
        now,
      });
      expect(new Set(archived.items.map((item) => item.id))).toEqual(
        new Set([fixture.archivedListingId, fixture.expiredListingId, fixture.suspendedListingId]),
      );
      const published = await repository.listForOwner({
        actorUserId: fixture.ownerId,
        bucket: "PUBLISHED",
        limit: 20,
        now,
      });
      expect(published.items.map((item) => item.id)).not.toContain(fixture.expiredListingId);

      const outsider = await repository.listForOwner({
        actorUserId: fixture.outsiderId,
        bucket: "DRAFT",
        limit: 20,
        now,
      });
      expect(outsider.items).toEqual([]);
      expect(outsider.counts).toEqual({
        draft: 0,
        pending: 0,
        published: 0,
        archived: 0,
      });
    });
  });

  it("projects public Job fields, hides owner policy evidence, and expires due Jobs once", async () => {
    await database.withRollback(async (transaction) => {
      const fixture = await createFixture(transaction);
      const jobCategoryId = randomUUID();
      const visibleJobId = randomUUID();
      const dueJobId = randomUUID();
      await transaction.category.create({
        data: {
          id: jobCategoryId,
          vertical: ListingType.JOB,
          slug: `synthetic-jobs-${jobCategoryId}`,
          nameZhHans: "测试招聘",
          nameEn: "Synthetic Jobs",
          formSchemaVersions: {
            create: {
              version: 1,
              definition: {
                categoryId: jobCategoryId,
                version: 1,
                fields: [
                  { key: "employerName", visibility: "PUBLIC" },
                  { key: "wageMax", visibility: "PUBLIC" },
                  { key: "employmentPolicyAcknowledged", visibility: "OWNER_ONLY" },
                ],
              },
              contentHash: "f".repeat(64),
              publishedAt: new Date("2026-07-01T00:00:00.000Z"),
            },
          },
        },
      });
      const jobBase = {
        type: ListingType.JOB,
        ownerId: fixture.ownerId,
        categoryId: jobCategoryId,
        regionId: fixture.regionId,
        locale: "zh-Hans",
        summary: "Fictional Job fixture.",
        body: "This synthetic Job is used only by repository integration tests.",
        priceAmount: "24.00",
        currency: "USD",
        priceUnit: "HOURLY" as const,
        contactMode: ContactMode.IN_APP,
        locationPrecision: "CITY",
        attributes: {
          employerName: "Synthetic Employer",
          wageMax: "31.50",
          employmentPolicyAcknowledged: true,
        },
        status: ContentStatus.PUBLISHED,
        moderationStatus: ModerationStatus.APPROVED,
        publishedAt: new Date("2026-07-20T12:00:00.000Z"),
      } satisfies Omit<Prisma.ListingCreateManyInput, "id" | "title" | "slug" | "expiresAt">;
      await transaction.listing.createMany({
        data: [
          {
            ...jobBase,
            id: visibleJobId,
            title: "Visible synthetic Job",
            slug: `visible-job-${visibleJobId}`,
            expiresAt: new Date("2026-08-20T12:00:00.000Z"),
          },
          {
            ...jobBase,
            id: dueJobId,
            title: "Due synthetic Job",
            slug: `due-job-${dueJobId}`,
            expiresAt: new Date("2026-07-29T11:59:00.000Z"),
          },
        ],
      });
      const repository = new ListingRepository(transaction);

      const publicJobs = await repository.listPublic({
        type: "JOB",
        categoryId: jobCategoryId,
        now,
        limit: 20,
      });
      expect(publicJobs.items).toHaveLength(1);
      expect(publicJobs.items[0]).toMatchObject({
        id: visibleJobId,
        type: "JOB",
        attributes: {
          employerName: "Synthetic Employer",
          wageMax: "31.50",
        },
      });
      expect(publicJobs.items[0]?.attributes).not.toHaveProperty("employmentPolicyAcknowledged");

      await expect(repository.expireDue({ now, limit: 50 })).resolves.toEqual({
        expiredCount: 2,
      });
      await expect(repository.expireDue({ now, limit: 50 })).resolves.toEqual({
        expiredCount: 0,
      });
      await expect(
        transaction.listing.findUniqueOrThrow({
          where: { id: dueJobId },
          select: { status: true, version: true },
        }),
      ).resolves.toEqual({ status: ContentStatus.EXPIRED, version: 2 });
      await expect(
        transaction.auditLog.count({
          where: { targetId: dueJobId, action: "listing.expired", actorType: "SYSTEM" },
        }),
      ).resolves.toBe(1);
      await expect(
        transaction.outboxEvent.count({
          where: { aggregateId: dueJobId, eventType: "listing.expired" },
        }),
      ).resolves.toBe(1);
    });
  });

  it("projects and expires Transfer, Secondhand, and Service without owner-only fields", async () => {
    await database.withRollback(async (transaction) => {
      const fixture = await createFixture(transaction);
      const repository = new ListingRepository(transaction);
      const verticals = [
        {
          type: ListingType.TRANSFER,
          publicAttributes: { businessType: "retail", monthlyRent: "2500.00" },
          privateAttributes: { financialDisclaimerAcknowledged: true },
          fields: [
            { key: "businessType", visibility: "PUBLIC" },
            { key: "monthlyRent", visibility: "PUBLIC" },
            { key: "financialDisclaimerAcknowledged", visibility: "OWNER_ONLY" },
          ],
          priceAmount: "125000.00",
          priceUnit: "FIXED" as const,
        },
        {
          type: ListingType.SECONDHAND,
          publicAttributes: { condition: "good", deliveryOptions: ["pickup"] },
          privateAttributes: { marketplacePolicyAcknowledged: true },
          fields: [
            { key: "condition", visibility: "PUBLIC" },
            { key: "deliveryOptions", visibility: "PUBLIC" },
            { key: "marketplacePolicyAcknowledged", visibility: "OWNER_ONLY" },
          ],
          priceAmount: null,
          priceUnit: "NEGOTIABLE" as const,
        },
        {
          type: ListingType.SERVICE,
          publicAttributes: { serviceRadiusMiles: 20, availability: ["weekdays"] },
          privateAttributes: {
            licenseNumber: "SYNTHETIC-PRIVATE-LICENSE",
            servicePolicyAcknowledged: true,
          },
          fields: [
            { key: "serviceRadiusMiles", visibility: "PUBLIC" },
            { key: "availability", visibility: "PUBLIC" },
            { key: "licenseNumber", visibility: "OWNER_ONLY" },
            { key: "servicePolicyAcknowledged", visibility: "OWNER_ONLY" },
          ],
          priceAmount: "95.00",
          priceUnit: "HOURLY" as const,
        },
      ] as const;
      const dueIds: string[] = [];

      for (const [index, vertical] of verticals.entries()) {
        const categoryId = randomUUID();
        const visibleId = randomUUID();
        const dueId = randomUUID();
        dueIds.push(dueId);
        await transaction.category.create({
          data: {
            id: categoryId,
            vertical: vertical.type,
            slug: `synthetic-${vertical.type.toLowerCase()}-${categoryId}`,
            nameZhHans: `测试${vertical.type}`,
            nameEn: `Synthetic ${vertical.type}`,
            formSchemaVersions: {
              create: {
                version: 1,
                definition: {
                  categoryId,
                  version: 1,
                  fields: vertical.fields,
                },
                contentHash: String(index + 1).repeat(64),
                publishedAt: new Date("2026-07-01T00:00:00.000Z"),
              },
            },
          },
        });
        const base = {
          type: vertical.type,
          ownerId: fixture.ownerId,
          categoryId,
          regionId: fixture.regionId,
          locale: "zh-Hans",
          summary: `Fictional ${vertical.type} fixture.`,
          body: `This synthetic ${vertical.type} is used only by repository integration tests.`,
          priceAmount: vertical.priceAmount,
          currency: "USD",
          priceUnit: vertical.priceUnit,
          contactMode: ContactMode.IN_APP,
          locationPrecision: "CITY",
          attributes: {
            ...vertical.publicAttributes,
            ...vertical.privateAttributes,
            unknownInjected: "must never escape",
          },
          status: ContentStatus.PUBLISHED,
          moderationStatus: ModerationStatus.APPROVED,
          publishedAt: new Date("2026-07-20T12:00:00.000Z"),
        } satisfies Omit<Prisma.ListingCreateManyInput, "id" | "title" | "slug" | "expiresAt">;
        await transaction.listing.createMany({
          data: [
            {
              ...base,
              id: visibleId,
              title: `Visible synthetic ${vertical.type}`,
              slug: `visible-${vertical.type.toLowerCase()}-${visibleId}`,
              expiresAt: new Date("2026-08-20T12:00:00.000Z"),
            },
            {
              ...base,
              id: dueId,
              title: `Due synthetic ${vertical.type}`,
              slug: `due-${vertical.type.toLowerCase()}-${dueId}`,
              expiresAt: new Date("2026-07-29T11:59:00.000Z"),
            },
          ],
        });

        const page = await repository.listPublic({ type: vertical.type, now, limit: 20 });
        expect(page.items).toHaveLength(1);
        expect(page.items[0]).toMatchObject({
          id: visibleId,
          type: vertical.type,
          attributes: vertical.publicAttributes,
        });
        for (const key of Object.keys(vertical.privateAttributes)) {
          expect(page.items[0]?.attributes).not.toHaveProperty(key);
        }
        expect(page.items[0]?.attributes).not.toHaveProperty("unknownInjected");
      }

      await expect(repository.expireDue({ now, limit: 50 })).resolves.toEqual({
        expiredCount: 4,
      });
      await expect(repository.expireDue({ now, limit: 50 })).resolves.toEqual({
        expiredCount: 0,
      });
      await expect(
        transaction.listing.count({
          where: { id: { in: dueIds }, status: ContentStatus.EXPIRED, version: 2 },
        }),
      ).resolves.toBe(3);
      await expect(
        transaction.auditLog.count({
          where: { targetId: { in: dueIds }, action: "listing.expired", actorType: "SYSTEM" },
        }),
      ).resolves.toBe(3);
      await expect(
        transaction.outboxEvent.count({
          where: { aggregateId: { in: dueIds }, eventType: "listing.expired" },
        }),
      ).resolves.toBe(3);
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

  it("archives and idempotently soft-deletes with atomic Audit and Outbox evidence", async () => {
    await database.withRollback(async (transaction) => {
      const fixture = await createFixture(transaction);
      const repository = new ListingRepository(transaction);
      const listingTimestamp = await transaction.listing.findUniqueOrThrow({
        where: { id: fixture.publishedListingId },
        select: { updatedAt: true },
      });
      const occurredAt = new Date(listingTimestamp.updatedAt.getTime() + 1_000);

      await expect(
        repository.transitionOwner({
          actorUserId: fixture.outsiderId,
          listingId: fixture.publishedListingId,
          expectedVersion: 1,
          kind: "ARCHIVE",
          requestId: "req-outsider-archive",
          occurredAt,
        }),
      ).resolves.toEqual({ kind: "not_found" });
      await expect(
        repository.transitionOwner({
          actorUserId: fixture.ownerId,
          listingId: fixture.publishedListingId,
          expectedVersion: 1,
          kind: "ARCHIVE",
          requestId: "req-owner-archive",
          occurredAt,
        }),
      ).resolves.toEqual({ kind: "transitioned", version: 2 });
      await expect(
        repository.transitionOwner({
          actorUserId: fixture.ownerId,
          listingId: fixture.publishedListingId,
          expectedVersion: 2,
          kind: "ARCHIVE",
          requestId: "req-owner-archive-repeat",
          occurredAt,
        }),
      ).resolves.toEqual({ kind: "already_archived", version: 2 });

      const deletedAt = new Date(occurredAt.getTime() + 60_000);
      await expect(
        repository.transitionOwner({
          actorUserId: fixture.ownerId,
          listingId: fixture.publishedListingId,
          expectedVersion: 2,
          kind: "DELETE",
          requestId: "req-owner-delete",
          occurredAt: deletedAt,
        }),
      ).resolves.toEqual({ kind: "transitioned", version: 3 });
      await expect(
        repository.transitionOwner({
          actorUserId: fixture.ownerId,
          listingId: fixture.publishedListingId,
          expectedVersion: 2,
          kind: "DELETE",
          requestId: "req-owner-delete-retry",
          occurredAt: deletedAt,
        }),
      ).resolves.toEqual({ kind: "already_deleted" });

      const row = await transaction.listing.findUniqueOrThrow({
        where: { id: fixture.publishedListingId },
        select: { status: true, deletedAt: true, version: true },
      });
      expect(row).toEqual({
        status: ContentStatus.DELETED,
        deletedAt,
        version: 3,
      });
      const audits = await transaction.auditLog.findMany({
        where: { targetId: fixture.publishedListingId },
        orderBy: { createdAt: "asc" },
        select: { action: true, metadata: true },
      });
      const events = await transaction.outboxEvent.findMany({
        where: { aggregateId: fixture.publishedListingId },
        orderBy: { createdAt: "asc" },
        select: { eventType: true, payload: true },
      });
      expect(audits.map((entry) => entry.action)).toEqual(["listing.archived", "listing.deleted"]);
      expect(events.map((entry) => entry.eventType)).toEqual([
        "listing.archived",
        "listing.deleted",
      ]);
      expect(JSON.stringify({ audits, events })).not.toMatch(
        /@example\.invalid|latitude|longitude|body|contactMode/i,
      );
    });
  });

  it("expires each due Rental once and records the system transition atomically", async () => {
    await database.withRollback(async (transaction) => {
      const fixture = await createFixture(transaction);
      const repository = new ListingRepository(transaction);

      await expect(repository.expireDue({ now, limit: 50 })).resolves.toEqual({
        expiredCount: 1,
      });
      await expect(repository.expireDue({ now, limit: 50 })).resolves.toEqual({
        expiredCount: 0,
      });
      const row = await transaction.listing.findUniqueOrThrow({
        where: { id: fixture.expiredListingId },
        select: { status: true, moderationStatus: true, version: true, deletedAt: true },
      });
      expect(row).toEqual({
        status: ContentStatus.EXPIRED,
        moderationStatus: ModerationStatus.APPROVED,
        version: 2,
        deletedAt: null,
      });
      const auditCount = await transaction.auditLog.count({
        where: {
          targetId: fixture.expiredListingId,
          action: "listing.expired",
          actorId: null,
          actorType: "SYSTEM",
        },
      });
      const outboxCount = await transaction.outboxEvent.count({
        where: {
          aggregateId: fixture.expiredListingId,
          eventType: "listing.expired",
        },
      });
      expect({ auditCount, outboxCount }).toEqual({ auditCount: 1, outboxCount: 1 });
    });
  });
});
