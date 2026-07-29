import { randomUUID } from "node:crypto";
import {
  ContactMode,
  ContentStatus,
  ListingType,
  MembershipRole,
  PriceUnit,
  RegionType,
  UserStatus,
  type Prisma,
} from "../generated/prisma/client";
import {
  ListingDraftRepository,
  type CreateListingDraftInput,
  type ListingDraftWriteFields,
} from "../src/repositories/listing-draft.repository";
import {
  createIntegrationDatabase,
  type IntegrationDatabase,
} from "../src/testing/integration-database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const databaseUrl = process.env.DATABASE_INTEGRATION_URL ?? "";
const integration = describe.skipIf(databaseUrl.length === 0);
const baseTime = new Date("2026-07-29T16:00:00.000Z");

type DraftFixture = {
  billingId: string;
  categoryId: string;
  editorId: string;
  organizationId: string;
  outsiderId: string;
  ownerId: string;
  regionCode: string;
  regionId: string;
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
      profile: { create: { displayName, preferredLocale: "zh-Hans" } },
    },
  });
}

async function createDraftFixture(transaction: Prisma.TransactionClient): Promise<DraftFixture> {
  const fixture: DraftFixture = {
    billingId: randomUUID(),
    categoryId: randomUUID(),
    editorId: randomUUID(),
    organizationId: randomUUID(),
    outsiderId: randomUUID(),
    ownerId: randomUUID(),
    regionCode: `TEST-LISTING-DRAFT-${randomUUID()}`,
    regionId: randomUUID(),
  };
  for (const [id, name] of [
    [fixture.ownerId, "Synthetic Draft Owner"],
    [fixture.outsiderId, "Synthetic Draft Outsider"],
    [fixture.editorId, "Synthetic Organization Editor"],
    [fixture.billingId, "Synthetic Organization Billing Member"],
  ] as const) {
    await createUser(transaction, id, name);
  }
  await transaction.region.create({
    data: {
      id: fixture.regionId,
      code: fixture.regionCode,
      type: RegionType.CITY,
      slug: `listing-draft-region-${fixture.regionId}`,
      nameZhHans: "测试草稿城市",
      nameEn: "Synthetic Draft City",
    },
  });
  await transaction.category.create({
    data: {
      id: fixture.categoryId,
      vertical: ListingType.RENTAL,
      slug: `listing-draft-category-${fixture.categoryId}`,
      nameZhHans: "测试草稿租房",
      nameEn: "Synthetic Draft Rentals",
      formSchemaVersions: {
        create: {
          version: 1,
          definition: {
            categoryId: fixture.categoryId,
            version: 1,
            fields: [],
          },
          contentHash: "a".repeat(64),
          publishedAt: baseTime,
        },
      },
    },
  });
  await transaction.organization.create({
    data: {
      id: fixture.organizationId,
      type: "MERCHANT",
      displayName: "Synthetic Draft Organization",
      slug: `listing-draft-organization-${fixture.organizationId}`,
      memberships: {
        create: [
          { userId: fixture.editorId, role: MembershipRole.EDITOR },
          { userId: fixture.billingId, role: MembershipRole.BILLING },
        ],
      },
    },
  });
  return fixture;
}

function writeFields(fixture: DraftFixture, title: string): ListingDraftWriteFields {
  return {
    categoryId: fixture.categoryId,
    formSchemaVersion: 1,
    regionId: fixture.regionId,
    locale: "zh-Hans",
    title,
    slug: `synthetic-draft-${randomUUID()}`,
    summary: "Fictional summary for repository integration coverage.",
    body: "Synthetic Listing body; this is not a real advertisement.",
    priceAmount: "2450.00",
    currency: "USD",
    priceUnit: PriceUnit.MONTHLY,
    contactMode: ContactMode.IN_APP,
    attributes: {},
    latitude: "33.684600",
    longitude: "-117.826500",
    locationPrecision: "APPROXIMATE",
  };
}

function createInput(
  fixture: DraftFixture,
  overrides: Partial<CreateListingDraftInput> = {},
): CreateListingDraftInput {
  return {
    ...writeFields(fixture, "Synthetic repository draft"),
    id: randomUUID(),
    actorUserId: fixture.ownerId,
    organizationId: null,
    type: ListingType.RENTAL,
    idempotencyKey: `listing-draft-${randomUUID()}`,
    requestHash: "b".repeat(64),
    requestId: randomUUID(),
    occurredAt: baseTime,
    ...overrides,
  };
}

integration("ListingDraftRepository with PostgreSQL", () => {
  let database: IntegrationDatabase;

  beforeAll(() => {
    database = createIntegrationDatabase(databaseUrl);
  });

  afterAll(async () => {
    await database?.close();
  });

  it("resolves exact published taxonomy and creates one auditable idempotent draft", async () => {
    await database.withRollback(async (transaction) => {
      const fixture = await createDraftFixture(transaction);
      const repository = new ListingDraftRepository(transaction);
      const references = await repository.resolveReferences({
        type: ListingType.RENTAL,
        categoryId: fixture.categoryId,
        regionCode: fixture.regionCode,
      });
      const input = createInput(fixture, {
        idempotencyKey: "repository-listing-create-0001",
        requestHash: "c".repeat(64),
      });

      const created = await repository.createDraft(input);
      const retried = await repository.createDraft({ ...input, id: randomUUID() });
      const conflict = await repository.createDraft({
        ...input,
        id: randomUUID(),
        requestHash: "d".repeat(64),
      });
      const earlyRetry = await repository.findCreateRetry({
        actorUserId: fixture.ownerId,
        idempotencyKey: input.idempotencyKey,
        requestHash: input.requestHash,
        now: baseTime,
      });

      expect(references).toEqual({
        categoryId: fixture.categoryId,
        formSchemaVersion: 1,
        regionId: fixture.regionId,
      });
      expect(created).toMatchObject({
        kind: "created",
        listing: {
          id: input.id,
          ownerId: fixture.ownerId,
          organizationId: null,
          status: ContentStatus.DRAFT,
          version: 1,
        },
      });
      expect(retried).toMatchObject({ kind: "exact_retry", listing: { id: input.id } });
      expect(conflict).toEqual({ kind: "idempotency_conflict" });
      expect(earlyRetry).toMatchObject({ kind: "exact_retry", listing: { id: input.id } });
      await expect(
        transaction.listing.count({ where: { ownerId: fixture.ownerId } }),
      ).resolves.toBe(1);
      const audit = await transaction.auditLog.findMany({ where: { targetId: input.id } });
      const outbox = await transaction.outboxEvent.findMany({
        where: { aggregateId: input.id },
      });
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({
        actorId: fixture.ownerId,
        action: "listing.draft.created",
        targetType: "LISTING",
        requestId: input.requestId,
        metadata: { version: 1, status: "DRAFT", organizationScoped: false },
      });
      expect(outbox).toHaveLength(1);
      expect(outbox[0]).toMatchObject({
        aggregateType: "LISTING",
        eventType: "listing.draft.created",
        payload: {
          schemaVersion: 1,
          aggregateVersion: 1,
          listingId: input.id,
          type: "RENTAL",
          status: "DRAFT",
        },
      });
      expect(JSON.stringify({ audit, outbox })).not.toMatch(
        /Synthetic repository draft|advertisement|2450|email|phone/i,
      );
      expect(JSON.stringify(created)).not.toMatch(
        /createIdempotencyKey|createRequestHash|requestHash/i,
      );
    });
  });

  it("enforces owner, organization-role, state, reference, and version boundaries", async () => {
    await database.withRollback(async (transaction) => {
      const fixture = await createDraftFixture(transaction);
      const repository = new ListingDraftRepository(transaction);
      const personalInput = createInput(fixture, {
        idempotencyKey: "repository-listing-update-0001",
      });
      const organizationInput = createInput(fixture, {
        actorUserId: fixture.editorId,
        organizationId: fixture.organizationId,
        idempotencyKey: "repository-listing-org-0001",
      });
      const personal = await repository.createDraft(personalInput);
      const organization = await repository.createDraft(organizationInput);
      const billingCreate = await repository.createDraft(
        createInput(fixture, {
          actorUserId: fixture.billingId,
          organizationId: fixture.organizationId,
          idempotencyKey: "repository-listing-billing-0001",
        }),
      );
      const updateFields = writeFields(fixture, "Updated synthetic repository draft");

      const outsiderUpdate = await repository.updateDraft({
        ...updateFields,
        actorUserId: fixture.outsiderId,
        listingId: personalInput.id,
        expectedVersion: 1,
        requestId: randomUUID(),
        occurredAt: new Date(baseTime.getTime() + 1_000),
      });
      const billingUpdate = await repository.updateDraft({
        ...updateFields,
        actorUserId: fixture.billingId,
        listingId: organizationInput.id,
        expectedVersion: 1,
        requestId: randomUUID(),
        occurredAt: new Date(baseTime.getTime() + 1_000),
      });
      const updated = await repository.updateDraft({
        ...updateFields,
        actorUserId: fixture.ownerId,
        listingId: personalInput.id,
        expectedVersion: 1,
        requestId: "repository-listing-update-request-0001",
        occurredAt: new Date(baseTime.getTime() + 1_000),
      });
      const stale = await repository.updateDraft({
        ...updateFields,
        actorUserId: fixture.ownerId,
        listingId: personalInput.id,
        expectedVersion: 1,
        requestId: randomUUID(),
        occurredAt: new Date(baseTime.getTime() + 2_000),
      });
      const invalidReference = await repository.updateDraft({
        ...updateFields,
        regionId: randomUUID(),
        actorUserId: fixture.editorId,
        listingId: organizationInput.id,
        expectedVersion: 1,
        requestId: randomUUID(),
        occurredAt: new Date(baseTime.getTime() + 1_000),
      });
      await transaction.listing.update({
        where: { id: organizationInput.id },
        data: { status: ContentStatus.SUBMITTED },
      });
      const wrongState = await repository.updateDraft({
        ...updateFields,
        actorUserId: fixture.editorId,
        listingId: organizationInput.id,
        expectedVersion: 1,
        requestId: randomUUID(),
        occurredAt: new Date(baseTime.getTime() + 2_000),
      });

      expect(personal.kind).toBe("created");
      expect(organization.kind).toBe("created");
      expect(billingCreate).toEqual({ kind: "invalid_organization" });
      expect(outsiderUpdate).toEqual({ kind: "not_found" });
      expect(billingUpdate).toEqual({ kind: "not_found" });
      expect(updated).toMatchObject({
        kind: "updated",
        listing: { title: "Updated synthetic repository draft", version: 2 },
      });
      expect(stale).toEqual({ kind: "version_conflict", currentVersion: 2 });
      expect(invalidReference).toEqual({ kind: "invalid_reference" });
      expect(wrongState).toEqual({ kind: "state_conflict", currentVersion: 1 });
      await expect(
        transaction.auditLog.count({
          where: { targetId: personalInput.id, action: "listing.draft.updated" },
        }),
      ).resolves.toBe(1);
      await expect(
        transaction.outboxEvent.count({
          where: { aggregateId: personalInput.id, eventType: "listing.draft.updated" },
        }),
      ).resolves.toBe(1);
    });
  });

  it("serializes concurrent create retries and conditional updates", async () => {
    const fixture: DraftFixture = {
      billingId: randomUUID(),
      categoryId: randomUUID(),
      editorId: randomUUID(),
      organizationId: randomUUID(),
      outsiderId: randomUUID(),
      ownerId: randomUUID(),
      regionCode: `TEST-LISTING-CONCURRENT-${randomUUID()}`,
      regionId: randomUUID(),
    };
    const repository = new ListingDraftRepository({
      connectionString: databaseUrl,
      poolMaximum: 4,
    });
    try {
      await database.client.user.create({
        data: {
          id: fixture.ownerId,
          email: `${fixture.ownerId}@example.invalid`,
          profile: { create: { displayName: "Synthetic Concurrent Draft Owner" } },
        },
      });
      await database.client.region.create({
        data: {
          id: fixture.regionId,
          code: fixture.regionCode,
          type: RegionType.CITY,
          slug: `listing-concurrent-region-${fixture.regionId}`,
          nameZhHans: "测试并发城市",
          nameEn: "Synthetic Concurrent City",
        },
      });
      await database.client.category.create({
        data: {
          id: fixture.categoryId,
          vertical: ListingType.RENTAL,
          slug: `listing-concurrent-category-${fixture.categoryId}`,
          nameZhHans: "测试并发租房",
          nameEn: "Synthetic Concurrent Rentals",
          formSchemaVersions: {
            create: {
              version: 1,
              definition: { categoryId: fixture.categoryId, version: 1, fields: [] },
              contentHash: "e".repeat(64),
              publishedAt: baseTime,
            },
          },
        },
      });
      const first = createInput(fixture, {
        id: randomUUID(),
        idempotencyKey: "repository-listing-concurrent-0001",
        requestHash: "f".repeat(64),
      });
      const second = { ...first, id: randomUUID(), requestId: randomUUID() };
      const createResults = await Promise.all([
        repository.createDraft(first),
        repository.createDraft(second),
      ]);
      const listingId = createResults.find((result) => "listing" in result)?.listing.id;
      if (!listingId) throw new Error("Concurrent Listing create did not produce a row");
      const updateFields = writeFields(fixture, "Concurrent conditional update");
      const updateResults = await Promise.all([
        repository.updateDraft({
          ...updateFields,
          actorUserId: fixture.ownerId,
          listingId,
          expectedVersion: 1,
          requestId: randomUUID(),
          occurredAt: new Date(baseTime.getTime() + 1_000),
        }),
        repository.updateDraft({
          ...updateFields,
          title: "Losing concurrent conditional update",
          actorUserId: fixture.ownerId,
          listingId,
          expectedVersion: 1,
          requestId: randomUUID(),
          occurredAt: new Date(baseTime.getTime() + 2_000),
        }),
      ]);

      expect(createResults.map((result) => result.kind).sort()).toEqual(["created", "exact_retry"]);
      expect(updateResults.map((result) => result.kind).sort()).toEqual([
        "updated",
        "version_conflict",
      ]);
      await expect(
        database.client.listing.count({
          where: {
            ownerId: fixture.ownerId,
            createIdempotencyKey: "repository-listing-concurrent-0001",
          },
        }),
      ).resolves.toBe(1);
      await expect(
        database.client.auditLog.count({ where: { targetId: listingId } }),
      ).resolves.toBe(2);
      await expect(
        database.client.outboxEvent.count({ where: { aggregateId: listingId } }),
      ).resolves.toBe(2);
    } finally {
      await repository.close();
      const listingIds = await database.client.listing.findMany({
        where: { ownerId: fixture.ownerId },
        select: { id: true },
      });
      const ids = listingIds.map((listing) => listing.id);
      await database.client.outboxEvent.deleteMany({ where: { aggregateId: { in: ids } } });
      await database.client.auditLog.deleteMany({ where: { targetId: { in: ids } } });
      await database.client.listing.deleteMany({ where: { id: { in: ids } } });
      await database.client.$transaction(async (transaction) => {
        await transaction.$executeRawUnsafe("SET LOCAL session_replication_role = replica");
        await transaction.categoryFormSchemaVersion.deleteMany({
          where: { categoryId: fixture.categoryId },
        });
      });
      await database.client.category.deleteMany({ where: { id: fixture.categoryId } });
      await database.client.region.deleteMany({ where: { id: fixture.regionId } });
      await database.client.user.deleteMany({ where: { id: fixture.ownerId } });
    }
  });
});
