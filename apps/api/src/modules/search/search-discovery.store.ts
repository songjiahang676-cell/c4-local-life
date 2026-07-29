import type { SearchDictionaryDefinition, SearchSuggestion } from "@socal/contracts";

export const SEARCH_DISCOVERY_STORE = Symbol("SEARCH_DISCOVERY_STORE");

export type PublishedSearchDictionary = {
  version: number;
  revision: number;
  definition: SearchDictionaryDefinition;
  contentHash: string;
  basedOnVersion: number | null;
  createdById: string;
  updatedById: string;
  publishedById: string | null;
  createdAt: Date;
  updatedAt: Date;
  publishedAt: Date | null;
};

export type SearchDictionaryLifecycle = {
  currentVersion: number;
  draft: PublishedSearchDictionary | null;
  published: PublishedSearchDictionary[];
};

export type SearchDictionaryMutationResult =
  | { kind: "ok"; dictionary: PublishedSearchDictionary }
  | {
      kind:
        | "current_version_conflict"
        | "draft_missing"
        | "draft_revision_conflict"
        | "review_required"
        | "target_missing";
      currentVersion?: number;
      currentDraftRevision?: number;
    };

export type SearchTaxonomySuggestionInput = {
  q?: string;
  locale: "zh-Hans" | "en-US";
  regionCode?: string;
  limit: number;
};

export type SearchSampleInput = {
  queryHash: string;
  sourceHash: string;
  queryText: string;
  locale: "zh-Hans" | "en-US";
  regionCode?: string;
  createdAt: Date;
  expiresAt: Date;
};

export type PrivacySafeSearchQuery = {
  queryText: string;
  sourceCount: number;
  lastSeenAt: Date;
};

export type PrivacySafeSearchQueryInput = {
  locale: "zh-Hans" | "en-US";
  regionCode?: string;
  prefix?: string;
  since: Date;
  now: Date;
  minimumSources: number;
  limit: number;
};

export interface SearchDiscoveryStore {
  getPublishedDictionary(version?: number): Promise<PublishedSearchDictionary | null>;
  getDictionaryLifecycle(): Promise<SearchDictionaryLifecycle>;
  saveDictionaryDraft(input: {
    expectedCurrentVersion: number;
    expectedDraftRevision?: number;
    definition: SearchDictionaryDefinition;
    contentHash: string;
    actorId: string;
  }): Promise<SearchDictionaryMutationResult>;
  publishDictionaryDraft(input: {
    expectedCurrentVersion: number;
    expectedDraftRevision: number;
    reviewerId: string;
    publishedAt?: Date;
  }): Promise<SearchDictionaryMutationResult>;
  rollbackDictionary(input: {
    expectedCurrentVersion: number;
    targetVersion: number;
    actorId: string;
  }): Promise<SearchDictionaryMutationResult>;
  listTaxonomySuggestions(input: SearchTaxonomySuggestionInput): Promise<SearchSuggestion[]>;
  recordQuerySample(input: SearchSampleInput): Promise<"recorded" | "duplicate">;
  findPrivacySafeQueries(input: PrivacySafeSearchQueryInput): Promise<PrivacySafeSearchQuery[]>;
  pruneExpiredSamples(input: { now: Date; limit: number }): Promise<number>;
}

export class SearchDiscoveryUnavailableError extends Error {
  readonly code = "SEARCH_DISCOVERY_UNAVAILABLE";

  constructor() {
    super("Search discovery is temporarily unavailable");
    this.name = "SearchDiscoveryUnavailableError";
  }
}

export class NoopSearchDiscoveryStore implements SearchDiscoveryStore {
  getPublishedDictionary(): Promise<null> {
    return Promise.resolve(null);
  }

  getDictionaryLifecycle(): Promise<SearchDictionaryLifecycle> {
    return Promise.resolve({ currentVersion: 0, draft: null, published: [] });
  }

  saveDictionaryDraft(): Promise<SearchDictionaryMutationResult> {
    return Promise.reject(new SearchDiscoveryUnavailableError());
  }

  publishDictionaryDraft(): Promise<SearchDictionaryMutationResult> {
    return Promise.reject(new SearchDiscoveryUnavailableError());
  }

  rollbackDictionary(): Promise<SearchDictionaryMutationResult> {
    return Promise.reject(new SearchDiscoveryUnavailableError());
  }

  listTaxonomySuggestions(): Promise<SearchSuggestion[]> {
    return Promise.resolve([]);
  }

  recordQuerySample(): Promise<"duplicate"> {
    return Promise.resolve("duplicate");
  }

  findPrivacySafeQueries(): Promise<PrivacySafeSearchQuery[]> {
    return Promise.resolve([]);
  }

  pruneExpiredSamples(): Promise<number> {
    return Promise.resolve(0);
  }
}
