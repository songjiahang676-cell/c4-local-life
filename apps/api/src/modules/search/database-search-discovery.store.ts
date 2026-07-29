import { Inject, Injectable, type OnModuleDestroy } from "@nestjs/common";
import type { ApiEnvironment } from "@socal/config";
import { searchDictionaryDefinitionSchema, type SearchSuggestion } from "@socal/contracts";
import {
  SearchDiscoveryRepository,
  type SearchDictionaryMutationResult as DatabaseMutationResult,
  type SearchDictionaryRecord,
} from "@socal/database/search-discovery";
import {
  TaxonomyRepository,
  type CategoryTaxonomyRecord,
  type RegionTaxonomyRecord,
} from "@socal/database/taxonomy";
import { API_ENVIRONMENT } from "../../common/api-environment.token";
import {
  SearchDiscoveryUnavailableError,
  type PublishedSearchDictionary,
  type SearchDictionaryLifecycle,
  type SearchDictionaryMutationResult,
  type SearchDiscoveryStore,
  type SearchSampleInput,
  type SearchTaxonomySuggestionInput,
  type PrivacySafeSearchQuery,
  type PrivacySafeSearchQueryInput,
} from "./search-discovery.store";

function parseDictionary(record: SearchDictionaryRecord): PublishedSearchDictionary {
  return {
    ...record,
    definition: searchDictionaryDefinitionSchema.parse(record.definition),
  };
}

function mapMutation(result: DatabaseMutationResult): SearchDictionaryMutationResult {
  return result.kind === "ok"
    ? { kind: "ok", dictionary: parseDictionary(result.dictionary) }
    : result;
}

function taxonomyLabel(
  record: CategoryTaxonomyRecord | RegionTaxonomyRecord,
  locale: "zh-Hans" | "en-US",
): string {
  return locale === "zh-Hans" ? record.nameZhHans : record.nameEn;
}

@Injectable()
export class DatabaseSearchDiscoveryStore implements SearchDiscoveryStore, OnModuleDestroy {
  readonly #discovery: SearchDiscoveryRepository;
  readonly #taxonomy: TaxonomyRepository;

  constructor(@Inject(API_ENVIRONMENT) environment: ApiEnvironment) {
    const options = {
      connectionString: environment.DATABASE_URL,
      poolMaximum: environment.DATABASE_POOL_MAX,
    };
    this.#discovery = new SearchDiscoveryRepository(options);
    this.#taxonomy = new TaxonomyRepository(options);
  }

  async getPublishedDictionary(version?: number): Promise<PublishedSearchDictionary | null> {
    try {
      const record = await this.#discovery.getPublished(version);
      return record ? parseDictionary(record) : null;
    } catch {
      throw new SearchDiscoveryUnavailableError();
    }
  }

  async getDictionaryLifecycle(): Promise<SearchDictionaryLifecycle> {
    try {
      const lifecycle = await this.#discovery.getLifecycle();
      return {
        currentVersion: lifecycle.currentVersion,
        draft: lifecycle.draft ? parseDictionary(lifecycle.draft) : null,
        published: lifecycle.published.map(parseDictionary),
      };
    } catch {
      throw new SearchDiscoveryUnavailableError();
    }
  }

  async saveDictionaryDraft(
    input: Parameters<SearchDiscoveryStore["saveDictionaryDraft"]>[0],
  ): Promise<SearchDictionaryMutationResult> {
    try {
      return mapMutation(await this.#discovery.saveDraft(input));
    } catch {
      throw new SearchDiscoveryUnavailableError();
    }
  }

  async publishDictionaryDraft(
    input: Parameters<SearchDiscoveryStore["publishDictionaryDraft"]>[0],
  ): Promise<SearchDictionaryMutationResult> {
    try {
      return mapMutation(await this.#discovery.publishDraft(input));
    } catch {
      throw new SearchDiscoveryUnavailableError();
    }
  }

  async rollbackDictionary(
    input: Parameters<SearchDiscoveryStore["rollbackDictionary"]>[0],
  ): Promise<SearchDictionaryMutationResult> {
    try {
      return mapMutation(await this.#discovery.rollback(input));
    } catch {
      throw new SearchDiscoveryUnavailableError();
    }
  }

  async listTaxonomySuggestions(input: SearchTaxonomySuggestionInput): Promise<SearchSuggestion[]> {
    try {
      const [categories, regions] = await Promise.all([
        this.#taxonomy.listCategories({
          activeOnly: true,
          ...(input.q ? { query: input.q } : {}),
        }),
        this.#taxonomy.listRegions({
          activeOnly: true,
          ...(input.q ? { query: input.q } : {}),
        }),
      ]);
      const suggestions: SearchSuggestion[] = [
        ...categories.map((category) => ({
          type: "CATEGORY" as const,
          label: taxonomyLabel(category, input.locale),
          value: category.slug,
          locale: input.locale,
        })),
        ...regions
          .sort((left, right) => {
            const leftPreferred = left.code === input.regionCode ? 0 : 1;
            const rightPreferred = right.code === input.regionCode ? 0 : 1;
            return leftPreferred - rightPreferred;
          })
          .map((region) => ({
            type: "REGION" as const,
            label: taxonomyLabel(region, input.locale),
            value: region.code,
            locale: input.locale,
          })),
      ];
      return suggestions.slice(0, input.limit);
    } catch {
      throw new SearchDiscoveryUnavailableError();
    }
  }

  async recordQuerySample(input: SearchSampleInput): Promise<"recorded" | "duplicate"> {
    try {
      return await this.#discovery.recordQuerySample(input);
    } catch {
      throw new SearchDiscoveryUnavailableError();
    }
  }

  async findPrivacySafeQueries(
    input: PrivacySafeSearchQueryInput,
  ): Promise<PrivacySafeSearchQuery[]> {
    try {
      return await this.#discovery.findPrivacySafeQueries(input);
    } catch {
      throw new SearchDiscoveryUnavailableError();
    }
  }

  async pruneExpiredSamples(input: { now: Date; limit: number }): Promise<number> {
    try {
      return await this.#discovery.pruneExpiredSamples(input);
    } catch {
      throw new SearchDiscoveryUnavailableError();
    }
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all([this.#discovery.close(), this.#taxonomy.close()]);
  }
}
