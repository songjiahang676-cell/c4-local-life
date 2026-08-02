import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { Client } from "@opensearch-project/opensearch";
import { parseApiEnvironment } from "@socal/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  buildListingIndexDefinition,
  listingIndexNames,
  type ListingSearchDocument,
} from "../../worker/src/search/listing-index-definition";
import { OpenSearchSearchStore } from "../src/modules/search/opensearch-search.store";
import {
  evaluateSearchRelevance,
  parseSearchRelevanceDataset,
  type SearchRelevanceDocument,
  type SearchRelevanceRun,
} from "../src/modules/search/search-relevance";

const node = process.env.OPENSEARCH_INTEGRATION_URL ?? "";
const integration = describe.skipIf(node.length === 0);
const dataset = parseSearchRelevanceDataset(
  JSON.parse(
    readFileSync(new URL("../../../datasets/search-relevance/v1.json", import.meta.url), "utf8"),
  ) as unknown,
);

function indexDocument(document: SearchRelevanceDocument): ListingSearchDocument {
  const sequence = document.id.slice(-12);
  return {
    schemaVersion: 1,
    id: document.id,
    type: document.type,
    status: "PUBLISHED",
    locale: document.locale,
    slug: document.slug,
    title: document.title,
    summary: document.summary,
    body: document.body,
    category: {
      ...document.category,
      path: [document.category.slug],
    },
    region: {
      ...document.region,
      path: [document.region.slug],
    },
    price: { amountMinor: 100_000, currency: "USD", unit: "FIXED" },
    location: { precision: "CITY" },
    attributes: [],
    publisher: {
      ownerId: `96300000-0000-4000-8000-${sequence}`,
      displayName: "Synthetic Relevance Publisher",
      avatarUrl: null,
      organizationId: null,
      organizationSlug: null,
    },
    qualityScore: document.qualityScore,
    isSponsored: false,
    promotion: null,
    publishedAt: document.publishedAt,
    expiresAt: "2027-08-01T12:00:00.000Z",
    updatedAt: document.publishedAt,
    contentVersion: 1,
    indexedAt: "2026-08-01T11:00:00.000Z",
  };
}

integration("bilingual search relevance evaluation with OpenSearch", () => {
  const prefix = `socal_api_rel_${randomUUID().replaceAll("-", "").slice(0, 10)}`;
  const names = listingIndexNames(prefix);
  let client: Client;
  let store: OpenSearchSearchStore;

  beforeAll(async () => {
    client = new Client({ node, requestTimeout: 10_000, maxRetries: 2 });
    const definition = buildListingIndexDefinition(names, { includeAliases: true });
    await client.indices.create({ index: names.physical, body: definition });
    await Promise.all(
      dataset.documents.map((document) =>
        client.index({
          index: names.writeAlias,
          id: document.id,
          body: indexDocument(document),
        }),
      ),
    );
    await client.indices.refresh({ index: names.physical });
    store = new OpenSearchSearchStore(
      parseApiEnvironment({
        NODE_ENV: "test",
        APP_ENV: "test",
        PUBLIC_WEB_URL: "http://web.example.invalid",
        PUBLIC_ADMIN_URL: "http://admin.example.invalid",
        DATABASE_URL: "postgresql://example.invalid/socal",
        REDIS_URL: "redis://localhost:6379/0",
        OPENSEARCH_NODE: node,
        OPENSEARCH_INDEX_PREFIX: prefix,
        SESSION_SECRET: "relevance-integration-session-secret-more-than-32-bytes",
        OTP_SECRET: "relevance-integration-otp-secret-more-than-32-bytes",
        MFA_SECRET: "relevance-integration-mfa-secret-more-than-32-bytes",
        PASSWORD_PEPPER: "relevance-integration-password-pepper-more-than-32-bytes",
        CSRF_SECRET: "relevance-integration-csrf-secret-more-than-32-bytes",
      }),
    );
  }, 30_000);

  afterAll(async () => {
    if (store) await store.onModuleDestroy();
    if (client) {
      const exists = await client.indices.exists({ index: names.physical });
      if (exists.body) await client.indices.delete({ index: names.physical });
      await client.close();
    }
  }, 30_000);

  it("meets the reviewed thresholds for both locales without exporting fixture scores as metrics", async () => {
    const runs: SearchRelevanceRun[] = [];
    for (const query of dataset.queries) {
      const snapshotId = await store.openSnapshot(120);
      try {
        const result = await store.search({
          snapshotId,
          snapshotAt: "2026-08-01T12:00:00.000Z",
          criteria: { q: query.query, sort: "RELEVANCE", limit: 10 },
          queryTerms: [query.query],
          keepAliveSeconds: 120,
          timeoutMilliseconds: 3_000,
        });
        runs.push({
          queryId: query.id,
          documentIds: result.hits.slice(0, 10).map((hit) => hit.result.id),
        });
      } finally {
        await store.closeSnapshot(snapshotId);
      }
    }

    const report = evaluateSearchRelevance(dataset, runs);
    expect(report, JSON.stringify(report, null, 2)).toMatchObject({
      classification: "SYNTHETIC",
      passed: true,
      overall: {
        queryCount: 16,
        zeroResultRate: 0,
      },
      byLocale: {
        "zh-Hans": { queryCount: 8 },
        "en-US": { queryCount: 8 },
      },
    });
  }, 30_000);
});
