import { PrismaPg } from "@prisma/adapter-pg";
import { z } from "zod";
import {
  ContentStatus,
  ModerationStatus,
  PlatformRole,
  PrismaClient,
  UserStatus,
  type Category,
  type ContactMode,
  type ListingType,
  type PriceUnit,
  type Prisma,
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

export type ScopedListingReadInput = {
  actorUserId: string;
  listingId: string;
  now: Date;
};

const publicActorStatuses = [UserStatus.ACTIVE, UserStatus.LIMITED] as const;
const moderationRoles = [PlatformRole.MODERATOR, PlatformRole.SENIOR_MODERATOR] as const;
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
        id: input.listingId,
        status: ContentStatus.PUBLISHED,
        moderationStatus: {
          in: [ModerationStatus.AUTO_APPROVED, ModerationStatus.APPROVED],
        },
        publishedAt: { not: null, lte: input.now },
        expiresAt: { gt: input.now },
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
      },
      select: publicListingSelect,
    });
    if (!row || row.status !== ContentStatus.PUBLISHED || !row.publishedAt || !row.expiresAt) {
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
      featured: row.isFeatured && (row.featuredUntil === null || row.featuredUntil > input.now),
      publishedAt: row.publishedAt,
      expiresAt: row.expiresAt,
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
      isFeatured: row.isFeatured,
    };
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
}
