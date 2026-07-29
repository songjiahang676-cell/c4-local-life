import { PrismaPg } from "@prisma/adapter-pg";
import {
  ContentStatus,
  MembershipRole,
  ModerationStatus,
  Prisma,
  PrismaClient,
  UserStatus,
  type ContactMode,
  type ListingType,
  type PriceUnit,
} from "../../generated/prisma/client";
import { ListingRepository, type OwnerListingProjection } from "./listing.repository";

export type ListingDraftRepositoryOptions = {
  connectionString: string;
  poolMaximum?: number;
};

export type ListingDraftJsonValue =
  | boolean
  | number
  | string
  | null
  | ListingDraftJsonValue[]
  | { [key: string]: ListingDraftJsonValue };

export type ListingDraftReferences = {
  categoryId: string;
  formSchemaVersion: number;
  regionId: string;
};

export type ResolveListingDraftReferencesInput = {
  type: ListingType;
  categoryId: string;
  regionCode: string;
  formSchemaVersion?: number;
};

export type ListingDraftWriteFields = {
  categoryId: string;
  formSchemaVersion: number;
  regionId: string;
  locale: string;
  title: string;
  slug: string;
  summary: string | null;
  body: string;
  priceAmount: string | null;
  currency: string;
  priceUnit: PriceUnit | null;
  contactMode: ContactMode;
  attributes: Record<string, ListingDraftJsonValue>;
  latitude: string | null;
  longitude: string | null;
  locationPrecision: string;
};

export type CreateListingDraftInput = ListingDraftWriteFields & {
  id: string;
  actorUserId: string;
  organizationId: string | null;
  type: ListingType;
  idempotencyKey: string;
  requestHash: string;
  requestId: string;
  occurredAt: Date;
};

export type CreateListingDraftResult =
  | { kind: "created" | "exact_retry"; listing: OwnerListingProjection }
  | {
      kind:
        "actor_unavailable" | "idempotency_conflict" | "invalid_organization" | "invalid_reference";
    };

export type FindListingDraftCreateRetryInput = {
  actorUserId: string;
  idempotencyKey: string;
  requestHash: string;
  now: Date;
};

export type FindListingDraftCreateRetryResult =
  { kind: "exact_retry"; listing: OwnerListingProjection } | { kind: "conflict" | "missing" };

export type UpdateListingDraftInput = ListingDraftWriteFields & {
  actorUserId: string;
  listingId: string;
  expectedVersion: number;
  requestId: string;
  occurredAt: Date;
};

export type UpdateListingDraftResult =
  | { kind: "updated"; listing: OwnerListingProjection }
  | {
      kind:
        "invalid_reference" | "not_found" | "state_conflict" | "time_conflict" | "version_conflict";
      currentVersion?: number;
    };

type ListingClient = PrismaClient | Prisma.TransactionClient;

const organizationListingRoles = [
  MembershipRole.OWNER,
  MembershipRole.ADMIN,
  MembershipRole.EDITOR,
] as const;

function isRepositoryOptions(
  target: ListingClient | ListingDraftRepositoryOptions,
): target is ListingDraftRepositoryOptions {
  return "connectionString" in target;
}

function asJsonInput(value: Record<string, ListingDraftJsonValue>): Prisma.InputJsonObject {
  return value as Prisma.InputJsonObject;
}

async function lockIdempotencyKey(
  transaction: Prisma.TransactionClient,
  actorUserId: string,
  idempotencyKey: string,
): Promise<void> {
  await transaction.$executeRaw(
    Prisma.sql`SELECT pg_advisory_xact_lock(
      hashtextextended(${"listing-draft-create-v1"} || ':' || ${actorUserId} || ':' || ${idempotencyKey}, 0)
    )`,
  );
}

async function lockListing(
  transaction: Prisma.TransactionClient,
  listingId: string,
): Promise<boolean> {
  const rows = await transaction.$queryRaw<Array<{ id: string }>>(
    Prisma.sql`SELECT "id" FROM "listings" WHERE "id" = ${listingId}::uuid FOR UPDATE`,
  );
  return rows.length === 1;
}

async function activeActor(
  transaction: Prisma.TransactionClient,
  actorUserId: string,
): Promise<boolean> {
  const actor = await transaction.user.findFirst({
    where: {
      id: actorUserId,
      status: UserStatus.ACTIVE,
      deletedAt: null,
    },
    select: { id: true },
  });
  return actor !== null;
}

async function activeOrganizationWriter(
  transaction: Prisma.TransactionClient,
  actorUserId: string,
  organizationId: string,
): Promise<boolean> {
  const organization = await transaction.organization.findFirst({
    where: {
      id: organizationId,
      status: UserStatus.ACTIVE,
      deletedAt: null,
      memberships: {
        some: {
          userId: actorUserId,
          role: { in: [...organizationListingRoles] },
          user: {
            is: {
              status: UserStatus.ACTIVE,
              deletedAt: null,
            },
          },
        },
      },
    },
    select: { id: true },
  });
  return organization !== null;
}

async function referencesRemainValid(
  transaction: Prisma.TransactionClient,
  type: ListingType,
  fields: Pick<ListingDraftWriteFields, "categoryId" | "formSchemaVersion" | "regionId">,
): Promise<boolean> {
  const category = await transaction.category.findFirst({
    where: {
      id: fields.categoryId,
      vertical: type,
      isActive: true,
    },
    select: { id: true },
  });
  const region = await transaction.region.findFirst({
    where: { id: fields.regionId, isActive: true },
    select: { id: true },
  });
  const formSchema = await transaction.categoryFormSchemaVersion.findFirst({
    where: {
      categoryId: fields.categoryId,
      version: fields.formSchemaVersion,
      publishedAt: { not: null },
    },
    select: { id: true },
  });
  return Boolean(category && region && formSchema);
}

function listingData(
  fields: ListingDraftWriteFields,
): Pick<
  Prisma.ListingUncheckedCreateInput,
  | "attributes"
  | "body"
  | "categoryId"
  | "contactMode"
  | "currency"
  | "formSchemaVersion"
  | "latitude"
  | "locale"
  | "locationPrecision"
  | "longitude"
  | "priceAmount"
  | "priceUnit"
  | "regionId"
  | "slug"
  | "summary"
  | "title"
> {
  return {
    categoryId: fields.categoryId,
    formSchemaVersion: fields.formSchemaVersion,
    regionId: fields.regionId,
    locale: fields.locale,
    title: fields.title,
    slug: fields.slug,
    summary: fields.summary,
    body: fields.body,
    priceAmount: fields.priceAmount,
    currency: fields.currency,
    priceUnit: fields.priceUnit,
    contactMode: fields.contactMode,
    attributes: asJsonInput(fields.attributes),
    latitude: fields.latitude,
    longitude: fields.longitude,
    locationPrecision: fields.locationPrecision,
  };
}

async function appendDraftEvidence(
  transaction: Prisma.TransactionClient,
  input: {
    action: "listing.draft.created" | "listing.draft.updated";
    actorUserId: string;
    listingId: string;
    requestId: string;
    type: ListingType;
    version: number;
    organizationScoped: boolean;
  },
): Promise<void> {
  await transaction.auditLog.create({
    data: {
      actorId: input.actorUserId,
      actorType: "USER",
      action: input.action,
      targetType: "LISTING",
      targetId: input.listingId,
      requestId: input.requestId,
      metadata: {
        version: input.version,
        status: ContentStatus.DRAFT,
        organizationScoped: input.organizationScoped,
      },
    },
  });
  await transaction.outboxEvent.create({
    data: {
      aggregateType: "LISTING",
      aggregateId: input.listingId,
      eventType: input.action,
      payload: {
        schemaVersion: 1,
        aggregateVersion: input.version,
        listingId: input.listingId,
        type: input.type,
        status: ContentStatus.DRAFT,
      },
    },
  });
}

export class ListingDraftRepository {
  readonly #client: ListingClient;
  readonly #ownedClient: PrismaClient | null;

  constructor(target: ListingClient | ListingDraftRepositoryOptions) {
    if (isRepositoryOptions(target)) {
      const adapter = new PrismaPg({
        connectionString: target.connectionString,
        max: target.poolMaximum ?? 10,
      });
      this.#ownedClient = new PrismaClient({ adapter });
      this.#client = this.#ownedClient;
      return;
    }
    this.#client = target;
    this.#ownedClient = null;
  }

  async resolveReferences(
    input: ResolveListingDraftReferencesInput,
  ): Promise<ListingDraftReferences | null> {
    const category = await this.#client.category.findFirst({
      where: {
        id: input.categoryId,
        vertical: input.type,
        isActive: true,
      },
      select: { id: true, formSchemaVersion: true },
    });
    const region = await this.#client.region.findFirst({
      where: { code: input.regionCode, isActive: true },
      select: { id: true },
    });
    if (!category || !region) return null;
    const formSchemaVersion = input.formSchemaVersion ?? category.formSchemaVersion;
    const formSchema = await this.#client.categoryFormSchemaVersion.findFirst({
      where: {
        categoryId: category.id,
        version: formSchemaVersion,
        publishedAt: { not: null },
      },
      select: { id: true },
    });
    return formSchema
      ? {
          categoryId: category.id,
          formSchemaVersion,
          regionId: region.id,
        }
      : null;
  }

  async findCreateRetry(
    input: FindListingDraftCreateRetryInput,
  ): Promise<FindListingDraftCreateRetryResult> {
    const existing = await this.#client.listing.findUnique({
      where: {
        ownerId_createIdempotencyKey: {
          ownerId: input.actorUserId,
          createIdempotencyKey: input.idempotencyKey,
        },
      },
      select: {
        id: true,
        createRequestHash: true,
        deletedAt: true,
      },
    });
    if (!existing) return { kind: "missing" };
    if (existing.createRequestHash !== input.requestHash || existing.deletedAt !== null) {
      return { kind: "conflict" };
    }
    const listing = await new ListingRepository(this.#client).findByIdForOwner({
      actorUserId: input.actorUserId,
      listingId: existing.id,
      now: input.now,
    });
    return listing ? { kind: "exact_retry", listing } : { kind: "conflict" };
  }

  createDraft(input: CreateListingDraftInput): Promise<CreateListingDraftResult> {
    return this.#inTransaction(async (transaction) => {
      await lockIdempotencyKey(transaction, input.actorUserId, input.idempotencyKey);
      if (!(await activeActor(transaction, input.actorUserId))) {
        return { kind: "actor_unavailable" };
      }
      if (
        input.organizationId &&
        !(await activeOrganizationWriter(transaction, input.actorUserId, input.organizationId))
      ) {
        return { kind: "invalid_organization" };
      }

      const existing = await transaction.listing.findUnique({
        where: {
          ownerId_createIdempotencyKey: {
            ownerId: input.actorUserId,
            createIdempotencyKey: input.idempotencyKey,
          },
        },
        select: {
          id: true,
          createRequestHash: true,
          deletedAt: true,
        },
      });
      if (existing) {
        if (existing.createRequestHash !== input.requestHash || existing.deletedAt !== null) {
          return { kind: "idempotency_conflict" };
        }
        const listing = await new ListingRepository(transaction).findByIdForOwner({
          actorUserId: input.actorUserId,
          listingId: existing.id,
          now: input.occurredAt,
        });
        return listing ? { kind: "exact_retry", listing } : { kind: "idempotency_conflict" };
      }

      if (!(await referencesRemainValid(transaction, input.type, input))) {
        return { kind: "invalid_reference" };
      }
      await transaction.listing.create({
        data: {
          ...listingData(input),
          id: input.id,
          type: input.type,
          ownerId: input.actorUserId,
          organizationId: input.organizationId,
          status: ContentStatus.DRAFT,
          moderationStatus: ModerationStatus.NOT_REVIEWED,
          createIdempotencyKey: input.idempotencyKey,
          createRequestHash: input.requestHash,
          createdAt: input.occurredAt,
          updatedAt: input.occurredAt,
        },
        select: { id: true },
      });
      await appendDraftEvidence(transaction, {
        action: "listing.draft.created",
        actorUserId: input.actorUserId,
        listingId: input.id,
        requestId: input.requestId,
        type: input.type,
        version: 1,
        organizationScoped: input.organizationId !== null,
      });
      const listing = await new ListingRepository(transaction).findByIdForOwner({
        actorUserId: input.actorUserId,
        listingId: input.id,
        now: input.occurredAt,
      });
      if (!listing) throw new Error("Created Listing draft could not be projected");
      return { kind: "created", listing };
    });
  }

  updateDraft(input: UpdateListingDraftInput): Promise<UpdateListingDraftResult> {
    return this.#inTransaction(async (transaction) => {
      if (!(await lockListing(transaction, input.listingId))) return { kind: "not_found" };
      const current = await transaction.listing.findUnique({
        where: { id: input.listingId },
        select: {
          id: true,
          type: true,
          ownerId: true,
          organizationId: true,
          status: true,
          deletedAt: true,
          updatedAt: true,
          version: true,
        },
      });
      if (!current || current.deletedAt !== null) return { kind: "not_found" };
      if (!(await activeActor(transaction, input.actorUserId))) return { kind: "not_found" };
      const authorized = current.organizationId
        ? await activeOrganizationWriter(transaction, input.actorUserId, current.organizationId)
        : current.ownerId === input.actorUserId;
      if (!authorized) return { kind: "not_found" };
      if (current.version !== input.expectedVersion) {
        return { kind: "version_conflict", currentVersion: current.version };
      }
      if (current.status !== ContentStatus.DRAFT) {
        return { kind: "state_conflict", currentVersion: current.version };
      }
      if (input.occurredAt < current.updatedAt) {
        return { kind: "time_conflict", currentVersion: current.version };
      }
      if (!(await referencesRemainValid(transaction, current.type, input))) {
        return { kind: "invalid_reference" };
      }

      const updated = await transaction.listing.updateMany({
        where: {
          id: input.listingId,
          version: input.expectedVersion,
          status: ContentStatus.DRAFT,
          deletedAt: null,
        },
        data: {
          ...listingData(input),
          version: { increment: 1 },
          updatedAt: input.occurredAt,
        },
      });
      if (updated.count !== 1) {
        return { kind: "version_conflict", currentVersion: current.version };
      }
      const version = current.version + 1;
      await appendDraftEvidence(transaction, {
        action: "listing.draft.updated",
        actorUserId: input.actorUserId,
        listingId: input.listingId,
        requestId: input.requestId,
        type: current.type,
        version,
        organizationScoped: current.organizationId !== null,
      });
      const listing = await new ListingRepository(transaction).findByIdForOwner({
        actorUserId: input.actorUserId,
        listingId: input.listingId,
        now: input.occurredAt,
      });
      if (!listing) throw new Error("Updated Listing draft could not be projected");
      return { kind: "updated", listing };
    });
  }

  close(): Promise<void> {
    return this.#ownedClient?.$disconnect() ?? Promise.resolve();
  }

  #inTransaction<T>(operation: (transaction: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    if (this.#ownedClient) {
      return this.#ownedClient.$transaction(operation, {
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      });
    }
    return operation(this.#client as Prisma.TransactionClient);
  }
}
