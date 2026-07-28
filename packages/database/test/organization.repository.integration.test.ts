import { randomUUID } from "node:crypto";
import { MembershipRole, UserStatus, type Prisma } from "../generated/prisma/client";
import { OrganizationRepository } from "../src/repositories/organization.repository";
import {
  createIntegrationDatabase,
  type IntegrationDatabase,
} from "../src/testing/integration-database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const databaseUrl = process.env.DATABASE_INTEGRATION_URL ?? "";
const integration = describe.skipIf(databaseUrl.length === 0);

async function createSubject(
  transaction: Prisma.TransactionClient,
  userId: string,
  displayName: string,
  status: UserStatus = UserStatus.ACTIVE,
): Promise<void> {
  await transaction.user.create({
    data: {
      id: userId,
      email: `${userId}@example.invalid`,
      status,
      profile: {
        create: {
          displayName,
          preferredLocale: "zh-Hans",
        },
      },
    },
  });
}

integration("OrganizationRepository with PostgreSQL", () => {
  let database: IntegrationDatabase;

  beforeAll(() => {
    database = createIntegrationDatabase(databaseUrl);
  });

  afterAll(async () => {
    await database?.close();
  });

  it("atomically creates the organization and its initial OWNER with exact retry semantics", async () => {
    await database.withRollback(async (transaction) => {
      const ownerUserId = randomUUID();
      const foreignUserId = randomUUID();
      const slug = `synthetic-org-${randomUUID()}`;
      await createSubject(transaction, ownerUserId, "Synthetic Owner");
      await createSubject(transaction, foreignUserId, "Foreign Owner");
      const repository = new OrganizationRepository(transaction);
      const input = {
        ownerUserId,
        type: "MERCHANT" as const,
        displayName: "Synthetic Merchant",
        legalName: "Synthetic Merchant LLC",
        slug,
      };

      const created = await repository.createOwned(input);
      const retried = await repository.createOwned(input);
      const changedRetry = await repository.createOwned({
        ...input,
        displayName: "Changed Retry Payload",
      });
      const conflicting = await repository.createOwned({
        ...input,
        ownerUserId: foreignUserId,
      });
      const persisted = await transaction.organization.findUniqueOrThrow({
        where: { slug },
        include: { memberships: true },
      });

      expect(created).toMatchObject({
        kind: "created",
        organization: { slug, role: "OWNER", status: "ACTIVE" },
      });
      expect(retried).toMatchObject({
        kind: "existing",
        organization: { id: persisted.id, role: "OWNER" },
      });
      expect(changedRetry).toEqual({ kind: "slug_conflict" });
      expect(conflicting).toEqual({ kind: "slug_conflict" });
      expect(persisted.memberships).toHaveLength(1);
      expect(persisted.memberships[0]).toMatchObject({
        userId: ownerUserId,
        role: MembershipRole.OWNER,
      });
    });
  });

  it("fails closed when account state changes before the organization transaction", async () => {
    await database.withRollback(async (transaction) => {
      const userId = randomUUID();
      const slug = `suspended-org-${randomUUID()}`;
      await createSubject(transaction, userId, "Suspended User", UserStatus.SUSPENDED);
      const repository = new OrganizationRepository(transaction);

      const result = await repository.createOwned({
        ownerUserId: userId,
        type: "SERVICE_PROVIDER",
        displayName: "Unavailable Organization",
        slug,
      });

      expect(result).toEqual({ kind: "actor_unavailable" });
      expect(await transaction.organization.count({ where: { slug } })).toBe(0);
    });
  });

  it("scopes organization/member reads to a current member and omits contact identifiers", async () => {
    await database.withRollback(async (transaction) => {
      const ownerUserId = randomUUID();
      const adminUserId = randomUUID();
      const analystUserId = randomUUID();
      const outsiderUserId = randomUUID();
      await createSubject(transaction, ownerUserId, "Owner");
      await createSubject(transaction, adminUserId, "Admin");
      await createSubject(transaction, analystUserId, "Analyst");
      await createSubject(transaction, outsiderUserId, "Outsider");
      const organization = await transaction.organization.create({
        data: {
          type: "SUPPLIER",
          displayName: "Synthetic Supplier",
          slug: `synthetic-supplier-${randomUUID()}`,
        },
      });
      const base = new Date("2026-07-28T18:00:00.000Z");
      await transaction.organizationMembership.createMany({
        data: [
          {
            organizationId: organization.id,
            userId: ownerUserId,
            role: "OWNER",
            createdAt: base,
          },
          {
            organizationId: organization.id,
            userId: adminUserId,
            role: "ADMIN",
            createdAt: new Date(base.getTime() + 1_000),
          },
          {
            organizationId: organization.id,
            userId: analystUserId,
            role: "ANALYST",
            createdAt: new Date(base.getTime() + 2_000),
          },
        ],
      });
      const repository = new OrganizationRepository(transaction);

      const visible = await repository.findByIdForMember(ownerUserId, organization.id);
      const hidden = await repository.findByIdForMember(outsiderUserId, organization.id);
      const firstPage = await repository.listMembers({
        actorUserId: ownerUserId,
        organizationId: organization.id,
        limit: 2,
      });
      const secondPage = await repository.listMembers({
        actorUserId: ownerUserId,
        organizationId: organization.id,
        limit: 2,
        cursor: firstPage.nextCursor ?? undefined,
      });
      const outsiderPage = await repository.listMembers({
        actorUserId: outsiderUserId,
        organizationId: organization.id,
        limit: 20,
      });
      const analystPage = await repository.listMembers({
        actorUserId: analystUserId,
        organizationId: organization.id,
        limit: 20,
      });

      expect(visible).toMatchObject({ id: organization.id, role: "OWNER" });
      expect(hidden).toBeNull();
      expect(firstPage.items.map((member) => member.role)).toEqual(["ANALYST", "ADMIN"]);
      expect(secondPage.items.map((member) => member.role)).toEqual(["OWNER"]);
      expect(firstPage.nextCursor).not.toBeNull();
      expect(secondPage.nextCursor).toBeNull();
      expect(outsiderPage).toEqual({ items: [], nextCursor: null });
      expect(analystPage).toEqual({ items: [], nextCursor: null });
      expect(JSON.stringify([firstPage, secondPage])).not.toContain("@example.invalid");
    });
  });
});
