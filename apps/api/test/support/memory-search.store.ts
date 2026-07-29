import type { SearchListingResult } from "@socal/contracts";
import type {
  SearchStore,
  SearchStoreInput,
  SearchStoreResult,
} from "../../src/modules/search/search.store";

const defaultFacets = {
  types: [],
  categories: [],
  regions: [],
  priceUnits: [],
} as const;

export function syntheticSearchResult(
  overrides: Partial<SearchListingResult> = {},
): SearchListingResult {
  return {
    id: "81000000-0000-4000-8000-000000000001",
    type: "RENTAL",
    status: "PUBLISHED",
    locale: "en-US",
    slug: "synthetic-irvine-rental",
    title: "Synthetic Irvine rental",
    summary: "Contract-safe fictional search result.",
    price: { amount: "2500", currency: "USD", unit: "MONTHLY" },
    region: {
      id: "82000000-0000-4000-8000-000000000001",
      code: "US-CA-ORANGE-IRVINE",
      slug: "irvine",
      nameZhHans: "测试尔湾",
      nameEn: "Irvine",
    },
    category: {
      id: "83000000-0000-4000-8000-000000000001",
      vertical: "RENTAL",
      slug: "rentals",
      nameZhHans: "测试租房",
      nameEn: "Rentals",
    },
    owner: {
      id: "84000000-0000-4000-8000-000000000001",
      displayName: "Synthetic Publisher",
      avatarUrl: null,
    },
    organization: null,
    location: {
      precision: "APPROXIMATE",
      point: { latitude: 33.6846, longitude: -117.8265 },
    },
    attributes: { bedrooms: 2 },
    sponsored: false,
    distanceMiles: null,
    publishedAt: "2026-07-28T12:00:00.000Z",
    expiresAt: "2026-08-28T12:00:00.000Z",
    updatedAt: "2026-07-28T12:00:00.000Z",
    version: 1,
    ...overrides,
  };
}

export function searchStoreResult(
  hits: SearchStoreResult["hits"] = [],
  overrides: Partial<SearchStoreResult> = {},
): SearchStoreResult {
  return {
    hits,
    facets: defaultFacets,
    tookMilliseconds: 7,
    ...overrides,
  };
}

export class MemorySearchStore implements SearchStore {
  readonly opened: number[] = [];
  readonly searched: SearchStoreInput[] = [];
  readonly closed: string[] = [];
  readonly results: SearchStoreResult[] = [];
  readonly errors: Error[] = [];
  #snapshotSequence = 0;

  openSnapshot(keepAliveSeconds: number): Promise<string> {
    this.opened.push(keepAliveSeconds);
    this.#snapshotSequence += 1;
    return Promise.resolve(`memory-pit-${this.#snapshotSequence}`);
  }

  search(input: SearchStoreInput): Promise<SearchStoreResult> {
    this.searched.push(input);
    const error = this.errors.shift();
    if (error) return Promise.reject(error);
    return Promise.resolve(this.results.shift() ?? searchStoreResult());
  }

  closeSnapshot(snapshotId: string): Promise<void> {
    this.closed.push(snapshotId);
    return Promise.resolve();
  }
}
