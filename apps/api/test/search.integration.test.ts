import { randomUUID } from "node:crypto";
import { Client } from "@opensearch-project/opensearch";
import { parseApiEnvironment } from "@socal/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { OpenSearchSearchStore } from "../src/modules/search/opensearch-search.store";

const node = process.env.OPENSEARCH_INTEGRATION_URL ?? "";
const integration = describe.skipIf(node.length === 0);

integration("public search with OpenSearch", () => {
  const prefix = `socal_api_it_${randomUUID().replaceAll("-", "").slice(0, 10)}`;
  const physicalIndex = `${prefix}_listings_v1`;
  const readAlias = `${prefix}_listings_read`;
  const writeAlias = `${prefix}_listings_write`;
  let client: Client;
  let store: OpenSearchSearchStore;

  beforeAll(async () => {
    client = new Client({ node, requestTimeout: 10_000, maxRetries: 2 });
    await client.indices.create({
      index: physicalIndex,
      body: {
        settings: {
          number_of_shards: 1,
          number_of_replicas: 0,
          analysis: {
            normalizer: {
              socal_test_lowercase: { type: "custom", filter: ["lowercase"] },
            },
          },
        },
        mappings: {
          dynamic: "strict",
          properties: {
            schemaVersion: { type: "integer" },
            id: { type: "keyword" },
            type: { type: "keyword" },
            status: { type: "keyword" },
            locale: { type: "keyword" },
            slug: { type: "keyword" },
            title: { type: "text" },
            summary: { type: "text" },
            body: { type: "text" },
            category: {
              properties: {
                id: { type: "keyword" },
                slug: { type: "keyword" },
                path: { type: "keyword" },
                nameZhHans: { type: "text" },
                nameEn: { type: "text" },
                aliases: { type: "text" },
              },
            },
            region: {
              properties: {
                id: { type: "keyword" },
                code: { type: "keyword", normalizer: "socal_test_lowercase" },
                slug: { type: "keyword" },
                path: { type: "keyword" },
                nameZhHans: { type: "text" },
                nameEn: { type: "text" },
                aliases: { type: "text" },
              },
            },
            price: {
              properties: {
                amountMinor: { type: "long" },
                currency: { type: "keyword" },
                unit: { type: "keyword" },
              },
            },
            location: {
              properties: {
                precision: { type: "keyword" },
                point: { type: "geo_point" },
              },
            },
            attributes: {
              type: "nested",
              properties: {
                key: { type: "keyword" },
                keywordValue: { type: "keyword" },
                textValue: { type: "text" },
                numberValue: { type: "double" },
                booleanValue: { type: "boolean" },
              },
            },
            publisher: {
              properties: {
                ownerId: { type: "keyword" },
                displayName: { type: "text" },
                avatarUrl: { type: "keyword", index: false, doc_values: false },
                organizationId: { type: "keyword" },
                organizationSlug: { type: "keyword" },
                organizationVerification: { type: "keyword" },
              },
            },
            qualityScore: { type: "double" },
            isSponsored: { type: "boolean" },
            promotion: {
              properties: {
                campaignId: { type: "keyword" },
                placementId: { type: "keyword" },
              },
            },
            publishedAt: { type: "date" },
            expiresAt: { type: "date" },
            updatedAt: { type: "date" },
            contentVersion: { type: "long" },
            indexedAt: { type: "date" },
          },
        },
        aliases: {
          [readAlias]: {},
          [writeAlias]: { is_write_index: true },
        },
      },
    });
    const environment = parseApiEnvironment({
      NODE_ENV: "test",
      APP_ENV: "test",
      PUBLIC_WEB_URL: "http://web.example.invalid",
      PUBLIC_ADMIN_URL: "http://admin.example.invalid",
      DATABASE_URL: "postgresql://example.invalid/socal",
      REDIS_URL: "redis://localhost:6379/0",
      OPENSEARCH_NODE: node,
      OPENSEARCH_INDEX_PREFIX: prefix,
      SESSION_SECRET: "search-integration-session-secret-more-than-32-bytes",
      OTP_SECRET: "search-integration-otp-secret-more-than-32-bytes",
      MFA_SECRET: "search-integration-mfa-secret-more-than-32-bytes",
      PASSWORD_PEPPER: "search-integration-password-pepper-more-than-32-bytes",
      CSRF_SECRET: "search-integration-csrf-secret-more-than-32-bytes",
    });
    store = new OpenSearchSearchStore(environment);
    await Promise.all([1, 2, 3].map((sequence) => indexDocument(sequence)));
    await client.indices.refresh({ index: physicalIndex });
  });

  afterAll(async () => {
    if (store) await store.onModuleDestroy();
    if (client) {
      const exists = await client.indices.exists({ index: physicalIndex });
      if (exists.body) await client.indices.delete({ index: physicalIndex });
      await client.close();
    }
  });

  async function indexDocument(sequence: number): Promise<void> {
    const id = `91000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`;
    await client.index({
      index: writeAlias,
      id,
      body: {
        schemaVersion: 1,
        id,
        type: "RENTAL",
        status: "PUBLISHED",
        locale: "en-US",
        slug: `synthetic-irvine-rental-${sequence}`,
        title: `Irvine apartment ${sequence}`,
        summary: "A fictional integration-test rental.",
        body: "Searchable apartment description.",
        category: {
          id: "93000000-0000-4000-8000-000000000001",
          slug: "rentals",
          path: ["housing", "rentals"],
          nameZhHans: "测试租房",
          nameEn: "Rentals",
          aliases: ["apartment"],
        },
        region: {
          id: "92000000-0000-4000-8000-000000000001",
          code: "US-CA-ORANGE-IRVINE",
          slug: "irvine",
          path: ["southern-california", "irvine"],
          nameZhHans: "测试尔湾",
          nameEn: "Irvine",
          aliases: ["尔湾"],
        },
        price: {
          amountMinor: 200_000 + sequence * 10_000,
          currency: "USD",
          unit: "MONTHLY",
        },
        location: {
          precision: "APPROXIMATE",
          point: { lat: 33.6846 + sequence * 0.005, lon: -117.8265 },
        },
        attributes: [{ key: "bedrooms", numberValue: sequence }],
        publisher: {
          ownerId: `94000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`,
          displayName: `Synthetic Publisher ${sequence}`,
          avatarUrl: null,
          organizationId: null,
          organizationSlug: null,
        },
        qualityScore: 0.8,
        isSponsored: false,
        promotion: null,
        publishedAt: `2026-07-2${sequence}T12:00:00.000Z`,
        expiresAt: "2026-09-30T12:00:00.000Z",
        updatedAt: `2026-07-2${sequence}T12:00:00.000Z`,
        contentVersion: 1,
        indexedAt: "2026-07-29T12:00:00.000Z",
      },
    });
  }

  it("matches a reviewed synonym expansion while keeping OpenSearch derived", async () => {
    const snapshotId = await store.openSnapshot(120);
    const result = await store.search({
      snapshotId,
      snapshotAt: "2026-07-29T12:00:00.000Z",
      criteria: {
        q: "apt",
        type: "RENTAL",
        regionCode: "US-CA-ORANGE-IRVINE",
        sort: "RELEVANCE",
        limit: 10,
      },
      queryTerms: ["apt", "apartment"],
      keepAliveSeconds: 120,
      timeoutMilliseconds: 3_000,
    });

    expect(result.hits).toHaveLength(3);
    expect(result.hits.every((hit) => hit.result.title.includes("apartment"))).toBe(true);
    await store.closeSnapshot(snapshotId);
  });

  it("executes geo filters, fixed facets, and PIT search_after without admitting later writes", async () => {
    const snapshotId = await store.openSnapshot(120);
    const request = {
      snapshotId,
      snapshotAt: "2026-07-29T12:00:00.000Z",
      criteria: {
        q: "Irvine apartment",
        type: "RENTAL" as const,
        regionCode: "US-CA-ORANGE-IRVINE",
        latitude: 33.6846,
        longitude: -117.8265,
        radiusMiles: 25,
        sort: "DISTANCE" as const,
        limit: 1,
      },
      keepAliveSeconds: 120,
      timeoutMilliseconds: 3_000,
    };
    const first = await store.search(request);
    expect(first.hits).toHaveLength(2);
    expect(first.hits[0]?.result).toMatchObject({
      status: "PUBLISHED",
      type: "RENTAL",
    });
    expect(typeof first.hits[0]?.result.distanceMiles).toBe("number");
    expect(first.facets.types).toEqual([{ value: "RENTAL", count: 3 }]);

    await indexDocument(4);
    await client.indices.refresh({ index: physicalIndex });
    const second = await store.search({
      ...request,
      searchAfter: first.hits[0]?.sort,
    });
    const ids = [...first.hits.slice(0, 1), ...second.hits].map((hit) => hit.result.id);
    expect(new Set(ids).size).toBe(3);
    expect(ids).not.toContain("91000000-0000-4000-8000-000000000004");
    expect(second.facets.types).toEqual([{ value: "RENTAL", count: 3 }]);
    await store.closeSnapshot(snapshotId);
  });
});
