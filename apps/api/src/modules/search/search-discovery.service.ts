import { createHash, createHmac } from "node:crypto";
import { Inject, Injectable, Optional } from "@nestjs/common";
import type { ApiEnvironment } from "@socal/config";
import type {
  SearchDictionaryDefinition,
  SearchSuggestion,
  SearchSuggestionResponse,
  SearchTrendingResponse,
  ValidatedSearchSuggestionsQuery,
  ValidatedSearchTrendingQuery,
} from "@socal/contracts";
import type { MetricsRegistry } from "@socal/observability";
import { API_ENVIRONMENT } from "../../common/api-environment.token";
import { API_METRICS } from "../../common/api-metrics.token";
import {
  SEARCH_DISCOVERY_STORE,
  SearchDiscoveryUnavailableError,
  type PublishedSearchDictionary,
  type SearchDiscoveryStore,
} from "./search-discovery.store";

const minimumPublicSources = 5;
const sampleRetentionMilliseconds = 30 * 24 * 60 * 60 * 1_000;
const recentSuggestionMilliseconds = 30 * 24 * 60 * 60 * 1_000;
const maximumExpandedTerms = 8;
const botPattern =
  /(?:bot|crawler|spider|slurp|headless|preview|curl|wget|python-requests|postman|lighthouse)/i;
const emailPattern = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const urlPattern = /(?:https?:\/\/|www\.)\S+/i;
const phonePattern = /(?:^|[^\d])\+?\d[\d\s().-]{5,}\d(?:$|[^\d])/;
const longNumberPattern = /\d{7,}/;
const addressPattern =
  /\b\d{1,6}\s+(?:[\p{L}.-]+\s+){0,4}(?:street|st|avenue|ave|road|rd|boulevard|blvd|drive|dr|lane|ln)\b/iu;
const chineseAddressPattern = /(?:路|街|大道|巷)\s*\d{1,6}\s*号|\d{1,6}\s*号/u;
const contactHandlePattern = /(?:wechat|微信|wx)\s*[:：]?\s*[A-Za-z0-9_-]{5,}/iu;
const forbiddenBidiPattern = /[\u202a-\u202e\u2066-\u2069]/u;

export type SearchRequestContext = {
  ip: string;
  userAgent?: string;
  locale: "zh-Hans" | "en-US";
};

export type ResolvedSearchQuery = {
  dictionaryVersion: number;
  queryTerms: readonly string[];
  correctedQuery: string | null;
  dictionary: SearchDictionaryDefinition | null;
};

function normalizedTerm(value: string): string {
  return value.trim().normalize("NFKC").toLocaleLowerCase("en-US");
}

function containsUnsupportedControls(value: string): boolean {
  if (forbiddenBidiPattern.test(value)) return true;
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f);
  });
}

function scopedGroup(
  group: SearchDictionaryDefinition["synonymGroups"][number],
  locale: "zh-Hans" | "en-US",
  regionCode?: string,
): boolean {
  return (
    (group.locale === "und" || group.locale === locale) &&
    (group.regionCodes.length === 0 ||
      (regionCode !== undefined && group.regionCodes.includes(regionCode)))
  );
}

function blockedByDictionary(
  query: string,
  locale: "zh-Hans" | "en-US",
  dictionary: SearchDictionaryDefinition | null,
): boolean {
  if (!dictionary) return false;
  const normalizedQuery = normalizedTerm(query);
  return dictionary.blockedTerms.some(
    (entry) =>
      (entry.locale === "und" || entry.locale === locale) &&
      normalizedQuery.includes(normalizedTerm(entry.term)),
  );
}

export function privacySafeSearchQuery(
  query: string,
  locale: "zh-Hans" | "en-US",
  dictionary: SearchDictionaryDefinition | null,
): string | null {
  const normalized = query.trim().normalize("NFKC");
  if (
    normalized.length < 2 ||
    normalized.length > 120 ||
    containsUnsupportedControls(normalized) ||
    emailPattern.test(normalized) ||
    urlPattern.test(normalized) ||
    phonePattern.test(normalized) ||
    longNumberPattern.test(normalized) ||
    addressPattern.test(normalized) ||
    chineseAddressPattern.test(normalized) ||
    contactHandlePattern.test(normalized) ||
    blockedByDictionary(normalized, locale, dictionary)
  ) {
    return null;
  }
  return normalized;
}

function windowMilliseconds(window: ValidatedSearchTrendingQuery["window"]): number {
  if (window === "DAY_1") return 24 * 60 * 60 * 1_000;
  if (window === "DAY_30") return 30 * 24 * 60 * 60 * 1_000;
  return 7 * 24 * 60 * 60 * 1_000;
}

@Injectable()
export class SearchDiscoveryService {
  readonly #sourceKey: Buffer;

  constructor(
    @Inject(API_ENVIRONMENT) environment: ApiEnvironment,
    @Inject(SEARCH_DISCOVERY_STORE) private readonly store: SearchDiscoveryStore,
    @Optional() @Inject(API_METRICS) private readonly metrics?: MetricsRegistry,
  ) {
    this.#sourceKey = createHmac("sha256", environment.SESSION_SECRET.reveal())
      .update("socal-life:search-source:v1")
      .digest();
  }

  async resolveSearchQuery(input: {
    query?: string;
    locale: "zh-Hans" | "en-US";
    regionCode?: string;
    dictionaryVersion?: number;
  }): Promise<ResolvedSearchQuery> {
    if (!input.query) {
      return {
        dictionaryVersion: input.dictionaryVersion ?? 0,
        queryTerms: [],
        correctedQuery: null,
        dictionary: null,
      };
    }

    let dictionary: PublishedSearchDictionary | null;
    try {
      dictionary =
        input.dictionaryVersion === 0
          ? null
          : await this.store.getPublishedDictionary(input.dictionaryVersion);
    } catch (error: unknown) {
      this.metrics?.searchDiscovery({ operation: "dictionary", outcome: "unavailable" });
      if (input.dictionaryVersion !== undefined && input.dictionaryVersion > 0) throw error;
      dictionary = null;
    }
    if (input.dictionaryVersion !== undefined && input.dictionaryVersion > 0 && !dictionary) {
      this.metrics?.searchDiscovery({ operation: "dictionary", outcome: "unavailable" });
      throw new SearchDiscoveryUnavailableError();
    }

    const sourceQuery = input.query.trim().normalize("NFKC");
    const matchingGroup = dictionary?.definition.synonymGroups.find(
      (group) =>
        scopedGroup(group, input.locale, input.regionCode) &&
        [group.canonical, ...group.alternatives].some(
          (term) => normalizedTerm(term) === normalizedTerm(sourceQuery),
        ),
    );
    const queryTerms = matchingGroup
      ? [...new Set([sourceQuery, matchingGroup.canonical, ...matchingGroup.alternatives])].slice(
          0,
          maximumExpandedTerms,
        )
      : [sourceQuery];
    const correctedQuery =
      matchingGroup && normalizedTerm(sourceQuery) !== normalizedTerm(matchingGroup.canonical)
        ? matchingGroup.canonical
        : null;
    this.metrics?.searchDiscovery({ operation: "dictionary", outcome: "success" });
    return {
      dictionaryVersion: dictionary?.version ?? 0,
      queryTerms,
      correctedQuery,
      dictionary: dictionary?.definition ?? null,
    };
  }

  async captureSuccessfulQuery(input: {
    query?: string;
    regionCode?: string;
    resultCount: number;
    cursor?: string;
    context?: SearchRequestContext;
    dictionary: SearchDictionaryDefinition | null;
    now: Date;
  }): Promise<void> {
    if (!input.query || input.resultCount < 1 || input.cursor) return;
    const context = input.context;
    if (!context?.userAgent || botPattern.test(context.userAgent)) {
      this.metrics?.searchDiscovery({ operation: "sample", outcome: "rejected_bot" });
      return;
    }
    const query = privacySafeSearchQuery(input.query, context.locale, input.dictionary);
    if (!query) {
      this.metrics?.searchDiscovery({ operation: "sample", outcome: "rejected_sensitive" });
      return;
    }

    const queryHash = createHash("sha256")
      .update(`${context.locale}\0${normalizedTerm(query)}`)
      .digest("hex");
    const sourceHash = createHmac("sha256", this.#sourceKey).update(context.ip).digest("hex");
    try {
      const outcome = await this.store.recordQuerySample({
        queryHash,
        sourceHash,
        queryText: query,
        locale: context.locale,
        ...(input.regionCode ? { regionCode: input.regionCode } : {}),
        createdAt: input.now,
        expiresAt: new Date(input.now.getTime() + sampleRetentionMilliseconds),
      });
      this.metrics?.searchDiscovery({ operation: "sample", outcome });
      try {
        await this.store.pruneExpiredSamples({ now: input.now, limit: 100 });
        this.metrics?.searchDiscovery({ operation: "retention", outcome: "success" });
      } catch {
        this.metrics?.searchDiscovery({ operation: "retention", outcome: "unavailable" });
      }
    } catch {
      this.metrics?.searchDiscovery({ operation: "sample", outcome: "unavailable" });
    }
  }

  async suggestions(
    query: ValidatedSearchSuggestionsQuery,
    now = new Date(),
  ): Promise<SearchSuggestionResponse> {
    const dictionaryRecord = await this.store.getPublishedDictionary();
    const dictionary = dictionaryRecord?.definition ?? null;
    if (query.q && !privacySafeSearchQuery(query.q, query.locale, dictionary)) {
      this.metrics?.searchDiscovery({ operation: "suggestions", outcome: "empty" });
      return { data: [], generatedAt: now.toISOString() };
    }
    const [taxonomy, recentQueries] = await Promise.all([
      this.store.listTaxonomySuggestions({
        ...(query.q ? { q: query.q } : {}),
        locale: query.locale,
        ...(query.regionCode ? { regionCode: query.regionCode } : {}),
        limit: Math.min(20, query.limit * 2),
      }),
      query.q
        ? this.store.findPrivacySafeQueries({
            locale: query.locale,
            ...(query.regionCode ? { regionCode: query.regionCode } : {}),
            prefix: query.q,
            since: new Date(now.getTime() - recentSuggestionMilliseconds),
            now,
            minimumSources: minimumPublicSources,
            limit: query.limit,
          })
        : Promise.resolve([]),
    ]);
    const dictionarySuggestions: SearchSuggestion[] = query.q
      ? (dictionary?.synonymGroups ?? [])
          .filter(
            (group) =>
              scopedGroup(group, query.locale, query.regionCode) &&
              [group.canonical, ...group.alternatives].some((term) =>
                normalizedTerm(term).startsWith(normalizedTerm(query.q ?? "")),
              ),
          )
          .map((group) => ({
            type: "QUERY",
            label: group.canonical,
            value: group.canonical,
            locale: query.locale,
          }))
      : [];
    const recentSuggestions: SearchSuggestion[] = recentQueries.flatMap((entry) => {
      const safe = privacySafeSearchQuery(entry.queryText, query.locale, dictionary);
      return safe
        ? [{ type: "QUERY" as const, label: safe, value: safe, locale: query.locale }]
        : [];
    });
    const deduplicated = new Map<string, SearchSuggestion>();
    for (const suggestion of [...dictionarySuggestions, ...taxonomy, ...recentSuggestions]) {
      const key = `${suggestion.type}:${normalizedTerm(suggestion.value)}`;
      if (!deduplicated.has(key)) deduplicated.set(key, suggestion);
    }
    const data = [...deduplicated.values()].slice(0, query.limit);
    this.metrics?.searchDiscovery({
      operation: "suggestions",
      outcome: data.length > 0 ? "success" : "empty",
    });
    return { data, generatedAt: now.toISOString() };
  }

  async trending(
    query: ValidatedSearchTrendingQuery,
    now = new Date(),
  ): Promise<SearchTrendingResponse> {
    const dictionaryRecord = await this.store.getPublishedDictionary();
    const dictionary = dictionaryRecord?.definition ?? null;
    const entries = await this.store.findPrivacySafeQueries({
      locale: query.locale,
      ...(query.regionCode ? { regionCode: query.regionCode } : {}),
      since: new Date(now.getTime() - windowMilliseconds(query.window)),
      now,
      minimumSources: minimumPublicSources,
      limit: query.limit * 2,
    });
    const data = entries
      .flatMap((entry) => {
        const safe = privacySafeSearchQuery(entry.queryText, query.locale, dictionary);
        return safe ? [safe] : [];
      })
      .slice(0, query.limit)
      .map((safeQuery, index) => ({
        query: safeQuery,
        rank: index + 1,
        locale: query.locale,
      }));
    this.metrics?.searchDiscovery({
      operation: "trending",
      outcome: data.length > 0 ? "success" : "empty",
    });
    return {
      data,
      window: query.window,
      generatedAt: now.toISOString(),
    };
  }
}
