import {
  ContentStatus,
  ListingType,
  ModerationStatus,
  Prisma,
  PriceUnit,
  RegionType,
  type PrismaClient,
} from "../../generated/prisma/client";
import type { SeedData } from "./seed-data";
import { stableSeedUuid } from "./stable-id";
import { normalizeTaxonomyAlias } from "../taxonomy/alias-normalization";

export type SeedSummary = {
  regions: number;
  regionAliases: number;
  categories: number;
  categoryAliases: number;
  listings: number;
  users: number;
  sourceVersion: number;
};

function slugFromCode(code: string): string {
  return code.toLowerCase();
}

export async function seedDatabase(client: PrismaClient, seed: SeedData): Promise<SeedSummary> {
  return client.$transaction((transaction) => seedDatabaseInTransaction(transaction, seed));
}

export async function seedDatabaseInTransaction(
  transaction: Prisma.TransactionClient,
  seed: SeedData,
): Promise<SeedSummary> {
  const regionIds = new Map<string, string>();
  let regionAliasCount = 0;
  let categoryAliasCount = 0;

  const syncRegionAliases = async (
    regionId: string,
    regionCode: string,
    aliases: SeedData["regions"]["country"]["aliases"],
  ): Promise<void> => {
    const aliasIds: string[] = [];
    for (const alias of aliases) {
      const normalizedValue = normalizeTaxonomyAlias(alias.value);
      const id = stableSeedUuid(`region-alias:${regionCode}:${alias.locale}:${normalizedValue}`);
      aliasIds.push(id);
      await transaction.regionAlias.upsert({
        where: { id },
        create: {
          id,
          regionId,
          locale: alias.locale,
          value: alias.value,
          normalizedValue,
        },
        update: {
          regionId,
          locale: alias.locale,
          value: alias.value,
          normalizedValue,
        },
      });
    }
    await transaction.regionAlias.deleteMany({
      where: {
        regionId,
        ...(aliasIds.length > 0 ? { id: { notIn: aliasIds } } : {}),
      },
    });
    regionAliasCount += aliasIds.length;
  };

  const upsertRegion = async (input: {
    code: string;
    type: RegionType;
    parentCode?: string;
    nameZhHans: string;
    nameEn: string;
    timezone?: string;
    latitude?: number;
    longitude?: number;
    aliases: SeedData["regions"]["country"]["aliases"];
  }): Promise<void> => {
    const id = stableSeedUuid(`region:${input.code}`);
    const parentId = input.parentCode ? regionIds.get(input.parentCode) : undefined;
    if (input.parentCode && !parentId) {
      throw new Error(`Seed parent region is missing for ${input.code}`);
    }
    const values = {
      parentId: parentId ?? null,
      type: input.type,
      slug: slugFromCode(input.code),
      nameZhHans: input.nameZhHans,
      nameEn: input.nameEn,
      timezone: input.timezone ?? "America/Los_Angeles",
      latitude: input.latitude,
      longitude: input.longitude,
      isActive: true,
    };
    const region = await transaction.region.upsert({
      where: { code: input.code },
      create: { id, code: input.code, ...values },
      update: values,
    });
    regionIds.set(input.code, region.id);
    await syncRegionAliases(region.id, input.code, input.aliases);
  };

  await upsertRegion({
    code: seed.regions.country.code,
    type: RegionType.COUNTRY,
    nameZhHans: seed.regions.country.name["zh-Hans"],
    nameEn: seed.regions.country.name["en-US"],
    aliases: seed.regions.country.aliases,
  });
  await upsertRegion({
    code: seed.regions.state.code,
    type: RegionType.STATE,
    parentCode: seed.regions.country.code,
    nameZhHans: seed.regions.state.name["zh-Hans"],
    nameEn: seed.regions.state.name["en-US"],
    timezone: seed.regions.state.timezone,
    aliases: seed.regions.state.aliases,
  });
  for (const metro of seed.regions.metros) {
    await upsertRegion({
      code: metro.code,
      type: RegionType.REGION_GROUP,
      parentCode: seed.regions.state.code,
      nameZhHans: metro.name["zh-Hans"],
      nameEn: metro.name["en-US"],
      timezone: metro.timezone,
      aliases: metro.aliases,
    });
    for (const city of metro.children) {
      await upsertRegion({
        code: city.code,
        type: RegionType.CITY,
        parentCode: metro.code,
        nameZhHans: city.name["zh-Hans"],
        nameEn: city.name["en-US"],
        timezone: city.timezone,
        latitude: city.centroid?.latitude,
        longitude: city.centroid?.longitude,
        aliases: city.aliases,
      });
    }
  }

  const categoryIds = new Map<string, string>();
  const syncCategoryAliases = async (
    categoryId: string,
    categoryKey: string,
    aliases: SeedData["categories"]["verticals"][number]["aliases"],
  ): Promise<void> => {
    const aliasIds: string[] = [];
    for (const alias of aliases) {
      const normalizedValue = normalizeTaxonomyAlias(alias.value);
      const id = stableSeedUuid(`category-alias:${categoryKey}:${alias.locale}:${normalizedValue}`);
      aliasIds.push(id);
      await transaction.categoryAlias.upsert({
        where: { id },
        create: {
          id,
          categoryId,
          locale: alias.locale,
          value: alias.value,
          normalizedValue,
        },
        update: {
          categoryId,
          locale: alias.locale,
          value: alias.value,
          normalizedValue,
        },
      });
    }
    await transaction.categoryAlias.deleteMany({
      where: {
        categoryId,
        ...(aliasIds.length > 0 ? { id: { notIn: aliasIds } } : {}),
      },
    });
    categoryAliasCount += aliasIds.length;
  };

  for (const vertical of seed.categories.verticals) {
    const verticalType = ListingType[vertical.type];
    const rootId = stableSeedUuid(`category:${vertical.type}:${vertical.slug}`);
    await transaction.category.upsert({
      where: { id: rootId },
      create: {
        id: rootId,
        vertical: verticalType,
        slug: vertical.slug,
        nameZhHans: vertical.name["zh-Hans"],
        nameEn: vertical.name["en-US"],
        isActive: true,
      },
      update: {
        vertical: verticalType,
        slug: vertical.slug,
        nameZhHans: vertical.name["zh-Hans"],
        nameEn: vertical.name["en-US"],
        isActive: true,
      },
    });
    categoryIds.set(`${vertical.type}:${vertical.slug}`, rootId);
    await syncCategoryAliases(rootId, `${vertical.type}:${vertical.slug}`, vertical.aliases);

    for (const child of vertical.children) {
      const id = stableSeedUuid(`category:${vertical.type}:${vertical.slug}:${child.slug}`);
      await transaction.category.upsert({
        where: { id },
        create: {
          id,
          parentId: rootId,
          vertical: verticalType,
          slug: child.slug,
          nameZhHans: child.name["zh-Hans"],
          nameEn: child.name["en-US"],
          isActive: true,
        },
        update: {
          parentId: rootId,
          vertical: verticalType,
          slug: child.slug,
          nameZhHans: child.name["zh-Hans"],
          nameEn: child.name["en-US"],
          isActive: true,
        },
      });
      categoryIds.set(`${vertical.type}:${child.slug}`, id);
      await syncCategoryAliases(
        id,
        `${vertical.type}:${vertical.slug}:${child.slug}`,
        child.aliases,
      );
    }
  }
  for (const category of seed.categories.communityCategories) {
    const id = stableSeedUuid(`category:COMMUNITY:${category.slug}`);
    await transaction.category.upsert({
      where: { id },
      create: {
        id,
        slug: category.slug,
        nameZhHans: category.name["zh-Hans"],
        nameEn: category.name["en-US"],
        isActive: true,
      },
      update: {
        slug: category.slug,
        nameZhHans: category.name["zh-Hans"],
        nameEn: category.name["en-US"],
        isActive: true,
      },
    });
    categoryIds.set(`COMMUNITY:${category.slug}`, id);
    await syncCategoryAliases(id, `COMMUNITY:${category.slug}`, category.aliases);
  }

  const seedOwnerId = stableSeedUuid("user:synthetic-seed-owner");
  await transaction.user.upsert({
    where: { id: seedOwnerId },
    create: {
      id: seedOwnerId,
      email: "synthetic-seed-owner@example.invalid",
      profile: {
        create: {
          displayName: "Synthetic Seed Owner",
          preferredLocale: "zh-Hans",
        },
      },
    },
    update: { email: "synthetic-seed-owner@example.invalid" },
  });
  await transaction.userProfile.upsert({
    where: { userId: seedOwnerId },
    create: {
      userId: seedOwnerId,
      displayName: "Synthetic Seed Owner",
      preferredLocale: "zh-Hans",
    },
    update: {
      displayName: "Synthetic Seed Owner",
      preferredLocale: "zh-Hans",
    },
  });

  for (const [index, listing] of seed.listings.listings.entries()) {
    const id = stableSeedUuid(`listing:${listing.type}:${index}`);
    const categoryId = categoryIds.get(`${listing.type}:${listing.categorySlug}`);
    const regionId = regionIds.get(listing.regionCode);
    if (!categoryId || !regionId) {
      throw new Error(`Seed listing ${index} references unknown taxonomy`);
    }
    const values = {
      type: ListingType[listing.type],
      ownerId: seedOwnerId,
      categoryId,
      regionId,
      status: ContentStatus.DRAFT,
      moderationStatus: ModerationStatus.NOT_REVIEWED,
      locale: "zh-Hans",
      title: `[示例] ${listing.title}`,
      slug: `synthetic-${listing.type.toLowerCase()}-${index + 1}`,
      summary: listing.summary,
      body: listing.body,
      priceAmount: new Prisma.Decimal(listing.price.amount),
      currency: listing.price.currency,
      priceUnit: PriceUnit[listing.price.unit],
      attributes: listing.attributes as Prisma.InputJsonValue,
      publishedAt: null,
      deletedAt: null,
    };
    await transaction.listing.upsert({
      where: { id },
      create: { id, ...values },
      update: values,
    });
  }

  return {
    regions: regionIds.size,
    regionAliases: regionAliasCount,
    categories: categoryIds.size,
    categoryAliases: categoryAliasCount,
    listings: seed.listings.listings.length,
    users: 1,
    sourceVersion: seed.regions.version,
  };
}
