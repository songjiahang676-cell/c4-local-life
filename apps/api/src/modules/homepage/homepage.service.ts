import { createHash } from "node:crypto";
import { Inject, Injectable, Optional } from "@nestjs/common";
import {
  homepageResponseSchema,
  type HomepageModule,
  type HomepageResponse,
  type HomepageLayoutSlot,
  type ValidatedHomepageQuery,
} from "@socal/contracts";
import type { MetricsRegistry } from "@socal/observability";
import { API_METRICS } from "../../common/api-metrics.token";
import { HomepageLayoutService } from "../homepage-layout/homepage-layout.service";
import { HOMEPAGE_DATA_SOURCE, type HomepageDataSource } from "./homepage-data.source";

const heroCopy = {
  "homepage.hero": {
    "zh-Hans": {
      title: "南加州华人生活，一站式本地服务",
      subtitle: "连接真实的招聘、租房、转让、二手与本地服务信息。",
      searchPlaceholder: "搜索招聘、租房、转让、二手或本地服务",
    },
    "en-US": {
      title: "Southern California life, in one local place",
      subtitle: "Explore real jobs, rentals, transfers, marketplace and local service listings.",
      searchPlaceholder: "Search jobs, rentals, transfers, marketplace or services",
    },
  },
} as const;

type SupportedSlot = Extract<
  HomepageLayoutSlot,
  { kind: "HERO" | "HOT_SEARCHES" | "CITY_CHIPS" | "LISTING_FEED" }
>;

function moduleDataVersion(data: HomepageModule["data"]): string {
  return createHash("sha256").update(JSON.stringify(data), "utf8").digest("hex");
}

function cachePolicy(slot: HomepageLayoutSlot, tags: readonly string[]): HomepageModule["cache"] {
  return {
    ttlSeconds: slot.cacheTtlSeconds,
    tags: [...new Set(tags)].slice(0, 8),
  };
}

function supportedSlot(slot: HomepageLayoutSlot): slot is SupportedSlot {
  return (
    slot.kind === "HERO" ||
    slot.kind === "HOT_SEARCHES" ||
    slot.kind === "CITY_CHIPS" ||
    slot.kind === "LISTING_FEED"
  );
}

@Injectable()
export class HomepageService {
  constructor(
    private readonly layouts: HomepageLayoutService,
    @Inject(HOMEPAGE_DATA_SOURCE)
    private readonly dataSource: HomepageDataSource,
    @Optional() @Inject(API_METRICS) private readonly metrics?: MetricsRegistry,
  ) {}

  async get(query: ValidatedHomepageQuery, now = new Date()): Promise<HomepageResponse> {
    const published = await this.layouts.getPublished({
      locale: query.locale,
      regionCode: query.regionCode,
    });

    const enabled = published.definition.slots.filter(
      (slot): slot is SupportedSlot => slot.enabled && supportedSlot(slot),
    );
    let partial = false;
    const modules = (
      await Promise.all(
        enabled.map(async (slot): Promise<HomepageModule | null> => {
          try {
            const module = await this.#loadModule(slot, query, published.definition.version, now);
            this.metrics?.homepageModule({
              kind: slot.kind,
              outcome: module ? "success" : "empty",
            });
            return module;
          } catch {
            partial = true;
            this.metrics?.homepageModule({ kind: slot.kind, outcome: "unavailable" });
            return null;
          }
        }),
      )
    ).filter((module): module is HomepageModule => module !== null);

    return homepageResponseSchema.parse({
      layout: {
        version: published.definition.version,
        locale: query.locale,
        regionCode: query.regionCode,
        device: query.device,
      },
      modules,
      partial,
      generatedAt: now.toISOString(),
    });
  }

  async #loadModule(
    slot: SupportedSlot,
    query: ValidatedHomepageQuery,
    layoutVersion: number,
    now: Date,
  ): Promise<HomepageModule | null> {
    const configTag = `homepage.config.${query.locale}.${query.regionCode}.v${layoutVersion}`;
    if (slot.kind === "HERO") {
      const localized = heroCopy[slot.source.contentKey as keyof typeof heroCopy]?.[query.locale];
      if (!localized) return null;
      const data = {
        contentKey: slot.source.contentKey,
        ...localized,
      };
      return {
        key: slot.key,
        kind: "HERO",
        dataVersion: moduleDataVersion(data),
        cache: cachePolicy(slot, [configTag]),
        data,
      };
    }
    if (slot.kind === "HOT_SEARCHES") {
      const items = await this.dataSource.listTrending({
        locale: query.locale,
        ...(slot.source.regionScoped ? { regionCode: query.regionCode } : {}),
        window: slot.source.window,
        limit: Math.min(slot.limit, 10),
        now,
      });
      if (items.length === 0) return null;
      const data = { window: slot.source.window, items };
      return {
        key: slot.key,
        kind: "HOT_SEARCHES",
        dataVersion: moduleDataVersion(data),
        cache: cachePolicy(slot, [configTag, "homepage.search-trends"]),
        data,
      };
    }
    if (slot.kind === "CITY_CHIPS") {
      const items = await this.dataSource.listCities({
        locale: query.locale,
        limit: slot.limit,
      });
      if (items.length === 0) return null;
      const data = { items };
      return {
        key: slot.key,
        kind: "CITY_CHIPS",
        dataVersion: moduleDataVersion(data),
        cache: cachePolicy(slot, [configTag, "homepage.regions"]),
        data,
      };
    }
    const items = await this.dataSource.listListings({
      listingType: slot.source.listingType,
      ...(slot.source.categoryId ? { categoryId: slot.source.categoryId } : {}),
      regionCode: query.regionCode,
      limit: slot.limit,
      now,
    });
    if (items.length === 0) return null;
    const data = { listingType: slot.source.listingType, items };
    return {
      key: slot.key,
      kind: "LISTING_FEED",
      dataVersion: moduleDataVersion(data),
      cache: cachePolicy(slot, [configTag, `homepage.listings.${slot.source.listingType}`]),
      data,
    };
  }
}
