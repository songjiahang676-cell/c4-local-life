import { Inject, Injectable, Optional } from "@nestjs/common";
import type { ApiEnvironment } from "@socal/config";
import type { ListingSearchInput, SearchResponse } from "@socal/contracts";
import type { MetricsRegistry } from "@socal/observability";
import { API_ENVIRONMENT } from "../../common/api-environment.token";
import { API_METRICS } from "../../common/api-metrics.token";
import {
  SearchCursorCodec,
  SearchCursorExpiredError,
  SearchCursorInvalidError,
  searchCriteria,
  searchCriteriaFingerprint,
} from "./search-cursor";
import {
  SearchDiscoveryService,
  type ResolvedSearchQuery,
  type SearchRequestContext,
} from "./search-discovery.service";
import {
  SEARCH_STORE,
  SearchSnapshotExpiredError,
  type SearchStore,
  SearchTimeoutError,
  SearchUnavailableError,
} from "./search.store";

@Injectable()
export class SearchService {
  readonly #cursorCodec: SearchCursorCodec;

  constructor(
    @Inject(API_ENVIRONMENT) private readonly environment: ApiEnvironment,
    @Inject(SEARCH_STORE) private readonly store: SearchStore,
    @Optional() @Inject(API_METRICS) private readonly metrics?: MetricsRegistry,
    @Optional() private readonly discovery?: SearchDiscoveryService,
  ) {
    this.#cursorCodec = new SearchCursorCodec(environment.SESSION_SECRET.reveal());
  }

  async search(
    query: ListingSearchInput,
    now = new Date(),
    context?: SearchRequestContext,
  ): Promise<SearchResponse> {
    const criteria = searchCriteria(query);
    const fingerprint = searchCriteriaFingerprint(criteria);
    const sort = criteria.sort ?? "RELEVANCE";
    const geo = criteria.latitude !== undefined && criteria.longitude !== undefined;
    const locale = context?.locale ?? "zh-Hans";
    let snapshotId: string | undefined;
    try {
      let snapshotAt: string;
      let searchAfter: readonly (string | number | null)[] | undefined;
      let resolved: ResolvedSearchQuery;
      if (query.cursor) {
        const cursor = this.#cursorCodec.decode(query.cursor, fingerprint, now);
        snapshotId = cursor.snapshotId;
        snapshotAt = cursor.snapshotAt;
        searchAfter = cursor.searchAfter;
        resolved = await this.#resolveQuery(
          criteria.q,
          context,
          criteria.regionCode,
          cursor.dictionaryVersion,
        );
      } else {
        resolved = await this.#resolveQuery(criteria.q, context, criteria.regionCode);
        snapshotAt = now.toISOString();
        snapshotId = await this.store.openSnapshot(this.environment.SEARCH_PIT_KEEP_ALIVE_SECONDS);
      }

      const result = await this.store.search({
        snapshotId,
        snapshotAt,
        criteria,
        queryTerms: resolved.queryTerms,
        ...(searchAfter ? { searchAfter } : {}),
        keepAliveSeconds: this.environment.SEARCH_PIT_KEEP_ALIVE_SECONDS,
        timeoutMilliseconds: this.environment.SEARCH_QUERY_TIMEOUT_MS,
      });
      const limit = criteria.limit ?? 20;
      if (result.hits.length > limit + 1) throw new SearchUnavailableError();
      const hasMore = result.hits.length > limit;
      const visibleHits = result.hits.slice(0, limit);
      let nextCursor: string | null = null;
      if (hasMore) {
        const lastHit = visibleHits.at(-1);
        if (!lastHit) throw new SearchUnavailableError();
        nextCursor = this.#cursorCodec.encode({
          fingerprint,
          snapshotId,
          snapshotAt,
          searchAfter: lastHit.sort,
          dictionaryVersion: resolved.dictionaryVersion,
          expiresAt:
            Math.floor(now.getTime() / 1_000) + this.environment.SEARCH_PIT_KEEP_ALIVE_SECONDS,
        });
        if (nextCursor.length > 2_048) throw new SearchUnavailableError();
      } else {
        await this.#closeSnapshot(snapshotId);
        snapshotId = undefined;
      }
      this.metrics?.searchQuery({
        outcome: visibleHits.length === 0 ? "empty" : "success",
        sort,
        geo,
        locale,
      });
      await this.discovery?.captureSuccessfulQuery({
        query: criteria.q,
        regionCode: criteria.regionCode,
        resultCount: visibleHits.length,
        cursor: query.cursor,
        context,
        dictionary: resolved.dictionary,
        now,
      });
      return {
        data: visibleHits.map((hit) => hit.result),
        page: { nextCursor, hasMore },
        facets: result.facets,
        correctedQuery: resolved.correctedQuery,
        tookMs: result.tookMilliseconds,
        generatedAt: now.toISOString(),
      };
    } catch (error: unknown) {
      if (snapshotId) await this.#closeSnapshot(snapshotId);
      this.metrics?.searchQuery({
        outcome:
          error instanceof SearchCursorInvalidError
            ? "invalid_cursor"
            : error instanceof SearchCursorExpiredError ||
                error instanceof SearchSnapshotExpiredError
              ? "expired_cursor"
              : error instanceof SearchTimeoutError
                ? "timeout"
                : "unavailable",
        sort,
        geo,
        locale,
      });
      throw error;
    }
  }

  async #closeSnapshot(snapshotId: string): Promise<void> {
    try {
      await this.store.closeSnapshot(snapshotId);
    } catch {
      // PITs have a short bounded TTL; cleanup failure must not replace the search outcome.
    }
  }

  #resolveQuery(
    query: string | undefined,
    context: SearchRequestContext | undefined,
    regionCode?: string,
    dictionaryVersion?: number,
  ): Promise<ResolvedSearchQuery> {
    if (this.discovery) {
      return this.discovery.resolveSearchQuery({
        query,
        locale: context?.locale ?? "zh-Hans",
        ...(regionCode ? { regionCode } : {}),
        ...(dictionaryVersion === undefined ? {} : { dictionaryVersion }),
      });
    }
    return Promise.resolve({
      dictionaryVersion: 0,
      queryTerms: query ? [query] : [],
      correctedQuery: null,
      dictionary: null,
    });
  }
}
