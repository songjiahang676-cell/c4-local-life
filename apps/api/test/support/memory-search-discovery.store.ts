import type { SearchSuggestion } from "@socal/contracts";
import type {
  PrivacySafeSearchQuery,
  PrivacySafeSearchQueryInput,
  PublishedSearchDictionary,
  SearchDictionaryLifecycle,
  SearchDictionaryMutationResult,
  SearchDiscoveryStore,
  SearchSampleInput,
  SearchTaxonomySuggestionInput,
} from "../../src/modules/search/search-discovery.store";

export class MemorySearchDiscoveryStore implements SearchDiscoveryStore {
  readonly dictionaries = new Map<number, PublishedSearchDictionary>();
  readonly samples: SearchSampleInput[] = [];
  readonly taxonomySuggestions: SearchSuggestion[] = [];
  readonly privacySafeQueries: PrivacySafeSearchQuery[] = [];
  readonly taxonomyInputs: SearchTaxonomySuggestionInput[] = [];
  readonly privacyInputs: PrivacySafeSearchQueryInput[] = [];
  currentVersion = 0;
  draft: PublishedSearchDictionary | null = null;
  error: Error | null = null;

  getPublishedDictionary(version?: number): Promise<PublishedSearchDictionary | null> {
    this.#throwIfNeeded();
    return Promise.resolve(this.dictionaries.get(version ?? this.currentVersion) ?? null);
  }

  getDictionaryLifecycle(): Promise<SearchDictionaryLifecycle> {
    this.#throwIfNeeded();
    return Promise.resolve({
      currentVersion: this.currentVersion,
      draft: this.draft,
      published: [...this.dictionaries.values()].sort(
        (left, right) => left.version - right.version,
      ),
    });
  }

  saveDictionaryDraft(
    input: Parameters<SearchDiscoveryStore["saveDictionaryDraft"]>[0],
  ): Promise<SearchDictionaryMutationResult> {
    this.#throwIfNeeded();
    if (input.expectedCurrentVersion !== this.currentVersion) {
      return Promise.resolve({
        kind: "current_version_conflict",
        currentVersion: this.currentVersion,
      });
    }
    const revision = this.draft ? this.draft.revision + 1 : 1;
    if (
      this.draft &&
      (input.expectedDraftRevision === undefined ||
        input.expectedDraftRevision !== this.draft.revision)
    ) {
      return Promise.resolve({
        kind: "draft_revision_conflict",
        currentDraftRevision: this.draft.revision,
      });
    }
    const now = new Date("2026-07-29T12:00:00.000Z");
    this.draft = {
      version: this.currentVersion + 1,
      revision,
      definition: input.definition,
      contentHash: input.contentHash,
      basedOnVersion: null,
      createdById: this.draft?.createdById ?? input.actorId,
      updatedById: input.actorId,
      publishedById: null,
      createdAt: this.draft?.createdAt ?? now,
      updatedAt: now,
      publishedAt: null,
    };
    return Promise.resolve({ kind: "ok", dictionary: this.draft });
  }

  publishDictionaryDraft(
    input: Parameters<SearchDiscoveryStore["publishDictionaryDraft"]>[0],
  ): Promise<SearchDictionaryMutationResult> {
    this.#throwIfNeeded();
    if (!this.draft) return Promise.resolve({ kind: "draft_missing" });
    if (this.draft.updatedById === input.reviewerId) {
      return Promise.resolve({ kind: "review_required" });
    }
    const published = {
      ...this.draft,
      publishedById: input.reviewerId,
      publishedAt: input.publishedAt ?? new Date("2026-07-29T13:00:00.000Z"),
    };
    this.currentVersion = published.version;
    this.dictionaries.set(published.version, published);
    this.draft = null;
    return Promise.resolve({ kind: "ok", dictionary: published });
  }

  rollbackDictionary(
    input: Parameters<SearchDiscoveryStore["rollbackDictionary"]>[0],
  ): Promise<SearchDictionaryMutationResult> {
    this.#throwIfNeeded();
    if (input.expectedCurrentVersion !== this.currentVersion) {
      return Promise.resolve({
        kind: "current_version_conflict",
        currentVersion: this.currentVersion,
      });
    }
    if (this.draft) {
      return Promise.resolve({
        kind: "draft_revision_conflict",
        currentDraftRevision: this.draft.revision,
      });
    }
    const target = this.dictionaries.get(input.targetVersion);
    if (!target) return Promise.resolve({ kind: "target_missing" });
    this.draft = {
      ...target,
      version: this.currentVersion + 1,
      revision: 1,
      basedOnVersion: target.version,
      createdById: input.actorId,
      updatedById: input.actorId,
      publishedById: null,
      createdAt: new Date("2026-07-29T14:00:00.000Z"),
      updatedAt: new Date("2026-07-29T14:00:00.000Z"),
      publishedAt: null,
    };
    return Promise.resolve({ kind: "ok", dictionary: this.draft });
  }

  listTaxonomySuggestions(input: SearchTaxonomySuggestionInput): Promise<SearchSuggestion[]> {
    this.#throwIfNeeded();
    this.taxonomyInputs.push(input);
    return Promise.resolve(this.taxonomySuggestions.slice(0, input.limit));
  }

  recordQuerySample(input: SearchSampleInput): Promise<"recorded" | "duplicate"> {
    this.#throwIfNeeded();
    const duplicate = this.samples.some(
      (sample) =>
        sample.queryHash === input.queryHash &&
        sample.sourceHash === input.sourceHash &&
        sample.createdAt.toISOString().slice(0, 10) === input.createdAt.toISOString().slice(0, 10),
    );
    if (!duplicate) this.samples.push(input);
    return Promise.resolve(duplicate ? "duplicate" : "recorded");
  }

  findPrivacySafeQueries(input: PrivacySafeSearchQueryInput): Promise<PrivacySafeSearchQuery[]> {
    this.#throwIfNeeded();
    this.privacyInputs.push(input);
    return Promise.resolve(
      this.privacySafeQueries
        .filter(
          (entry) =>
            entry.sourceCount >= Math.max(5, input.minimumSources) &&
            (input.prefix === undefined ||
              entry.queryText
                .toLocaleLowerCase("en-US")
                .startsWith(input.prefix.toLocaleLowerCase("en-US"))),
        )
        .slice(0, input.limit),
    );
  }

  pruneExpiredSamples(): Promise<number> {
    this.#throwIfNeeded();
    return Promise.resolve(0);
  }

  #throwIfNeeded(): void {
    if (this.error) throw this.error;
  }
}
