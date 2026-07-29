import { Inject, Injectable, type OnModuleDestroy } from "@nestjs/common";
import type { ApiEnvironment } from "@socal/config";
import {
  publicListingSummarySchema,
  searchDictionaryDefinitionSchema,
  type HomepageCitiesModule,
  type Money,
  type PublicListingSummaryView,
  type SearchTrendingItem,
} from "@socal/contracts";
import { ListingRepository, type PublicListingProjection } from "@socal/database/listing";
import { SearchDiscoveryRepository } from "@socal/database/search-discovery";
import { TaxonomyRepository } from "@socal/database/taxonomy";
import { API_ENVIRONMENT } from "../../common/api-environment.token";
import { privacySafeSearchQuery } from "../search/search-discovery.service";
import type { HomepageDataSource } from "./homepage-data.source";

const minimumPublicSources = 5;

function listingMoney(price: PublicListingProjection["price"]): Money | null {
  if (!price) return null;
  if (
    price.currency !== "USD" ||
    price.unit === null ||
    ![
      "FIXED",
      "HOURLY",
      "DAILY",
      "WEEKLY",
      "MONTHLY",
      "YEARLY",
      "SQFT",
      "FREE",
      "NEGOTIABLE",
    ].includes(price.unit)
  ) {
    throw new Error("Stored homepage Listing price is invalid");
  }
  return {
    amount: price.amount,
    currency: "USD",
    unit: price.unit,
  };
}

function listingLocationPrecision(
  value: string,
): PublicListingSummaryView["location"]["precision"] {
  if (
    value === "CITY" ||
    value === "NEIGHBORHOOD" ||
    value === "APPROXIMATE" ||
    value === "EXACT"
  ) {
    return value;
  }
  throw new Error("Stored homepage Listing location precision is invalid");
}

function publicListingSummary(listing: PublicListingProjection): PublicListingSummaryView {
  if (listing.locale !== "zh-Hans" && listing.locale !== "en-US") {
    throw new Error("Stored homepage Listing locale is invalid");
  }
  return publicListingSummarySchema.parse({
    id: listing.id,
    type: listing.type,
    status: "PUBLISHED",
    locale: listing.locale,
    title: listing.title,
    slug: listing.slug,
    summary: listing.summary,
    price: listingMoney(listing.price),
    region: listing.region,
    category: listing.category,
    owner: listing.owner,
    organization: listing.organization,
    // Exact coordinates are deliberately excluded from this shared public projection.
    location: { precision: listingLocationPrecision(listing.location.precision) },
    attributes: listing.attributes,
    featured: listing.featured,
    featuredUntil: listing.featuredUntil?.toISOString() ?? null,
    publishedAt: listing.publishedAt.toISOString(),
    expiresAt: listing.expiresAt.toISOString(),
    updatedAt: listing.updatedAt.toISOString(),
    version: listing.version,
  });
}

function trendingWindowMilliseconds(window: "DAY_1" | "DAY_7" | "DAY_30"): number {
  if (window === "DAY_1") return 24 * 60 * 60 * 1_000;
  if (window === "DAY_30") return 30 * 24 * 60 * 60 * 1_000;
  return 7 * 24 * 60 * 60 * 1_000;
}

@Injectable()
export class DatabaseHomepageDataSource implements HomepageDataSource, OnModuleDestroy {
  readonly #listings: ListingRepository;
  readonly #taxonomy: TaxonomyRepository;
  readonly #searchDiscovery: SearchDiscoveryRepository;

  constructor(@Inject(API_ENVIRONMENT) environment: ApiEnvironment) {
    const options = {
      connectionString: environment.DATABASE_URL,
      poolMaximum: environment.DATABASE_POOL_MAX,
    };
    this.#listings = new ListingRepository(options);
    this.#taxonomy = new TaxonomyRepository(options);
    this.#searchDiscovery = new SearchDiscoveryRepository(options);
  }

  async listTrending(input: {
    locale: "zh-Hans" | "en-US";
    regionCode?: string;
    window: "DAY_1" | "DAY_7" | "DAY_30";
    limit: number;
    now: Date;
  }): Promise<readonly SearchTrendingItem[]> {
    const dictionaryRecord = await this.#searchDiscovery.getPublished();
    const dictionary = dictionaryRecord
      ? searchDictionaryDefinitionSchema.parse(dictionaryRecord.definition)
      : null;
    const entries = await this.#searchDiscovery.findPrivacySafeQueries({
      locale: input.locale,
      ...(input.regionCode ? { regionCode: input.regionCode } : {}),
      since: new Date(input.now.getTime() - trendingWindowMilliseconds(input.window)),
      now: input.now,
      minimumSources: minimumPublicSources,
      limit: Math.min(20, input.limit * 2),
    });
    return entries
      .flatMap((entry) => {
        const query = privacySafeSearchQuery(entry.queryText, input.locale, dictionary);
        return query ? [query] : [];
      })
      .slice(0, input.limit)
      .map((query, index) => ({
        query,
        rank: index + 1,
        locale: input.locale,
      }));
  }

  async listCities(input: {
    locale: "zh-Hans" | "en-US";
    limit: number;
  }): Promise<readonly HomepageCitiesModule["data"]["items"][number][]> {
    const regions = await this.#taxonomy.listRegions({
      activeOnly: true,
      type: "CITY",
    });
    return regions.slice(0, input.limit).map((region) => ({
      id: region.id,
      code: region.code,
      slug: region.slug,
      type: "CITY",
      name: input.locale === "zh-Hans" ? region.nameZhHans : region.nameEn,
    }));
  }

  async listListings(input: {
    listingType: PublicListingSummaryView["type"];
    categoryId?: string;
    regionCode: string;
    limit: number;
    now: Date;
  }): Promise<readonly PublicListingSummaryView[]> {
    const result = await this.#listings.listPublic({
      type: input.listingType,
      ...(input.categoryId ? { categoryId: input.categoryId } : {}),
      regionCode: input.regionCode,
      limit: input.limit,
      now: input.now,
    });
    return result.items.map(publicListingSummary);
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all([
      this.#listings.close(),
      this.#taxonomy.close(),
      this.#searchDiscovery.close(),
    ]);
  }
}
