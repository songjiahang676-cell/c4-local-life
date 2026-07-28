import { PrismaPg } from "@prisma/adapter-pg";
import {
  PrismaClient,
  type ListingType,
  type Prisma,
  type RegionType,
} from "../../generated/prisma/client";
import { normalizeTaxonomyAlias } from "../taxonomy/alias-normalization";

export type TaxonomyRepositoryOptions = {
  connectionString: string;
  poolMaximum?: number;
};

export type TaxonomyAliasProjection = {
  locale: "zh-Hans" | "en-US" | "und";
  value: string;
};

export type RegionTaxonomyRecord = {
  id: string;
  parentId: string | null;
  code: string;
  type: RegionType;
  slug: string;
  nameZhHans: string;
  nameEn: string;
  timezone: string;
  latitude: number | null;
  longitude: number | null;
  isActive: boolean;
  sortOrder: number;
  aliases: TaxonomyAliasProjection[];
};

export type CategoryTaxonomyRecord = {
  id: string;
  parentId: string | null;
  vertical: ListingType | null;
  slug: string;
  nameZhHans: string;
  nameEn: string;
  iconKey: string | null;
  formSchemaVersion: number;
  isActive: boolean;
  sortOrder: number;
  aliases: TaxonomyAliasProjection[];
};

export type ListRegionTaxonomyInput = {
  parentCode?: string;
  type?: RegionType;
  activeOnly: boolean;
  query?: string;
};

export type ListCategoryTaxonomyInput = {
  vertical?: ListingType;
  parentId?: string;
  activeOnly: boolean;
  query?: string;
};

const aliasSelect = {
  locale: true,
  value: true,
} satisfies Prisma.RegionAliasSelect;

const regionSelect = {
  id: true,
  parentId: true,
  code: true,
  type: true,
  slug: true,
  nameZhHans: true,
  nameEn: true,
  timezone: true,
  latitude: true,
  longitude: true,
  isActive: true,
  sortOrder: true,
  aliases: {
    orderBy: [{ locale: "asc" as const }, { value: "asc" as const }],
    select: aliasSelect,
  },
} satisfies Prisma.RegionSelect;

const categorySelect = {
  id: true,
  parentId: true,
  vertical: true,
  slug: true,
  nameZhHans: true,
  nameEn: true,
  iconKey: true,
  formSchemaVersion: true,
  isActive: true,
  sortOrder: true,
  aliases: {
    orderBy: [{ locale: "asc" as const }, { value: "asc" as const }],
    select: aliasSelect,
  },
} satisfies Prisma.CategorySelect;

type SelectedRegion = Prisma.RegionGetPayload<{ select: typeof regionSelect }>;
type SelectedCategory = Prisma.CategoryGetPayload<{ select: typeof categorySelect }>;

function isRepositoryOptions(
  target: PrismaClient | Prisma.TransactionClient | TaxonomyRepositoryOptions,
): target is TaxonomyRepositoryOptions {
  return "connectionString" in target;
}

function mapAliases(
  aliases: readonly { locale: string; value: string }[],
): TaxonomyAliasProjection[] {
  return aliases.flatMap((alias) => {
    if (alias.locale !== "zh-Hans" && alias.locale !== "en-US" && alias.locale !== "und") return [];
    return [{ locale: alias.locale, value: alias.value }];
  });
}

function mapRegion(row: SelectedRegion): RegionTaxonomyRecord {
  return {
    id: row.id,
    parentId: row.parentId,
    code: row.code,
    type: row.type,
    slug: row.slug,
    nameZhHans: row.nameZhHans,
    nameEn: row.nameEn,
    timezone: row.timezone,
    latitude: row.latitude?.toNumber() ?? null,
    longitude: row.longitude?.toNumber() ?? null,
    isActive: row.isActive,
    sortOrder: row.sortOrder,
    aliases: mapAliases(row.aliases),
  };
}

function mapCategory(row: SelectedCategory): CategoryTaxonomyRecord {
  return {
    id: row.id,
    parentId: row.parentId,
    vertical: row.vertical,
    slug: row.slug,
    nameZhHans: row.nameZhHans,
    nameEn: row.nameEn,
    iconKey: row.iconKey,
    formSchemaVersion: row.formSchemaVersion,
    isActive: row.isActive,
    sortOrder: row.sortOrder,
    aliases: mapAliases(row.aliases),
  };
}

export class TaxonomyRepository {
  readonly #client: PrismaClient | Prisma.TransactionClient;
  readonly #ownedClient: PrismaClient | null;

  constructor(target: PrismaClient | Prisma.TransactionClient | TaxonomyRepositoryOptions) {
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

  async listRegions(input: ListRegionTaxonomyInput): Promise<RegionTaxonomyRecord[]> {
    const normalizedQuery = input.query ? normalizeTaxonomyAlias(input.query) : undefined;
    if (input.query && !normalizedQuery) return [];
    const rows = await this.#client.region.findMany({
      where: {
        ...(input.activeOnly ? { isActive: true } : {}),
        ...(input.type ? { type: input.type } : {}),
        ...(input.parentCode ? { parent: { is: { code: input.parentCode } } } : {}),
        ...(normalizedQuery
          ? {
              OR: [
                { code: { contains: input.query, mode: "insensitive" } },
                { slug: { contains: input.query, mode: "insensitive" } },
                { nameZhHans: { contains: input.query, mode: "insensitive" } },
                { nameEn: { contains: input.query, mode: "insensitive" } },
                { aliases: { some: { normalizedValue: { startsWith: normalizedQuery } } } },
              ],
            }
          : {}),
      },
      orderBy: [{ sortOrder: "asc" }, { nameEn: "asc" }, { id: "asc" }],
      take: 1_000,
      select: regionSelect,
    });
    return rows.map(mapRegion);
  }

  async listCategories(input: ListCategoryTaxonomyInput): Promise<CategoryTaxonomyRecord[]> {
    const normalizedQuery = input.query ? normalizeTaxonomyAlias(input.query) : undefined;
    if (input.query && !normalizedQuery) return [];
    const rows = await this.#client.category.findMany({
      where: {
        ...(input.activeOnly ? { isActive: true } : {}),
        ...(input.vertical ? { vertical: input.vertical } : {}),
        ...(input.parentId ? { parentId: input.parentId } : {}),
        ...(normalizedQuery
          ? {
              OR: [
                { slug: { contains: input.query, mode: "insensitive" } },
                { nameZhHans: { contains: input.query, mode: "insensitive" } },
                { nameEn: { contains: input.query, mode: "insensitive" } },
                { aliases: { some: { normalizedValue: { startsWith: normalizedQuery } } } },
              ],
            }
          : {}),
      },
      orderBy: [{ sortOrder: "asc" }, { nameEn: "asc" }, { id: "asc" }],
      take: 1_000,
      select: categorySelect,
    });
    return rows.map(mapCategory);
  }

  close(): Promise<void> {
    return this.#ownedClient?.$disconnect() ?? Promise.resolve();
  }
}
