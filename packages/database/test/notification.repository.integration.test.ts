import { randomUUID } from "node:crypto";
import {
  ContentStatus,
  ListingType,
  ModerationStatus,
  RegionType,
  UserStatus,
  type Prisma,
} from "../generated/prisma/client";
import {
  NotificationRepository,
  type ListingNotificationEventInput,
} from "../src/repositories/notification.repository";
import {
  createIntegrationDatabase,
  type IntegrationDatabase,
} from "../src/testing/integration-database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const databaseUrl = process.env.DATABASE_INTEGRATION_URL ?? "";
const integration = describe.skipIf(databaseUrl.length === 0);

type NotificationFixture = {
  categoryId: string;
  listingId: string;
  regionId: string;
  userId: string;
};

async function createFixture(
  database: IntegrationDatabase,
  locale: "zh-Hans" | "en-US",
  status: UserStatus = UserStatus.ACTIVE,
): Promise<NotificationFixture> {
  const fixture = {
    categoryId: randomUUID(),
    listingId: randomUUID(),
    regionId: randomUUID(),
    userId: randomUUID(),
  };
  await database.client.$transaction(async (transaction) => {
    await transaction.user.create({
      data: {
        id: fixture.userId,
        email: `${fixture.userId}@example.invalid`,
        status,
        profile: {
          create: {
            displayName: "Synthetic Notification Owner",
            preferredLocale: locale,
          },
        },
      },
    });
    await transaction.region.create({
      data: {
        id: fixture.regionId,
        code: `TEST-NOTIFICATION-${fixture.regionId}`,
        type: RegionType.CITY,
        slug: `notification-region-${fixture.regionId}`,
        nameZhHans: "测试通知城市",
        nameEn: "Synthetic Notification City",
      },
    });
    await transaction.category.create({
      data: {
        id: fixture.categoryId,
        vertical: ListingType.RENTAL,
        slug: `notification-category-${fixture.categoryId}`,
        nameZhHans: "测试通知分类",
        nameEn: "Synthetic Notification Rentals",
      },
    });
    await transaction.listing.create({
      data: {
        id: fixture.listingId,
        type: ListingType.RENTAL,
        ownerId: fixture.userId,
        categoryId: fixture.categoryId,
        regionId: fixture.regionId,
        status: ContentStatus.PUBLISHED,
        moderationStatus: ModerationStatus.APPROVED,
        locale,
        title: "Synthetic notification source listing",
        slug: `notification-listing-${fixture.listingId}`,
        body: "Synthetic integration fixture; never a real advertisement.",
        publishedAt: new Date("2026-07-30T00:00:00.000Z"),
        expiresAt: new Date("2026-08-30T00:00:00.000Z"),
        version: 8,
      },
    });
  });
  return fixture;
}

async function removeFixture(
  database: IntegrationDatabase,
  fixture: NotificationFixture,
): Promise<void> {
  await database.client.$transaction(async (transaction) => {
    await transaction.notification.deleteMany({ where: { userId: fixture.userId } });
    await transaction.listing.deleteMany({ where: { id: fixture.listingId } });
    await transaction.category.deleteMany({ where: { id: fixture.categoryId } });
    await transaction.user.deleteMany({ where: { id: fixture.userId } });
    await transaction.region.deleteMany({ where: { id: fixture.regionId } });
  });
}

function event(
  fixture: NotificationFixture,
  overrides: Partial<ListingNotificationEventInput> = {},
): ListingNotificationEventInput {
  return {
    eventId: randomUUID(),
    eventType: "listing.published",
    listingId: fixture.listingId,
    aggregateVersion: 4,
    occurredAt: new Date("2026-07-30T04:00:00.000Z"),
    ...overrides,
  };
}

integration("NotificationRepository with PostgreSQL", () => {
  let database: IntegrationDatabase;
  const fixtures: NotificationFixture[] = [];

  beforeAll(() => {
    database = createIntegrationDatabase(databaseUrl);
  });

  afterAll(async () => {
    for (const fixture of fixtures.reverse()) {
      await removeFixture(database, fixture);
    }
    await database?.close();
  });

  it("creates one bilingual-safe snapshot under concurrent duplicate delivery", async () => {
    const fixture = await createFixture(database, "zh-Hans");
    fixtures.push(fixture);
    const firstRepository = new NotificationRepository({
      connectionString: databaseUrl,
      poolMaximum: 2,
    });
    const secondRepository = new NotificationRepository({
      connectionString: databaseUrl,
      poolMaximum: 2,
    });
    const input = event(fixture);
    try {
      const results = await Promise.all([
        firstRepository.consumeListingEvent(input),
        secondRepository.consumeListingEvent(input),
      ]);
      const stored = await database.client.notification.findMany({
        where: { sourceEventId: input.eventId, userId: fixture.userId },
      });

      expect(results.map((result) => result.kind).sort()).toEqual(["created", "existing"]);
      expect(stored).toHaveLength(1);
      expect(stored[0]).toMatchObject({
        channel: "IN_APP",
        templateKey: "listing.status.published",
        templateVersion: 1,
        locale: "zh-Hans",
        status: "SENT",
        resourceType: "LISTING",
        resourceId: fixture.listingId,
        sourceEventId: input.eventId,
        aggregateVersion: 4,
        payload: { resourceId: fixture.listingId, aggregateVersion: 4 },
      });
      expect(stored[0]?.title).not.toContain("Synthetic notification source");
      expect(JSON.stringify(stored[0]?.payload)).not.toContain("@example.invalid");
    } finally {
      await firstRepository.close();
      await secondRepository.close();
    }
  });

  it("filters submitted events, preserves occurrence ordering, scopes reads, and localizes", async () => {
    const fixture = await createFixture(database, "en-US");
    const foreign = await createFixture(database, "zh-Hans", UserStatus.LIMITED);
    fixtures.push(fixture, foreign);
    const repository = new NotificationRepository({
      connectionString: databaseUrl,
      poolMaximum: 2,
    });
    try {
      const low = await repository.consumeListingEvent(
        event(fixture, {
          eventType: "listing.submitted",
          aggregateVersion: 2,
          riskTier: "LOW",
        }),
      );
      const medium = await repository.consumeListingEvent(
        event(fixture, {
          eventType: "listing.submitted",
          aggregateVersion: 2,
          occurredAt: new Date("2026-07-30T02:00:00.000Z"),
          riskTier: "MEDIUM",
        }),
      );
      const published = await repository.consumeListingEvent(
        event(fixture, {
          aggregateVersion: 3,
          occurredAt: new Date("2026-07-30T03:00:00.000Z"),
        }),
      );
      const archived = await repository.consumeListingEvent(
        event(fixture, {
          eventType: "listing.archived",
          aggregateVersion: 4,
          occurredAt: new Date("2026-07-30T01:00:00.000Z"),
        }),
      );
      const firstPage = await repository.listInApp({
        userId: fixture.userId,
        unreadOnly: false,
        limit: 2,
      });
      const secondPage = await repository.listInApp({
        userId: fixture.userId,
        unreadOnly: false,
        limit: 2,
        cursor: firstPage.nextCursor ?? undefined,
      });

      expect(low).toEqual({ kind: "ignored" });
      expect([medium.kind, published.kind, archived.kind]).toEqual([
        "created",
        "created",
        "created",
      ]);
      expect(firstPage.items.map((item) => item.templateKey)).toEqual([
        "listing.status.published",
        "listing.status.submitted",
      ]);
      expect(firstPage.items.every((item) => item.locale === "en-US")).toBe(true);
      expect(firstPage.items[0]?.title).toBe("Listing published");
      expect(firstPage.unreadCount).toBe(3);
      expect(secondPage.items.map((item) => item.templateKey)).toEqual(["listing.status.archived"]);
      const notificationId = firstPage.items[0]?.id ?? "";
      const foreignRead = await repository.markInAppRead({
        userId: foreign.userId,
        notificationId,
        readAt: new Date("2026-07-30T05:00:00.000Z"),
      });
      const read = await repository.markInAppRead({
        userId: fixture.userId,
        notificationId,
        readAt: new Date("2026-07-30T05:00:00.000Z"),
      });
      const retried = await repository.markInAppRead({
        userId: fixture.userId,
        notificationId,
        readAt: new Date("2026-07-30T06:00:00.000Z"),
      });

      expect(foreignRead).toBeNull();
      expect(read).toMatchObject({
        id: notificationId,
        status: "READ",
        readAt: new Date("2026-07-30T05:00:00.000Z"),
      });
      expect(retried?.readAt).toEqual(read?.readAt);
      expect(
        (
          await repository.listInApp({
            userId: fixture.userId,
            unreadOnly: true,
            limit: 10,
          })
        ).unreadCount,
      ).toBe(2);
    } finally {
      await repository.close();
    }
  });

  it("rejects mutation and deletion of published template versions", async () => {
    await database.withRollback(async (transaction: Prisma.TransactionClient) => {
      await expect(
        transaction.notificationTemplate.update({
          where: { id: "4f000000-0000-4000-8000-000000000004" },
          data: { title: "Changed title" },
        }),
      ).rejects.toThrow(/immutable/i);
    });
    await database.withRollback(async (transaction: Prisma.TransactionClient) => {
      await expect(
        transaction.notificationTemplate.delete({
          where: { id: "4f000000-0000-4000-8000-000000000004" },
        }),
      ).rejects.toThrow(/immutable/i);
    });
  });
});
