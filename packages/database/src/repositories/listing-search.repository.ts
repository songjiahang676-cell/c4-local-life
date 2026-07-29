import { PrismaPg } from "@prisma/adapter-pg";
import {
  ContentStatus,
  ModerationStatus,
  Prisma,
  PrismaClient,
  UserStatus,
  type ListingType,
  type PriceUnit,
  type VerificationStatus,
} from "../../generated/prisma/client";

const publicActorStatuses = [UserStatus.ACTIVE, UserStatus.LIMITED] as const;
const publicModerationStatuses = [
  ModerationStatus.AUTO_APPROVED,
  ModerationStatus.APPROVED,
] as const;
const supportedLocales = ["zh-Hans", "en-US"] as const;
const publicLocationPrecisions = ["CITY", "NEIGHBORHOOD", "APPROXIMATE"] as const;

export type ListingSearchRepositoryOptions = {
  connectionString: string;
  poolMaximum?: number;
};

export type ListingSearchProjection = {
  id: string;
  type: ListingType;
  locale: (typeof supportedLocales)[number];
  slug: string;
  title: string;
  summary: string | null;
  body: string;
  category: {
    id: string;
    slug: string;
    path: string[];
    nameZhHans: string;
    nameEn: string;
    aliases: string[];
  };
  region: {
    id: string;
    code: string;
    slug: string;
    path: string[];
    nameZhHans: string;
    nameEn: string;
    aliases: string[];
  };
  price: {
    amount: string | null;
    currency: string;
    unit: PriceUnit | null;
  };
  location: {
    precision: (typeof publicLocationPrecisions)[number];
    latitude: number | null;
    longitude: number | null;
  };
  attributes: Record<string, Prisma.JsonValue>;
  publisher: {
    ownerId: string;
    displayName: string;
    avatarUrl: string | null;
    organizationId: string | null;
    organizationSlug: string | null;
    organizationVerification: VerificationStatus | null;
  };
  qualityScore: number;
  isSponsored: boolean;
  publishedAt: Date;
  expiresAt: Date;
  updatedAt: Date;
  version: number;
};

export type ListingSearchRecord = {
  id: string;
  version: number;
  projection: ListingSearchProjection | null;
};

export type ListingSearchState = {
  id: string;
  version: number;
  shouldIndex: boolean;
};

export type ListListingSearchStatesInput = {
  afterId?: string;
  limit: number;
  now: Date;
};

export type ListingSearchStatePage = {
  items: ListingSearchState[];
  nextCursor: string | null;
};

type ListingSearchClient = PrismaClient | Prisma.TransactionClient;

const listingSearchSelect = {
  id: true,
  type: true,
  status: true,
  moderationStatus: true,
  locale: true,
  slug: true,
  title: true,
  summary: true,
  body: true,
  priceAmount: true,
  currency: true,
  priceUnit: true,
  attributes: true,
  formSchemaVersion: true,
  latitude: true,
  longitude: true,
  locationPrecision: true,
  qualityScore: true,
  isFeatured: true,
  featuredUntil: true,
  publishedAt: true,
  expiresAt: true,
  updatedAt: true,
  deletedAt: true,
  version: true,
  category: {
    select: {
      id: true,
      slug: true,
      nameZhHans: true,
      nameEn: true,
      isActive: true,
      aliases: {
        orderBy: [{ locale: "asc" }, { normalizedValue: "asc" }],
        select: { value: true },
      },
    },
  },
  region: {
    select: {
      id: true,
      code: true,
      slug: true,
      nameZhHans: true,
      nameEn: true,
      latitude: true,
      longitude: true,
      isActive: true,
      aliases: {
        orderBy: [{ locale: "asc" }, { normalizedValue: "asc" }],
        select: { value: true },
      },
    },
  },
  owner: {
    select: {
      id: true,
      status: true,
      deletedAt: true,
      profile: {
        select: {
          displayName: true,
          avatarUrl: true,
        },
      },
    },
  },
  organization: {
    select: {
      id: true,
      slug: true,
      status: true,
      deletedAt: true,
      verificationStatus: true,
    },
  },
} satisfies Prisma.ListingSelect;

const listingSearchStateSelect = {
  id: true,
  version: true,
  status: true,
  moderationStatus: true,
  publishedAt: true,
  expiresAt: true,
  deletedAt: true,
  category: { select: { isActive: true } },
  region: { select: { isActive: true } },
  owner: {
    select: {
      status: true,
      deletedAt: true,
      profile: { select: { userId: true } },
    },
  },
  organization: {
    select: {
      status: true,
      deletedAt: true,
    },
  },
} satisfies Prisma.ListingSelect;

type SelectedListingSearchState = Prisma.ListingGetPayload<{
  select: typeof listingSearchStateSelect;
}>;

function isRepositoryOptions(
  target: ListingSearchClient | ListingSearchRepositoryOptions,
): target is ListingSearchRepositoryOptions {
  return "connectionString" in target;
}

function isFiniteDate(value: Date | null): value is Date {
  return value !== null && Number.isFinite(value.getTime());
}

function isPublicListing(
  row: {
    status: ContentStatus;
    moderationStatus: ModerationStatus;
    publishedAt: Date | null;
    expiresAt: Date | null;
    deletedAt: Date | null;
    category: { isActive: boolean };
    region: { isActive: boolean };
    owner: {
      status: UserStatus;
      deletedAt: Date | null;
      profile: object | null;
    };
    organization: {
      status: UserStatus;
      deletedAt: Date | null;
    } | null;
  },
  now: Date,
): boolean {
  return (
    row.status === ContentStatus.PUBLISHED &&
    publicModerationStatuses.includes(
      row.moderationStatus as (typeof publicModerationStatuses)[number],
    ) &&
    isFiniteDate(row.publishedAt) &&
    row.publishedAt <= now &&
    isFiniteDate(row.expiresAt) &&
    row.expiresAt > now &&
    row.deletedAt === null &&
    row.category.isActive &&
    row.region.isActive &&
    publicActorStatuses.includes(row.owner.status as (typeof publicActorStatuses)[number]) &&
    row.owner.deletedAt === null &&
    row.owner.profile !== null &&
    (row.organization === null ||
      (publicActorStatuses.includes(
        row.organization.status as (typeof publicActorStatuses)[number],
      ) &&
        row.organization.deletedAt === null))
  );
}

function publicAttributeKeys(definition: Prisma.JsonValue | null): ReadonlySet<string> {
  if (
    definition === null ||
    Array.isArray(definition) ||
    typeof definition !== "object" ||
    !("fields" in definition) ||
    !Array.isArray(definition.fields)
  ) {
    return new Set();
  }
  const seen = new Set<string>();
  const keys = new Set<string>();
  for (const value of definition.fields) {
    if (
      value === null ||
      Array.isArray(value) ||
      typeof value !== "object" ||
      typeof value.key !== "string" ||
      value.key.length < 1 ||
      value.key.length > 80 ||
      typeof value.visibility !== "string"
    ) {
      return new Set();
    }
    if (seen.has(value.key)) return new Set();
    seen.add(value.key);
    if (value.visibility === "PUBLIC") keys.add(value.key);
  }
  return keys;
}

function projectAttributes(
  attributes: Prisma.JsonValue,
  definition: Prisma.JsonValue | null,
): Record<string, Prisma.JsonValue> {
  if (attributes === null || Array.isArray(attributes) || typeof attributes !== "object") return {};
  const permitted = publicAttributeKeys(definition);
  return Object.fromEntries(
    Object.entries(attributes).filter(([key]) => permitted.has(key)),
  ) as Record<string, Prisma.JsonValue>;
}

function supportedLocale(value: string): ListingSearchProjection["locale"] | null {
  return supportedLocales.includes(value as (typeof supportedLocales)[number])
    ? (value as ListingSearchProjection["locale"])
    : null;
}

function publicLocationPrecision(
  value: string,
): ListingSearchProjection["location"]["precision"] | null {
  if (value === "EXACT") return "CITY";
  return publicLocationPrecisions.includes(value as (typeof publicLocationPrecisions)[number])
    ? (value as ListingSearchProjection["location"]["precision"])
    : null;
}

function coordinate(value: { toNumber(): number } | null): number | null {
  if (!value) return null;
  const result = value.toNumber();
  return Number.isFinite(result) ? result : null;
}

function fuzzyCoordinate(value: number | null): number | null {
  return value === null ? null : Math.round(value * 1_000) / 1_000;
}

function assertPageLimit(value: number): void {
  if (!Number.isInteger(value) || value < 1 || value > 1_000) {
    throw new RangeError("Listing search state page limit must be between 1 and 1000");
  }
}

export class ListingSearchRepository {
  readonly #client: ListingSearchClient;
  readonly #ownedClient: PrismaClient | null;

  constructor(target: ListingSearchClient | ListingSearchRepositoryOptions) {
    if (isRepositoryOptions(target)) {
      const adapter = new PrismaPg({
        connectionString: target.connectionString,
        max: target.poolMaximum ?? 10,
        connectionTimeoutMillis: 5_000,
        idleTimeoutMillis: 30_000,
      });
      this.#ownedClient = new PrismaClient({ adapter });
      this.#client = this.#ownedClient;
    } else {
      this.#client = target;
      this.#ownedClient = null;
    }
  }

  async findById(listingId: string, now: Date): Promise<ListingSearchRecord | null> {
    const row = await this.#client.listing.findUnique({
      where: { id: listingId },
      select: listingSearchSelect,
    });
    if (!row) return null;
    if (!isPublicListing(row, now)) {
      return { id: row.id, version: row.version, projection: null };
    }

    const locale = supportedLocale(row.locale);
    const locationPrecision = publicLocationPrecision(row.locationPrecision);
    if (!locale || !locationPrecision || !row.publishedAt || !row.expiresAt || !row.owner.profile) {
      return { id: row.id, version: row.version, projection: null };
    }

    const [formSchema, categoryPath, regionPath] = await Promise.all([
      this.#client.categoryFormSchemaVersion.findUnique({
        where: {
          categoryId_version: {
            categoryId: row.category.id,
            version: row.formSchemaVersion,
          },
        },
        select: { definition: true },
      }),
      this.#taxonomyPath("categories", row.category.id),
      this.#taxonomyPath("regions", row.region.id),
    ]);

    const listingLatitude = coordinate(row.latitude);
    const listingLongitude = coordinate(row.longitude);
    const regionLatitude = coordinate(row.region.latitude);
    const regionLongitude = coordinate(row.region.longitude);
    const latitude =
      locationPrecision === "CITY"
        ? regionLatitude
        : fuzzyCoordinate(listingLatitude ?? regionLatitude);
    const longitude =
      locationPrecision === "CITY"
        ? regionLongitude
        : fuzzyCoordinate(listingLongitude ?? regionLongitude);

    return {
      id: row.id,
      version: row.version,
      projection: {
        id: row.id,
        type: row.type,
        locale,
        slug: row.slug,
        title: row.title,
        summary: row.summary,
        body: row.body,
        category: {
          id: row.category.id,
          slug: row.category.slug,
          path: categoryPath,
          nameZhHans: row.category.nameZhHans,
          nameEn: row.category.nameEn,
          aliases: row.category.aliases.map(({ value }) => value),
        },
        region: {
          id: row.region.id,
          code: row.region.code,
          slug: row.region.slug,
          path: regionPath,
          nameZhHans: row.region.nameZhHans,
          nameEn: row.region.nameEn,
          aliases: row.region.aliases.map(({ value }) => value),
        },
        price: {
          amount: row.priceAmount?.toString() ?? null,
          currency: row.currency,
          unit: row.priceUnit,
        },
        location: {
          precision: locationPrecision,
          latitude,
          longitude,
        },
        attributes: projectAttributes(row.attributes, formSchema?.definition ?? null),
        publisher: {
          ownerId: row.owner.id,
          displayName: row.owner.profile.displayName,
          avatarUrl: row.owner.profile.avatarUrl,
          organizationId: row.organization?.id ?? null,
          organizationSlug: row.organization?.slug ?? null,
          organizationVerification: row.organization?.verificationStatus ?? null,
        },
        qualityScore: row.qualityScore,
        isSponsored: row.isFeatured && (row.featuredUntil === null || row.featuredUntil > now),
        publishedAt: row.publishedAt,
        expiresAt: row.expiresAt,
        updatedAt: row.updatedAt,
        version: row.version,
      },
    };
  }

  async listStates(input: ListListingSearchStatesInput): Promise<ListingSearchStatePage> {
    assertPageLimit(input.limit);
    const rows = await this.#client.listing.findMany({
      where: input.afterId ? { id: { gt: input.afterId } } : undefined,
      orderBy: { id: "asc" },
      take: input.limit + 1,
      select: listingSearchStateSelect,
    });
    const pageRows = rows.slice(0, input.limit);
    return {
      items: pageRows.map((row: SelectedListingSearchState) => ({
        id: row.id,
        version: row.version,
        shouldIndex: isPublicListing(row, input.now),
      })),
      nextCursor: rows.length > input.limit ? (pageRows.at(-1)?.id ?? null) : null,
    };
  }

  async #taxonomyPath(table: "categories" | "regions", id: string): Promise<string[]> {
    const tableName = Prisma.raw(`"${table}"`);
    const rows = await this.#client.$queryRaw<Array<{ path: string[] | null }>>(Prisma.sql`
      WITH RECURSIVE taxonomy_path AS (
        SELECT "id", "parent_id", "slug", 0 AS "depth"
        FROM ${tableName}
        WHERE "id" = ${id}::uuid
        UNION ALL
        SELECT parent."id", parent."parent_id", parent."slug", child."depth" + 1
        FROM ${tableName} AS parent
        INNER JOIN taxonomy_path AS child ON child."parent_id" = parent."id"
        WHERE child."depth" < 31
      )
      SELECT array_agg("slug" ORDER BY "depth" DESC) AS "path"
      FROM taxonomy_path
    `);
    return rows[0]?.path ?? [];
  }

  async close(): Promise<void> {
    await (this.#ownedClient?.$disconnect() ?? Promise.resolve());
  }
}
