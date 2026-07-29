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

  it("persists invitation evidence, exact retries, membership versions, and atomic Owner transfer", async () => {
    await database.withRollback(async (transaction) => {
      const ownerUserId = randomUUID();
      const inviteeUserId = randomUUID();
      const secondMemberUserId = randomUUID();
      const expiredInviteeUserId = randomUUID();
      await createSubject(transaction, ownerUserId, "Lifecycle Owner");
      await createSubject(transaction, inviteeUserId, "Invited Editor");
      await createSubject(transaction, secondMemberUserId, "Transfer Target");
      await createSubject(transaction, expiredInviteeUserId, "Expired Invitee");
      const repository = new OrganizationRepository(transaction);
      const createdOrganization = await repository.createOwned({
        ownerUserId,
        type: "MERCHANT",
        displayName: "Lifecycle Organization",
        slug: `lifecycle-org-${randomUUID()}`,
      });
      if (createdOrganization.kind !== "created" && createdOrganization.kind !== "existing") {
        throw new Error("Organization fixture was not created");
      }
      const organizationId = createdOrganization.organization.id;
      await transaction.organizationMembership.create({
        data: {
          organizationId,
          userId: secondMemberUserId,
          role: "EDITOR",
        },
      });
      const now = new Date("2026-07-30T02:00:00.000Z");
      const invitationInput = {
        actorUserId: ownerUserId,
        organizationId,
        inviteeUserId,
        role: "EDITOR" as const,
        idempotencyKey: "repository-invite-0001",
        requestHash: "a".repeat(64),
        requestId: randomUUID(),
        now,
        expiresAt: new Date(now.getTime() + 72 * 60 * 60 * 1_000),
      };
      const expiredInvitation = await repository.createInvitation({
        ...invitationInput,
        inviteeUserId: expiredInviteeUserId,
        idempotencyKey: "repository-invite-expired-0001",
        requestHash: "d".repeat(64),
        now: new Date(now.getTime() - 4 * 24 * 60 * 60 * 1_000),
        expiresAt: new Date(now.getTime() - 24 * 60 * 60 * 1_000),
      });

      const invited = await repository.createInvitation(invitationInput);
      const invitedRetry = await repository.createInvitation(invitationInput);
      const changedRetry = await repository.createInvitation({
        ...invitationInput,
        requestHash: "b".repeat(64),
      });
      if (invited.kind !== "created") throw new Error("Invitation fixture was not created");
      const wrongActor = await repository.acceptInvitation({
        actorUserId: secondMemberUserId,
        invitationId: invited.invitation.id,
        requestId: randomUUID(),
        now,
      });
      const accepted = await repository.acceptInvitation({
        actorUserId: inviteeUserId,
        invitationId: invited.invitation.id,
        requestId: randomUUID(),
        now,
      });
      const acceptedRetry = await repository.acceptInvitation({
        actorUserId: inviteeUserId,
        invitationId: invited.invitation.id,
        requestId: randomUUID(),
        now,
      });
      const expiredAccepted =
        expiredInvitation.kind === "created"
          ? await repository.acceptInvitation({
              actorUserId: expiredInviteeUserId,
              invitationId: expiredInvitation.invitation.id,
              requestId: randomUUID(),
              now,
            })
          : null;
      const roleChanged = await repository.changeMemberRole({
        actorUserId: ownerUserId,
        organizationId,
        targetUserId: inviteeUserId,
        role: "ANALYST",
        expectedVersion: 1,
        requestId: randomUUID(),
        now,
      });
      const staleRoleChange = await repository.changeMemberRole({
        actorUserId: ownerUserId,
        organizationId,
        targetUserId: inviteeUserId,
        role: "BILLING",
        expectedVersion: 1,
        requestId: randomUUID(),
        now,
      });
      const staleRemoval = await repository.removeMember({
        actorUserId: ownerUserId,
        organizationId,
        targetUserId: inviteeUserId,
        expectedVersion: 1,
        requestId: randomUUID(),
        now,
      });
      const removed = await repository.removeMember({
        actorUserId: ownerUserId,
        organizationId,
        targetUserId: inviteeUserId,
        expectedVersion: 2,
        requestId: randomUUID(),
        now,
      });
      const transferInput = {
        actorUserId: ownerUserId,
        organizationId,
        targetUserId: secondMemberUserId,
        idempotencyKey: "repository-owner-transfer-0001",
        requestHash: "c".repeat(64),
        requestId: randomUUID(),
        now,
      };
      const transferred = await repository.transferOwnership(transferInput);
      const transferRetry = await repository.transferOwnership(transferInput);
      const owners = await transaction.organizationMembership.count({
        where: { organizationId, role: "OWNER" },
      });
      const evidence = await transaction.outboxEvent.findMany({
        where: { aggregateId: { in: [organizationId, invited.invitation.id] } },
        select: { eventType: true, payload: true },
      });

      expect(invitedRetry).toMatchObject({
        kind: "existing",
        invitation: { id: invited.invitation.id },
      });
      expect(changedRetry).toEqual({ kind: "idempotency_conflict" });
      expect(wrongActor).toEqual({ kind: "not_found" });
      expect(accepted).toMatchObject({ kind: "accepted", invitation: { status: "ACCEPTED" } });
      expect(acceptedRetry).toMatchObject({
        kind: "existing",
        invitation: { status: "ACCEPTED" },
      });
      expect(expiredAccepted).toEqual({ kind: "expired" });
      expect(roleChanged).toMatchObject({
        kind: "updated",
        member: { role: "ANALYST", version: 2 },
      });
      expect(staleRoleChange).toEqual({ kind: "conflict" });
      expect(staleRemoval).toEqual({ kind: "conflict" });
      expect(removed).toEqual({ kind: "removed" });
      expect(transferred).toMatchObject({
        kind: "transferred",
        transfer: {
          fromUserId: ownerUserId,
          toUserId: secondMemberUserId,
          fromRoleAfter: "ADMIN",
          toRoleAfter: "OWNER",
        },
      });
      expect(transferRetry).toMatchObject({
        kind: "existing",
        transfer: { id: transferred.kind === "transferred" ? transferred.transfer.id : "" },
      });
      expect(owners).toBe(1);
      expect(evidence.map((event) => event.eventType)).toEqual(
        expect.arrayContaining([
          "organization.invitation.created",
          "organization.invitation.accepted",
          "organization.member.role.changed",
          "organization.membership.removed",
          "organization.owner.transferred",
        ]),
      );
      expect(JSON.stringify(evidence)).not.toContain("@example.invalid");
    });
  });

  it("enforces the deferred invariant that every organization retains an Owner", async () => {
    const ownerUserId = randomUUID();
    const organizationId = randomUUID();
    await expect(
      database.client.$transaction(async (transaction) => {
        await createSubject(transaction, ownerUserId, "Constraint Owner");
        await transaction.organization.create({
          data: {
            id: organizationId,
            type: "MERCHANT",
            displayName: "Constraint Organization",
            slug: `constraint-org-${randomUUID()}`,
            memberships: {
              create: {
                userId: ownerUserId,
                role: "OWNER",
              },
            },
          },
        });
        await transaction.organizationMembership.delete({
          where: {
            organizationId_userId: { organizationId, userId: ownerUserId },
          },
        });
      }),
    ).rejects.toThrow();
    expect(await database.client.organization.count({ where: { id: organizationId } })).toBe(0);
  });
});
