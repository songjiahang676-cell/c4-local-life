import { PrismaPg } from "@prisma/adapter-pg";
import {
  ContentStatus,
  MediaKind,
  MediaPurpose,
  MediaStatus,
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
  mediaIds: readonly string[];
  jobDetail: {
    employerName: string;
    employmentType: string;
    wageMin: string;
    wageMax: string;
    wageUnit: PriceUnit;
    experienceLevel: string | null;
    remoteType: string | null;
    visaSupport: boolean | null;
  } | null;
  transferDetail: {
    businessType: string;
    askingPrice: string;
    monthlyRent: string;
    leaseRemainingMonths: number;
    reasonForTransfer: string;
    includesInventory: boolean | null;
  } | null;
  secondhandDetail: {
    condition: string;
    brand: string | null;
    model: string | null;
    deliveryOptions: readonly string[];
  } | null;
  serviceDetail: {
    serviceRadiusMiles: number;
    licenseNumber: string | null;
    insured: boolean | null;
    emergencyService: boolean | null;
    availability: readonly string[];
  } | null;
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
        | "actor_unavailable"
        | "idempotency_conflict"
        | "invalid_media"
        | "invalid_organization"
        | "invalid_reference";
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
        | "invalid_media"
        | "invalid_reference"
        | "not_found"
        | "state_conflict"
        | "time_conflict"
        | "version_conflict";
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

function asJsonArray(value: readonly ListingDraftJsonValue[]): Prisma.InputJsonArray {
  return [...value] as Prisma.InputJsonArray;
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

async function validateReadyMediaBindings(
  transaction: Prisma.TransactionClient,
  input: {
    actorUserId: string;
    listingId: string;
    mediaIds: readonly string[];
  },
): Promise<boolean> {
  if (new Set(input.mediaIds).size !== input.mediaIds.length) return false;
  if (input.mediaIds.length > 0) {
    const orderedIds = [...input.mediaIds].sort();
    await transaction.$queryRaw(
      Prisma.sql`SELECT "id"::text
        FROM "media_assets"
        WHERE "id" IN (${Prisma.join(orderedIds.map((id) => Prisma.sql`${id}::uuid`))})
        ORDER BY "id"
        FOR UPDATE`,
    );
  }
  const assets =
    input.mediaIds.length === 0
      ? []
      : await transaction.mediaAsset.findMany({
          where: { id: { in: [...input.mediaIds] } },
          select: {
            id: true,
            ownerId: true,
            listingId: true,
            purpose: true,
            kind: true,
            status: true,
          },
        });
  if (assets.length !== input.mediaIds.length) return false;
  const assetsById = new Map(assets.map((asset) => [asset.id, asset]));
  for (const mediaId of input.mediaIds) {
    const asset = assetsById.get(mediaId);
    if (
      !asset ||
      asset.purpose !== MediaPurpose.LISTING_MEDIA ||
      asset.kind !== MediaKind.IMAGE ||
      asset.status !== MediaStatus.READY ||
      (asset.listingId !== null && asset.listingId !== input.listingId) ||
      (asset.listingId === null && asset.ownerId !== input.actorUserId)
    ) {
      return false;
    }
  }

  return true;
}

async function applyMediaBindings(
  transaction: Prisma.TransactionClient,
  input: {
    actorUserId: string;
    listingId: string;
    mediaIds: readonly string[];
  },
): Promise<void> {
  await transaction.mediaAsset.updateMany({
    where: {
      listingId: input.listingId,
      ...(input.mediaIds.length > 0 ? { id: { notIn: [...input.mediaIds] } } : {}),
    },
    data: { listingId: null, sortOrder: 0 },
  });
  for (const [sortOrder, mediaId] of input.mediaIds.entries()) {
    const updated = await transaction.mediaAsset.updateMany({
      where: {
        id: mediaId,
        status: MediaStatus.READY,
        purpose: MediaPurpose.LISTING_MEDIA,
        kind: MediaKind.IMAGE,
        OR: [{ listingId: input.listingId }, { listingId: null, ownerId: input.actorUserId }],
      },
      data: { listingId: input.listingId, sortOrder },
    });
    if (updated.count !== 1) {
      throw new Error("Validated media binding changed inside the Listing transaction");
    }
  }
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

async function applyVerticalDetails(
  transaction: Prisma.TransactionClient,
  listingId: string,
  fields: Pick<
    ListingDraftWriteFields,
    "jobDetail" | "secondhandDetail" | "serviceDetail" | "transferDetail"
  >,
): Promise<void> {
  if (!fields.jobDetail) {
    await transaction.jobDetail.deleteMany({ where: { listingId } });
  } else {
    await transaction.jobDetail.upsert({
      where: { listingId },
      create: { listingId, ...fields.jobDetail },
      update: fields.jobDetail,
    });
  }
  if (!fields.transferDetail) {
    await transaction.transferDetail.deleteMany({ where: { listingId } });
  } else {
    await transaction.transferDetail.upsert({
      where: { listingId },
      create: { listingId, ...fields.transferDetail },
      update: fields.transferDetail,
    });
  }
  if (!fields.secondhandDetail) {
    await transaction.secondhandDetail.deleteMany({ where: { listingId } });
  } else {
    const detail = {
      ...fields.secondhandDetail,
      deliveryOptions: asJsonArray(fields.secondhandDetail.deliveryOptions),
    };
    await transaction.secondhandDetail.upsert({
      where: { listingId },
      create: { listingId, ...detail },
      update: detail,
    });
  }
  if (!fields.serviceDetail) {
    await transaction.serviceDetail.deleteMany({ where: { listingId } });
  } else {
    const detail = {
      ...fields.serviceDetail,
      availability: asJsonArray(fields.serviceDetail.availability),
    };
    await transaction.serviceDetail.upsert({
      where: { listingId },
      create: { listingId, ...detail },
      update: detail,
    });
  }
}

function verticalDetailsMatchListingType(
  type: ListingType,
  fields: Pick<
    ListingDraftWriteFields,
    "jobDetail" | "secondhandDetail" | "serviceDetail" | "transferDetail"
  >,
): boolean {
  const present = [
    fields.jobDetail ? "JOB" : null,
    fields.transferDetail ? "TRANSFER" : null,
    fields.secondhandDetail ? "SECONDHAND" : null,
    fields.serviceDetail ? "SERVICE" : null,
  ].filter((value): value is ListingType => value !== null);
  return type === "RENTAL" ? present.length === 0 : present.length === 1 && present[0] === type;
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

      if (
        !verticalDetailsMatchListingType(input.type, input) ||
        !(await referencesRemainValid(transaction, input.type, input))
      ) {
        return { kind: "invalid_reference" };
      }
      if (
        !(await validateReadyMediaBindings(transaction, {
          actorUserId: input.actorUserId,
          listingId: input.id,
          mediaIds: input.mediaIds,
        }))
      ) {
        return { kind: "invalid_media" };
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
      await applyVerticalDetails(transaction, input.id, input);
      await applyMediaBindings(transaction, {
        actorUserId: input.actorUserId,
        listingId: input.id,
        mediaIds: input.mediaIds,
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
      if (
        !verticalDetailsMatchListingType(current.type, input) ||
        !(await referencesRemainValid(transaction, current.type, input))
      ) {
        return { kind: "invalid_reference" };
      }
      if (
        !(await validateReadyMediaBindings(transaction, {
          actorUserId: input.actorUserId,
          listingId: input.listingId,
          mediaIds: input.mediaIds,
        }))
      ) {
        return { kind: "invalid_media" };
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
      await applyVerticalDetails(transaction, input.listingId, input);
      await applyMediaBindings(transaction, {
        actorUserId: input.actorUserId,
        listingId: input.listingId,
        mediaIds: input.mediaIds,
      });
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
