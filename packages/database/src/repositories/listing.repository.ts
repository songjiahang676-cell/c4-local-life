import { PrismaPg } from "@prisma/adapter-pg";
import { z } from "zod";
import {
  ContentStatus,
  MembershipRole,
  ModerationStatus,
  PlatformRole,
  Prisma,
  PrismaClient,
  UserStatus,
  type Category,
  type ContactMode,
  type ListingType,
  type PriceUnit,
  type RegionType,
  type VerificationStatus,
} from "../../generated/prisma/client";

export type ListingRepositoryOptions = {
  connectionString: string;
  poolMaximum?: number;
};

export type ListingPriceProjection = {
  amount: string | null;
  currency: string;
  unit: PriceUnit | null;
};

export type ListingRegionProjection = {
  id: string;
  type: RegionType;
  code: string;
  slug: string;
  nameZhHans: string;
  nameEn: string;
  timezone: string;
};

export type ListingCategoryProjection = {
  id: string;
  vertical: ListingType | null;
  slug: string;
  nameZhHans: string;
  nameEn: string;
};

export type ListingOwnerSummaryProjection = {
  id: string;
  displayName: string;
  avatarUrl: string | null;
};

export type ListingOrganizationSummaryProjection = {
  id: string;
  displayName: string;
  slug: string;
  verificationStatus: VerificationStatus;
};

export type ListingLocationProjection = {
  precision: string;
  point?: {
    latitude: string;
    longitude: string;
  };
};

export type PublicListingProjection = {
  id: string;
  type: ListingType;
  status: typeof ContentStatus.PUBLISHED;
  locale: string;
  title: string;
  slug: string;
  summary: string | null;
  body: string;
  price: ListingPriceProjection | null;
  region: ListingRegionProjection;
  category: ListingCategoryProjection;
  owner: ListingOwnerSummaryProjection;
  organization: ListingOrganizationSummaryProjection | null;
  location: ListingLocationProjection;
  attributes: Record<string, Prisma.JsonValue>;
  featured: boolean;
  featuredUntil: Date | null;
  publishedAt: Date;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
  version: number;
};

export type OwnerListingProjection = {
  id: string;
  type: ListingType;
  ownerId: string;
  organizationId: string | null;
  formSchemaVersion: number;
  status: ContentStatus;
  moderationStatus: ModerationStatus;
  locale: string;
  title: string;
  slug: string;
  summary: string | null;
  body: string;
  price: ListingPriceProjection | null;
  region: ListingRegionProjection;
  category: ListingCategoryProjection;
  owner: ListingOwnerSummaryProjection;
  organization: ListingOrganizationSummaryProjection | null;
  location: ListingLocationProjection;
  contactMode: ContactMode;
  attributes: Record<string, Prisma.JsonValue>;
  mediaIds: string[];
  isFeatured: boolean;
  featuredUntil: Date | null;
  publishedAt: Date | null;
  expiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  version: number;
};

export type ModeratorListingProjection = {
  id: string;
  type: ListingType;
  ownerId: string;
  organizationId: string | null;
  formSchemaVersion: number;
  status: ContentStatus;
  moderationStatus: ModerationStatus;
  locale: string;
  title: string;
  slug: string;
  summary: string | null;
  body: string;
  price: ListingPriceProjection | null;
  region: ListingRegionProjection;
  category: ListingCategoryProjection;
  owner: ListingOwnerSummaryProjection & { accountStatus: UserStatus };
  organization:
    | (ListingOrganizationSummaryProjection & {
        status: UserStatus;
      })
    | null;
  location: ListingLocationProjection;
  contactMode: ContactMode;
  attributes: Record<string, Prisma.JsonValue>;
  qualityScore: number;
  isFeatured: boolean;
  featuredUntil: Date | null;
  publishedAt: Date | null;
  expiresAt: Date | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  version: number;
};

export type PublicListingReadInput = {
  listingId: string;
  now: Date;
};

export type PublicListingCursor = {
  publishedAt: Date;
  id: string;
};

export type PublicListingListInput = {
  type: ListingType;
  categoryId?: string;
  regionCode?: string;
  cursor?: PublicListingCursor;
  limit: number;
  now: Date;
};

export type PublicListingListResult = {
  items: PublicListingProjection[];
  nextCursor: PublicListingCursor | null;
};

export type ScopedListingReadInput = {
  actorUserId: string;
  listingId: string;
  now: Date;
};

export type OwnerListingTransitionInput = {
  actorUserId: string;
  listingId: string;
  expectedVersion: number;
  kind: "ARCHIVE" | "DELETE";
  requestId: string;
  occurredAt: Date;
};

export type OwnerListingTransitionResult =
  | { kind: "transitioned"; version: number }
  | { kind: "already_archived"; version: number }
  | { kind: "already_deleted" }
  | {
      kind:
        "actor_unavailable" | "not_found" | "state_conflict" | "time_conflict" | "version_conflict";
      currentVersion?: number;
    };

export type ExpireDueListingsInput = {
  now: Date;
  limit: number;
};

export type ExpireDueListingsResult = {
  expiredCount: number;
};

const publicActorStatuses = [UserStatus.ACTIVE, UserStatus.LIMITED] as const;
const moderationRoles = [PlatformRole.MODERATOR, PlatformRole.SENIOR_MODERATOR] as const;
const organizationListingWriterRoles = [
  MembershipRole.OWNER,
  MembershipRole.ADMIN,
  MembershipRole.EDITOR,
] as const;
const attributeVisibilitySchema = z
  .object({
    fields: z
      .array(
        z
          .object({
            key: z
              .string()
              .min(2)
              .max(80)
              .regex(/^[a-z][a-zA-Z0-9_]{1,79}$/),
            visibility: z.enum(["PUBLIC", "OWNER_ONLY", "MODERATOR_ONLY"]),
          })
          .passthrough(),
      )
      .max(100),
  })
  .passthrough();
const moderatorScopeSchema = z
  .object({
    regions: z.array(z.string().min(1).max(160)).min(1).max(100).optional(),
    categories: z.array(z.string().min(1).max(160)).min(1).max(100).optional(),
  })
  .strict();

const regionSelect = {
  id: true,
  type: true,
  code: true,
  slug: true,
  nameZhHans: true,
  nameEn: true,
  timezone: true,
} satisfies Prisma.RegionSelect;

const categorySelect = {
  id: true,
  vertical: true,
  slug: true,
  nameZhHans: true,
  nameEn: true,
} satisfies Prisma.CategorySelect;

const ownerSummarySelect = {
  id: true,
  profile: {
    select: {
      displayName: true,
      avatarUrl: true,
    },
  },
} satisfies Prisma.UserSelect;

const organizationSummarySelect = {
  id: true,
  displayName: true,
  slug: true,
  verificationStatus: true,
} satisfies Prisma.OrganizationSelect;

const publicListingSelect = {
  id: true,
  type: true,
  status: true,
  locale: true,
  title: true,
  slug: true,
  summary: true,
  body: true,
  priceAmount: true,
  currency: true,
  priceUnit: true,
  locationPrecision: true,
  attributes: true,
  formSchemaVersion: true,
  isFeatured: true,
  featuredUntil: true,
  publishedAt: true,
  expiresAt: true,
  createdAt: true,
  updatedAt: true,
  version: true,
  region: { select: regionSelect },
  category: { select: categorySelect },
  owner: { select: ownerSummarySelect },
  organization: { select: organizationSummarySelect },
} satisfies Prisma.ListingSelect;

const ownerListingSelect = {
  ...publicListingSelect,
  ownerId: true,
  organizationId: true,
  moderationStatus: true,
  contactMode: true,
  latitude: true,
  longitude: true,
  uploadedMedia: {
    where: { status: "READY", purpose: "LISTING_MEDIA", kind: "IMAGE" },
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    select: { id: true },
  },
} satisfies Prisma.ListingSelect;

const moderatorListingSelect = {
  ...publicListingSelect,
  ownerId: true,
  organizationId: true,
  moderationStatus: true,
  contactMode: true,
  qualityScore: true,
  deletedAt: true,
  owner: {
    select: {
      ...ownerSummarySelect,
      status: true,
    },
  },
  organization: {
    select: {
      ...organizationSummarySelect,
      status: true,
    },
  },
} satisfies Prisma.ListingSelect;

type SelectedPublicListing = Prisma.ListingGetPayload<{ select: typeof publicListingSelect }>;
type ListingClient = PrismaClient | Prisma.TransactionClient;
type AttributeVisibility = "PUBLIC" | "OWNER_ONLY" | "MODERATOR_ONLY";

function isRepositoryOptions(
  target: ListingClient | ListingRepositoryOptions,
): target is ListingRepositoryOptions {
  return "connectionString" in target;
}

function mapPrice(row: {
  priceAmount: { toString(): string } | null;
  currency: string;
  priceUnit: PriceUnit | null;
}): ListingPriceProjection | null {
  if (row.priceAmount === null && row.priceUnit === null) return null;
  return {
    amount: row.priceAmount?.toString() ?? null,
    currency: row.currency,
    unit: row.priceUnit,
  };
}

function mapRegion(region: SelectedPublicListing["region"]): ListingRegionProjection {
  return { ...region };
}

function mapCategory(category: SelectedPublicListing["category"]): ListingCategoryProjection {
  return { ...category };
}

function mapOwner(owner: SelectedPublicListing["owner"]): ListingOwnerSummaryProjection | null {
  if (!owner.profile) return null;
  return {
    id: owner.id,
    displayName: owner.profile.displayName,
    avatarUrl: owner.profile.avatarUrl,
  };
}

function mapOrganization(
  organization: SelectedPublicListing["organization"],
): ListingOrganizationSummaryProjection | null {
  return organization ? { ...organization } : null;
}

function mapBase(row: SelectedPublicListing, attributes: Record<string, Prisma.JsonValue>) {
  const owner = mapOwner(row.owner);
  if (!owner) return null;
  return {
    id: row.id,
    type: row.type,
    locale: row.locale,
    title: row.title,
    slug: row.slug,
    summary: row.summary,
    body: row.body,
    price: mapPrice(row),
    region: mapRegion(row.region),
    category: mapCategory(row.category),
    owner,
    organization: mapOrganization(row.organization),
    location: { precision: row.locationPrecision },
    attributes,
    featuredUntil: row.featuredUntil,
    publishedAt: row.publishedAt,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    version: row.version,
  };
}

function projectAttributes(
  attributes: Prisma.JsonValue,
  definition: Prisma.JsonValue | null,
  allowedVisibilities: ReadonlySet<AttributeVisibility>,
): Record<string, Prisma.JsonValue> {
  if (
    attributes === null ||
    Array.isArray(attributes) ||
    typeof attributes !== "object" ||
    definition === null
  ) {
    return {};
  }
  const parsed = attributeVisibilitySchema.safeParse(definition);
  if (!parsed.success) return {};
  const seen = new Set<string>();
  const permittedKeys = new Set<string>();
  for (const field of parsed.data.fields) {
    if (seen.has(field.key)) return {};
    seen.add(field.key);
    if (allowedVisibilities.has(field.visibility)) permittedKeys.add(field.key);
  }
  return Object.fromEntries(
    Object.entries(attributes).filter(([key]) => permittedKeys.has(key)),
  ) as Record<string, Prisma.JsonValue>;
}

function scopeMatches(
  scope: Prisma.JsonValue | null,
  listing: {
    region: { id: string; code: string; slug: string };
    category: Pick<Category, "id" | "slug">;
  },
): boolean {
  if (scope === null) return true;
  const parsed = moderatorScopeSchema.safeParse(scope);
  if (!parsed.success) return false;
  const regionIdentifiers = new Set([listing.region.id, listing.region.code, listing.region.slug]);
  const categoryIdentifiers = new Set([listing.category.id, listing.category.slug]);
  return (
    (!parsed.data.regions ||
      parsed.data.regions.some((identifier) => regionIdentifiers.has(identifier))) &&
    (!parsed.data.categories ||
      parsed.data.categories.some((identifier) => categoryIdentifiers.has(identifier)))
  );
}

function publicListingWhere(now: Date): Prisma.ListingWhereInput {
  return {
    status: ContentStatus.PUBLISHED,
    moderationStatus: {
      in: [ModerationStatus.AUTO_APPROVED, ModerationStatus.APPROVED],
    },
    publishedAt: { not: null, lte: now },
    expiresAt: { gt: now },
    deletedAt: null,
    category: { is: { isActive: true } },
    region: { is: { isActive: true } },
    owner: {
      is: {
        status: { in: [...publicActorStatuses] },
        deletedAt: null,
        profile: { isNot: null },
      },
    },
    OR: [
      { organizationId: null },
      {
        organization: {
          is: {
            status: { in: [...publicActorStatuses] },
            deletedAt: null,
          },
        },
      },
    ],
  };
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

async function activeListingWriter(
  transaction: Prisma.TransactionClient,
  actorUserId: string,
  ownerId: string,
  organizationId: string | null,
): Promise<"active" | "actor_unavailable" | "unauthorized"> {
  const actor = await transaction.user.findFirst({
    where: { id: actorUserId, status: UserStatus.ACTIVE, deletedAt: null },
    select: { id: true },
  });
  if (!actor) return "actor_unavailable";
  if (!organizationId) return ownerId === actorUserId ? "active" : "unauthorized";
  const membership = await transaction.organizationMembership.findFirst({
    where: {
      organizationId,
      userId: actorUserId,
      role: { in: [...organizationListingWriterRoles] },
      organization: { status: UserStatus.ACTIVE, deletedAt: null },
      user: { status: UserStatus.ACTIVE, deletedAt: null },
    },
    select: { userId: true },
  });
  return membership ? "active" : "unauthorized";
}

export class ListingRepository {
  readonly #client: ListingClient;
  readonly #ownedClient: PrismaClient | null;

  constructor(target: ListingClient | ListingRepositoryOptions) {
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

  async findPublicById(input: PublicListingReadInput): Promise<PublicListingProjection | null> {
    const row = await this.#client.listing.findFirst({
      where: {
        ...publicListingWhere(input.now),
        id: input.listingId,
      },
      select: publicListingSelect,
    });
    return row ? this.#toPublicProjection(row, input.now) : null;
  }

  async listPublic(input: PublicListingListInput): Promise<PublicListingListResult> {
    const rows = await this.#client.listing.findMany({
      where: {
        AND: [
          publicListingWhere(input.now),
          {
            type: input.type,
            ...(input.categoryId ? { categoryId: input.categoryId } : {}),
            ...(input.regionCode ? { region: { is: { code: input.regionCode } } } : {}),
          },
          ...(input.cursor
            ? [
                {
                  OR: [
                    { publishedAt: { lt: input.cursor.publishedAt } },
                    {
                      publishedAt: input.cursor.publishedAt,
                      id: { lt: input.cursor.id },
                    },
                  ],
                } satisfies Prisma.ListingWhereInput,
              ]
            : []),
        ],
      },
      orderBy: [{ publishedAt: "desc" }, { id: "desc" }],
      take: input.limit + 1,
      select: publicListingSelect,
    });
    const pageRows = rows.slice(0, input.limit);
    const items: PublicListingProjection[] = [];
    for (const row of pageRows) {
      const projection = await this.#toPublicProjection(row, input.now);
      if (projection) items.push(projection);
    }
    const last = pageRows.at(-1);
    return {
      items,
      nextCursor:
        rows.length > input.limit && last?.publishedAt
          ? { publishedAt: last.publishedAt, id: last.id }
          : null,
    };
  }

  async findByIdForOwner(input: ScopedListingReadInput): Promise<OwnerListingProjection | null> {
    const row = await this.#client.listing.findFirst({
      where: {
        id: input.listingId,
        deletedAt: null,
        OR: [
          {
            ownerId: input.actorUserId,
            organizationId: null,
            owner: {
              is: {
                status: { in: [...publicActorStatuses] },
                deletedAt: null,
              },
            },
          },
          {
            organization: {
              is: {
                status: { in: [...publicActorStatuses] },
                deletedAt: null,
                memberships: {
                  some: {
                    userId: input.actorUserId,
                    user: {
                      is: {
                        status: { in: [...publicActorStatuses] },
                        deletedAt: null,
                      },
                    },
                  },
                },
              },
            },
          },
        ],
      },
      select: ownerListingSelect,
    });
    if (!row) return null;
    const attributes = await this.#projectAttributes(
      row.category.id,
      row.formSchemaVersion,
      row.attributes,
      new Set(["PUBLIC", "OWNER_ONLY"]),
    );
    const base = mapBase(row, attributes);
    const owner = mapOwner(row.owner);
    if (!base || !owner) return null;
    const point =
      row.latitude !== null && row.longitude !== null
        ? {
            latitude: row.latitude.toString(),
            longitude: row.longitude.toString(),
          }
        : undefined;
    return {
      ...base,
      ownerId: row.ownerId,
      organizationId: row.organizationId,
      formSchemaVersion: row.formSchemaVersion,
      status: row.status,
      moderationStatus: row.moderationStatus,
      owner,
      location: {
        precision: row.locationPrecision,
        ...(point ? { point } : {}),
      },
      contactMode: row.contactMode,
      mediaIds: row.uploadedMedia.map((asset) => asset.id),
      isFeatured: row.isFeatured,
    };
  }

  transitionOwner(input: OwnerListingTransitionInput): Promise<OwnerListingTransitionResult> {
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
          moderationStatus: true,
          updatedAt: true,
          deletedAt: true,
          version: true,
        },
      });
      if (!current) return { kind: "not_found" };
      const access = await activeListingWriter(
        transaction,
        input.actorUserId,
        current.ownerId,
        current.organizationId,
      );
      if (access === "actor_unavailable") return { kind: "actor_unavailable" };
      if (access === "unauthorized") return { kind: "not_found" };
      if (
        input.kind === "DELETE" &&
        current.status === ContentStatus.DELETED &&
        current.deletedAt
      ) {
        return { kind: "already_deleted" };
      }
      if (
        input.kind === "ARCHIVE" &&
        current.status === ContentStatus.ARCHIVED &&
        (input.expectedVersion === current.version || input.expectedVersion === current.version - 1)
      ) {
        return { kind: "already_archived", version: current.version };
      }
      if (current.deletedAt) return { kind: "not_found" };
      if (current.version !== input.expectedVersion) {
        return { kind: "version_conflict", currentVersion: current.version };
      }
      if (input.occurredAt < current.updatedAt) {
        return { kind: "time_conflict", currentVersion: current.version };
      }
      if (
        (input.kind === "ARCHIVE" && current.status !== ContentStatus.PUBLISHED) ||
        (input.kind === "DELETE" && current.status === ContentStatus.DELETED)
      ) {
        return { kind: "state_conflict", currentVersion: current.version };
      }

      const nextStatus = input.kind === "ARCHIVE" ? ContentStatus.ARCHIVED : ContentStatus.DELETED;
      const nextVersion = current.version + 1;
      const changed = await transaction.listing.updateMany({
        where: {
          id: current.id,
          version: current.version,
          status: current.status,
          moderationStatus: current.moderationStatus,
          deletedAt: null,
        },
        data: {
          status: nextStatus,
          deletedAt: input.kind === "DELETE" ? input.occurredAt : null,
          updatedAt: input.occurredAt,
          version: nextVersion,
        },
      });
      if (changed.count !== 1)
        throw new Error("Locked Listing changed during lifecycle transition");

      const eventType = input.kind === "ARCHIVE" ? "listing.archived" : "listing.deleted";
      const reasonCode = input.kind === "ARCHIVE" ? "OWNER_ARCHIVED" : "OWNER_DELETED";
      const eventPayload = {
        schemaVersion: 1,
        aggregateVersion: nextVersion,
        listingId: current.id,
        type: current.type,
        previousStatus: current.status,
        currentStatus: nextStatus,
        previousModerationStatus: current.moderationStatus,
        currentModerationStatus: current.moderationStatus,
        reasonCode,
      } satisfies Prisma.InputJsonObject;
      await transaction.auditLog.create({
        data: {
          actorId: input.actorUserId,
          actorType: "USER",
          action: eventType,
          targetType: "LISTING",
          targetId: current.id,
          requestId: input.requestId,
          metadata: eventPayload,
          createdAt: input.occurredAt,
        },
      });
      await transaction.outboxEvent.create({
        data: {
          aggregateType: "LISTING",
          aggregateId: current.id,
          eventType,
          payload: eventPayload,
          createdAt: input.occurredAt,
        },
      });
      return { kind: "transitioned", version: nextVersion };
    });
  }

  expireDue(input: ExpireDueListingsInput): Promise<ExpireDueListingsResult> {
    if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 500) {
      return Promise.reject(new TypeError("Expiry batch limit must be between 1 and 500"));
    }
    if (!Number.isFinite(input.now.getTime())) {
      return Promise.reject(new TypeError("Expiry time must be finite"));
    }
    return this.#inTransaction(async (transaction) => {
      const due = await transaction.$queryRaw<
        Array<{
          id: string;
          type: ListingType;
          moderationStatus: ModerationStatus;
          version: number;
        }>
      >(Prisma.sql`
        SELECT
          "id",
          "type",
          "moderation_status" AS "moderationStatus",
          "version"
        FROM "listings"
        WHERE
          "type" IN (
            'RENTAL'::"ListingType",
            'JOB'::"ListingType",
            'TRANSFER'::"ListingType",
            'SECONDHAND'::"ListingType",
            'SERVICE'::"ListingType"
          )
          AND "status" = 'PUBLISHED'::"ContentStatus"
          AND "moderation_status" IN (
            'AUTO_APPROVED'::"ModerationStatus",
            'APPROVED'::"ModerationStatus"
          )
          AND "expires_at" <= ${input.now}
          AND "deleted_at" IS NULL
        ORDER BY "expires_at" ASC, "id" ASC
        LIMIT ${input.limit}
        FOR UPDATE SKIP LOCKED
      `);
      for (const listing of due) {
        const nextVersion = listing.version + 1;
        const changed = await transaction.listing.updateMany({
          where: {
            id: listing.id,
            status: ContentStatus.PUBLISHED,
            moderationStatus: listing.moderationStatus,
            expiresAt: { lte: input.now },
            deletedAt: null,
            version: listing.version,
          },
          data: {
            status: ContentStatus.EXPIRED,
            updatedAt: input.now,
            version: nextVersion,
          },
        });
        if (changed.count !== 1) throw new Error("Locked Listing changed during expiry");
        const payload = {
          schemaVersion: 1,
          aggregateVersion: nextVersion,
          listingId: listing.id,
          type: listing.type,
          previousStatus: ContentStatus.PUBLISHED,
          currentStatus: ContentStatus.EXPIRED,
          previousModerationStatus: listing.moderationStatus,
          currentModerationStatus: listing.moderationStatus,
          reasonCode: "PUBLICATION_WINDOW_ENDED",
        } satisfies Prisma.InputJsonObject;
        await transaction.auditLog.create({
          data: {
            actorType: "SYSTEM",
            action: "listing.expired",
            targetType: "LISTING",
            targetId: listing.id,
            metadata: payload,
            createdAt: input.now,
          },
        });
        await transaction.outboxEvent.create({
          data: {
            aggregateType: "LISTING",
            aggregateId: listing.id,
            eventType: "listing.expired",
            payload,
            createdAt: input.now,
          },
        });
      }
      return { expiredCount: due.length };
    });
  }

  async findByIdForModerator(
    input: ScopedListingReadInput,
  ): Promise<ModeratorListingProjection | null> {
    const assignmentWhere = {
      role: { in: [...moderationRoles] },
      revokedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: input.now } }],
    } satisfies Prisma.PlatformRoleAssignmentWhereInput;
    const actor = await this.#client.user.findFirst({
      where: {
        id: input.actorUserId,
        status: UserStatus.ACTIVE,
        deletedAt: null,
        platformRoles: { some: assignmentWhere },
      },
      select: {
        platformRoles: {
          where: assignmentWhere,
          select: { scope: true },
        },
      },
    });
    if (!actor) return null;

    const context = await this.#client.listing.findUnique({
      where: { id: input.listingId },
      select: {
        region: { select: { id: true, code: true, slug: true } },
        category: { select: { id: true, slug: true } },
      },
    });
    if (!context || !actor.platformRoles.some(({ scope }) => scopeMatches(scope, context))) {
      return null;
    }

    const row = await this.#client.listing.findUnique({
      where: { id: input.listingId },
      select: moderatorListingSelect,
    });
    if (!row) return null;
    const attributes = await this.#projectAttributes(
      row.category.id,
      row.formSchemaVersion,
      row.attributes,
      new Set(["PUBLIC", "OWNER_ONLY", "MODERATOR_ONLY"]),
    );
    const base = mapBase(row, attributes);
    if (!base || !row.owner.profile) return null;
    return {
      ...base,
      ownerId: row.ownerId,
      organizationId: row.organizationId,
      formSchemaVersion: row.formSchemaVersion,
      status: row.status,
      moderationStatus: row.moderationStatus,
      owner: {
        id: row.owner.id,
        displayName: row.owner.profile.displayName,
        avatarUrl: row.owner.profile.avatarUrl,
        accountStatus: row.owner.status,
      },
      organization: row.organization
        ? {
            id: row.organization.id,
            displayName: row.organization.displayName,
            slug: row.organization.slug,
            verificationStatus: row.organization.verificationStatus,
            status: row.organization.status,
          }
        : null,
      contactMode: row.contactMode,
      qualityScore: row.qualityScore,
      isFeatured: row.isFeatured,
      deletedAt: row.deletedAt,
    };
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

  async #projectAttributes(
    categoryId: string,
    version: number,
    attributes: Prisma.JsonValue,
    allowedVisibilities: ReadonlySet<AttributeVisibility>,
  ): Promise<Record<string, Prisma.JsonValue>> {
    const schema = await this.#client.categoryFormSchemaVersion.findFirst({
      where: {
        categoryId,
        version,
        publishedAt: { not: null },
      },
      select: { definition: true },
    });
    return projectAttributes(attributes, schema?.definition ?? null, allowedVisibilities);
  }

  async #toPublicProjection(
    row: SelectedPublicListing,
    now: Date,
  ): Promise<PublicListingProjection | null> {
    if (row.status !== ContentStatus.PUBLISHED || !row.publishedAt || !row.expiresAt) {
      return null;
    }
    const attributes = await this.#projectAttributes(
      row.category.id,
      row.formSchemaVersion,
      row.attributes,
      new Set(["PUBLIC"]),
    );
    const base = mapBase(row, attributes);
    if (!base) return null;
    return {
      ...base,
      status: ContentStatus.PUBLISHED,
      featured: row.isFeatured && (row.featuredUntil === null || row.featuredUntil > now),
      publishedAt: row.publishedAt,
      expiresAt: row.expiresAt,
    };
  }
}
