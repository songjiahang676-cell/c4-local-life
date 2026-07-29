import { parseApiEnvironment } from "@socal/config";
import type { SearchDictionaryDefinition } from "@socal/contracts";
import { MetricsRegistry } from "@socal/observability";
import { describe, expect, it } from "vitest";
import { SearchDictionaryService } from "../src/modules/search/search-dictionary.service";
import { SearchDiscoveryService } from "../src/modules/search/search-discovery.service";
import { SearchDiscoveryUnavailableError } from "../src/modules/search/search-discovery.store";
import { MemorySearchDiscoveryStore } from "./support/memory-search-discovery.store";

const environment = parseApiEnvironment({
  NODE_ENV: "test",
  APP_ENV: "test",
  PUBLIC_WEB_URL: "http://web.example.invalid",
  PUBLIC_ADMIN_URL: "http://admin.example.invalid",
  DATABASE_URL: "postgresql://example.invalid/socal",
  REDIS_URL: "redis://localhost:6379/0",
  OPENSEARCH_NODE: "http://localhost:9200",
  SESSION_SECRET: "search-discovery-session-secret-more-than-32-bytes",
  OTP_SECRET: "search-discovery-otp-secret-more-than-32-bytes",
  MFA_SECRET: "search-discovery-mfa-secret-more-than-32-bytes",
  PASSWORD_PEPPER: "search-discovery-password-pepper-more-than-32-bytes",
  CSRF_SECRET: "search-discovery-csrf-secret-more-than-32-bytes",
});

const definition: SearchDictionaryDefinition = {
  schemaVersion: 1,
  synonymGroups: [
    {
      key: "apartment-rental",
      locale: "en-US",
      canonical: "apartment",
      alternatives: ["apt", "rental unit"],
      regionCodes: ["US-CA-ORANGE-IRVINE"],
    },
  ],
  blockedTerms: [{ term: "forbidden phrase", locale: "en-US", reason: "SCAM" }],
};

function publishDictionary(
  store: MemorySearchDiscoveryStore,
  version: number,
  dictionary = definition,
): void {
  store.currentVersion = version;
  store.dictionaries.set(version, {
    version,
    revision: 1,
    definition: dictionary,
    contentHash: String(version).padStart(64, "0"),
    basedOnVersion: null,
    createdById: "75000000-0000-4000-8000-000000000001",
    updatedById: "75000000-0000-4000-8000-000000000001",
    publishedById: "75000000-0000-4000-8000-000000000002",
    createdAt: new Date("2026-07-29T10:00:00.000Z"),
    updatedAt: new Date("2026-07-29T11:00:00.000Z"),
    publishedAt: new Date("2026-07-29T11:00:00.000Z"),
  });
}

describe("SearchDiscoveryService", () => {
  it("expands exact reviewed synonyms within locale and region and pins dictionary versions", async () => {
    const store = new MemorySearchDiscoveryStore();
    publishDictionary(store, 3);
    const service = new SearchDiscoveryService(environment, store);

    await expect(
      service.resolveSearchQuery({
        query: "apt",
        locale: "en-US",
        regionCode: "US-CA-ORANGE-IRVINE",
      }),
    ).resolves.toMatchObject({
      dictionaryVersion: 3,
      queryTerms: ["apt", "apartment", "rental unit"],
      correctedQuery: "apartment",
    });
    await expect(
      service.resolveSearchQuery({
        query: "apt",
        locale: "en-US",
        regionCode: "US-CA-LA",
      }),
    ).resolves.toMatchObject({
      dictionaryVersion: 3,
      queryTerms: ["apt"],
      correctedQuery: null,
    });
    await expect(
      service.resolveSearchQuery({
        query: "apt",
        locale: "en-US",
        dictionaryVersion: 99,
      }),
    ).rejects.toBeInstanceOf(SearchDiscoveryUnavailableError);
  });

  it("records only result-bearing, non-bot, non-PII first-page queries with HMAC sources", async () => {
    const store = new MemorySearchDiscoveryStore();
    publishDictionary(store, 1);
    const metrics = new MetricsRegistry();
    const service = new SearchDiscoveryService(environment, store, metrics);
    const now = new Date("2026-07-29T12:00:00.000Z");
    const base = {
      resultCount: 2,
      dictionary: definition,
      now,
      context: {
        ip: "203.0.113.9",
        userAgent: "Synthetic Browser/1.0",
        locale: "en-US" as const,
      },
    };

    await service.captureSuccessfulQuery({ ...base, query: "Irvine apartment" });
    await service.captureSuccessfulQuery({
      ...base,
      query: "Irvine apartment",
      context: { ...base.context, userAgent: "Synthetic Browser/2.0" },
    });
    await service.captureSuccessfulQuery({ ...base, query: "person@example.com" });
    await service.captureSuccessfulQuery({
      ...base,
      query: "Irvine jobs",
      context: { ...base.context, userAgent: "Googlebot/1.0" },
    });
    await service.captureSuccessfulQuery({ ...base, query: "forbidden phrase deal" });
    await service.captureSuccessfulQuery({
      ...base,
      query: "cursor page",
      cursor: "opaque",
    });

    expect(store.samples).toHaveLength(1);
    expect(store.samples[0]).toMatchObject({
      queryText: "Irvine apartment",
      locale: "en-US",
      createdAt: now,
    });
    expect(store.samples[0]?.sourceHash).toMatch(/^[0-9a-f]{64}$/);
    expect(store.samples[0]?.sourceHash).not.toContain("203.0.113.9");
    const rendered = metrics.renderPrometheus();
    expect(rendered).toContain(
      'socal_search_discovery_events_total{operation="sample",outcome="recorded"} 1',
    );
    expect(rendered).toContain(
      'socal_search_discovery_events_total{operation="sample",outcome="duplicate"} 1',
    );
    expect(rendered).toContain(
      'socal_search_discovery_events_total{operation="sample",outcome="rejected_bot"} 1',
    );
    expect(rendered).toContain(
      'socal_search_discovery_events_total{operation="sample",outcome="rejected_sensitive"} 2',
    );
    expect(rendered).not.toContain("person@example.com");
    expect(rendered).not.toContain("Irvine apartment");
  });

  it("combines authoritative suggestions but filters sensitive recent queries and raw counts", async () => {
    const store = new MemorySearchDiscoveryStore();
    publishDictionary(store, 1);
    store.taxonomySuggestions.push({
      type: "CATEGORY",
      label: "Apartments",
      value: "apartments",
      locale: "en-US",
    });
    store.privacySafeQueries.push(
      {
        queryText: "apartment near Irvine",
        sourceCount: 5,
        lastSeenAt: new Date("2026-07-29T11:00:00.000Z"),
      },
      {
        queryText: "person@example.com",
        sourceCount: 100,
        lastSeenAt: new Date("2026-07-29T11:00:00.000Z"),
      },
    );
    const service = new SearchDiscoveryService(environment, store);
    const now = new Date("2026-07-29T12:00:00.000Z");

    const suggestions = await service.suggestions(
      {
        q: "ap",
        regionCode: "US-CA-ORANGE-IRVINE",
        locale: "en-US",
        limit: 10,
      },
      now,
    );
    expect(suggestions.data).toEqual([
      { type: "QUERY", label: "apartment", value: "apartment", locale: "en-US" },
      {
        type: "CATEGORY",
        label: "Apartments",
        value: "apartments",
        locale: "en-US",
      },
      {
        type: "QUERY",
        label: "apartment near Irvine",
        value: "apartment near Irvine",
        locale: "en-US",
      },
    ]);
    expect(JSON.stringify(suggestions)).not.toContain("sourceCount");
    expect(JSON.stringify(suggestions)).not.toContain("person@example.com");

    await expect(
      service.suggestions({ q: "person@example.com", locale: "en-US", limit: 10 }, now),
    ).resolves.toEqual({ data: [], generatedAt: now.toISOString() });
  });

  it("ranks only privacy-thresholded and re-screened trends without exposing counts", async () => {
    const store = new MemorySearchDiscoveryStore();
    publishDictionary(store, 1);
    store.privacySafeQueries.push(
      {
        queryText: "Irvine apartment",
        sourceCount: 7,
        lastSeenAt: new Date("2026-07-29T11:00:00.000Z"),
      },
      {
        queryText: "forbidden phrase deal",
        sourceCount: 8,
        lastSeenAt: new Date("2026-07-29T11:30:00.000Z"),
      },
      {
        queryText: "low frequency",
        sourceCount: 4,
        lastSeenAt: new Date("2026-07-29T11:30:00.000Z"),
      },
    );
    const service = new SearchDiscoveryService(environment, store);
    const response = await service.trending(
      { locale: "en-US", window: "DAY_7", limit: 10 },
      new Date("2026-07-29T12:00:00.000Z"),
    );

    expect(response).toMatchObject({
      data: [{ query: "Irvine apartment", rank: 1, locale: "en-US" }],
      window: "DAY_7",
    });
    expect(JSON.stringify(response)).not.toContain("sourceCount");
    expect(store.privacyInputs[0]).toMatchObject({
      minimumSources: 5,
      limit: 20,
    });
  });
});

describe("SearchDictionaryService", () => {
  it("validates drafts, hashes canonical definitions, and requires a separate reviewer", async () => {
    const store = new MemorySearchDiscoveryStore();
    const service = new SearchDictionaryService(store);
    const editorId = "75000000-0000-4000-8000-000000000001";
    const reviewerId = "75000000-0000-4000-8000-000000000002";

    const draft = await service.saveDraft({
      expectedCurrentVersion: 0,
      definition,
      actorId: editorId,
    });
    expect(draft).toMatchObject({ kind: "ok", dictionary: { version: 1 } });
    if (draft.kind !== "ok") throw new Error(draft.kind);
    expect(draft.dictionary.contentHash).toMatch(/^[0-9a-f]{64}$/);
    await expect(
      service.publishDraft({
        expectedCurrentVersion: 0,
        expectedDraftRevision: 1,
        reviewerId: editorId,
      }),
    ).resolves.toEqual({ kind: "review_required" });
    await expect(
      service.publishDraft({
        expectedCurrentVersion: 0,
        expectedDraftRevision: 1,
        reviewerId,
      }),
    ).resolves.toMatchObject({ kind: "ok", dictionary: { version: 1 } });

    await expect(
      service.rollback({
        expectedCurrentVersion: 1,
        targetVersion: 1,
        actorId: editorId,
      }),
    ).resolves.toMatchObject({
      kind: "ok",
      dictionary: { version: 2, basedOnVersion: 1, publishedAt: null },
    });
    await expect(
      service.publishDraft({
        expectedCurrentVersion: 1,
        expectedDraftRevision: 1,
        reviewerId: editorId,
      }),
    ).resolves.toEqual({ kind: "review_required" });
    await expect(
      service.publishDraft({
        expectedCurrentVersion: 1,
        expectedDraftRevision: 1,
        reviewerId,
      }),
    ).resolves.toMatchObject({
      kind: "ok",
      dictionary: { version: 2, basedOnVersion: 1, publishedById: reviewerId },
    });

    expect(() =>
      service.saveDraft({
        expectedCurrentVersion: 2,
        definition: {
          ...definition,
          synonymGroups: [
            ...definition.synonymGroups,
            { ...definition.synonymGroups[0], key: "ambiguous", canonical: "apt" },
          ],
        },
        actorId: editorId,
      }),
    ).toThrow();
  });
});
