import { randomUUID } from "node:crypto";
import { Client } from "@opensearch-project/opensearch";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  listingIndexNames,
  listingIndexSchemaVersion,
  type ListingSearchDocument,
} from "../src/search/listing-index-definition";
import { ListingIndexManager } from "../src/search/listing-index-manager";
import { OpenSearchListingIndex } from "../src/search/listing-index";

const node = process.env.OPENSEARCH_INTEGRATION_URL ?? "";
const integration = describe.skipIf(node.length === 0);

type AnalyzeResponse = Readonly<{
  tokens?: readonly Readonly<{ token: string }>[];
}>;

type SearchResponse = Readonly<{
  hits: Readonly<{
    hits: readonly Readonly<{ _id?: string }>[];
  }>;
}>;

integration("Listing index with OpenSearch", () => {
  const prefix = `socal_it_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  const names = listingIndexNames(prefix);
  let client: Client;

  beforeAll(() => {
    client = new Client({ node, requestTimeout: 10_000, maxRetries: 2 });
  });

  afterAll(async () => {
    if (client) {
      const exists = await client.indices.exists({ index: names.physical });
      if (exists.body) await client.indices.delete({ index: names.physical });
      await client.close();
    }
  });

  it("creates analyzers and aliases, indexes through the write alias, and rejects PII drift", async () => {
    const manager = new ListingIndexManager(client, prefix);
    await expect(manager.ensure()).resolves.toMatchObject({
      outcome: "created",
      schemaVersion: listingIndexSchemaVersion,
    });
    await expect(manager.ensure()).resolves.toMatchObject({ outcome: "existing" });

    const zhAnalysis = await client.indices.analyze<AnalyzeResponse>({
      index: names.physical,
      body: { analyzer: "socal_zh_index", text: "南加州租房" },
    });
    expect(zhAnalysis.body.tokens?.map((token) => token.token)).toEqual(
      expect.arrayContaining(["南加", "加州", "租房"]),
    );

    const enAnalysis = await client.indices.analyze<AnalyzeResponse>({
      index: names.physical,
      body: { analyzer: "socal_en_index", text: "Renting apartments" },
    });
    expect(enAnalysis.body.tokens?.map((token) => token.token)).toEqual(
      expect.arrayContaining(["rent", "apart"]),
    );

    const now = new Date().toISOString();
    const document: ListingSearchDocument = {
      schemaVersion: listingIndexSchemaVersion,
      id: randomUUID(),
      type: "RENTAL",
      status: "PUBLISHED",
      locale: "zh-Hans",
      slug: "arcadia-apartment",
      title: "南加州亚凯迪亚公寓出租",
      summary: "靠近学校和公共交通",
      body: "两室一卫，可预约看房。",
      category: {
        id: randomUUID(),
        slug: "housing-rentals",
        path: ["housing", "housing-rentals"],
        nameZhHans: "房屋出租",
        nameEn: "Housing rentals",
        aliases: ["租房", "apartment"],
      },
      region: {
        id: randomUUID(),
        code: "US-CA-LA-ARCADIA",
        slug: "arcadia",
        path: ["southern-california", "los-angeles-county", "arcadia"],
        nameZhHans: "亚凯迪亚",
        nameEn: "Arcadia",
        aliases: ["阿卡迪亚"],
      },
      price: { amountMinor: 280_000, currency: "USD", unit: "MONTHLY" },
      location: { precision: "APPROXIMATE", point: { lat: 34.1397, lon: -118.0353 } },
      attributes: [{ key: "bedrooms", numberValue: 2 }],
      publisher: { ownerId: randomUUID(), displayName: "公开发布者" },
      qualityScore: 0.92,
      isSponsored: false,
      publishedAt: now,
      expiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
      updatedAt: now,
      contentVersion: 1,
      indexedAt: now,
    };

    await client.index({
      index: names.writeAlias,
      id: document.id,
      refresh: true,
      body: document,
    });
    const search = await client.search<SearchResponse>({
      index: names.readAlias,
      body: {
        query: {
          bool: {
            must: [{ match: { "title.zh": "南加州租房" } }],
            filter: [
              {
                geo_distance: {
                  distance: "20km",
                  "location.point": { lat: 34.1397, lon: -118.0353 },
                },
              },
            ],
          },
        },
      },
    });
    expect(search.body.hits.hits).toEqual(
      expect.arrayContaining([expect.objectContaining({ _id: document.id })]),
    );

    await expect(
      client.index({
        index: names.writeAlias,
        id: randomUUID(),
        refresh: true,
        body: { ...document, id: randomUUID(), phone: "+1-555-0100" },
      }),
    ).rejects.toMatchObject({ meta: { statusCode: 400 } });

    const versionedIndex = new OpenSearchListingIndex(client, names.readAlias, names.writeAlias);
    await expect(
      versionedIndex.upsert({ ...document, title: "Version two", contentVersion: 2 }, 2),
    ).resolves.toBe("applied");
    await expect(versionedIndex.version(document.id)).resolves.toBe(2);
    await expect(
      versionedIndex.upsert({ ...document, title: "Stale version", contentVersion: 1 }, 1),
    ).resolves.toBe("stale");
    await expect(versionedIndex.remove(document.id, 1)).resolves.toBe("stale");
    const current = await client.get<{ _source: ListingSearchDocument }>({
      index: names.readAlias,
      id: document.id,
    });
    expect(current.body._source.title).toBe("Version two");
    await expect(versionedIndex.remove(document.id, 3)).resolves.toBe("applied");
    await expect(versionedIndex.version(document.id)).resolves.toBeNull();
  });
});
