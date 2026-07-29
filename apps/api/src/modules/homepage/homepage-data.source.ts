import type {
  HomepageCitiesModule,
  PublicListingSummaryView,
  SearchTrendingItem,
  ValidatedSearchTrendingQuery,
} from "@socal/contracts";

export const HOMEPAGE_DATA_SOURCE = Symbol("HOMEPAGE_DATA_SOURCE");

export type HomepageCity = HomepageCitiesModule["data"]["items"][number];

export type HomepageDataSource = {
  listTrending(input: {
    locale: "zh-Hans" | "en-US";
    regionCode?: string;
    window: ValidatedSearchTrendingQuery["window"];
    limit: number;
    now: Date;
  }): Promise<readonly SearchTrendingItem[]>;
  listCities(input: {
    locale: "zh-Hans" | "en-US";
    limit: number;
  }): Promise<readonly HomepageCity[]>;
  listListings(input: {
    listingType: PublicListingSummaryView["type"];
    categoryId?: string;
    regionCode: string;
    limit: number;
    now: Date;
  }): Promise<readonly PublicListingSummaryView[]>;
};
