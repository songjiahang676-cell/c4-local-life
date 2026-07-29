import type { ListingSearchInput, SearchListingResult } from "@socal/contracts";

export const SEARCH_STORE = Symbol("SEARCH_STORE");

export type SearchSortValue = string | number | null;

export type SearchFacetBucket = Readonly<{
  value: string;
  count: number;
}>;

export type SearchFacets = Readonly<{
  types: readonly SearchFacetBucket[];
  categories: readonly SearchFacetBucket[];
  regions: readonly SearchFacetBucket[];
  priceUnits: readonly SearchFacetBucket[];
}>;

export type SearchCriteria = Omit<ListingSearchInput, "cursor">;

export type SearchStoreInput = Readonly<{
  snapshotId: string;
  snapshotAt: string;
  criteria: SearchCriteria;
  queryTerms?: readonly string[];
  searchAfter?: readonly SearchSortValue[];
  keepAliveSeconds: number;
  timeoutMilliseconds: number;
}>;

export type SearchStoreHit = Readonly<{
  result: SearchListingResult;
  sort: readonly SearchSortValue[];
}>;

export type SearchStoreResult = Readonly<{
  hits: readonly SearchStoreHit[];
  facets: SearchFacets;
  tookMilliseconds: number;
}>;

export interface SearchStore {
  openSnapshot(keepAliveSeconds: number): Promise<string>;
  search(input: SearchStoreInput): Promise<SearchStoreResult>;
  closeSnapshot(snapshotId: string): Promise<void>;
}

export class SearchSnapshotExpiredError extends Error {
  readonly code = "SEARCH_SNAPSHOT_EXPIRED";

  constructor() {
    super("The search cursor has expired");
    this.name = "SearchSnapshotExpiredError";
  }
}

export class SearchTimeoutError extends Error {
  readonly code = "SEARCH_TIMEOUT";

  constructor() {
    super("Search exceeded its bounded execution time");
    this.name = "SearchTimeoutError";
  }
}

export class SearchUnavailableError extends Error {
  readonly code: string = "SEARCH_UNAVAILABLE";

  constructor() {
    super("Search is temporarily unavailable");
    this.name = "SearchUnavailableError";
  }
}

export class SearchProjectionError extends SearchUnavailableError {
  override readonly code = "SEARCH_PROJECTION_INVALID";

  constructor() {
    super();
    this.name = "SearchProjectionError";
    this.message = "The search projection does not satisfy the public response contract";
  }
}
