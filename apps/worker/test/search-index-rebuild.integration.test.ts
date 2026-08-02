import { randomUUID } from "node:crypto";
import { Client, type opensearchtypes } from "@opensearch-project/opensearch";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  listingIndexNames,
  listingIndexSchemaVersion,
  listingRebuildIndexName,
  type ListingSearchDocument,
} from "../src/search/listing-index-definition";
import { OpenSearchListingIndex, OpenSearchListingIndexCatalog } from "../src/search/listing-index";
import { ListingIndexManager } from "../src/search/listing-index-manager";

const node = process.env.OPENSEARCH_INTEGRATION_URL ?? "";
const integration = describe.skipIf(node.length === 0);

function document(id: string, version: number): ListingSearchDocument {
  const timestamp = "2026-08-01T12:00:00.000Z";
  return {
    schemaVersion: listingIndexSchemaVersion,
    id,
    type: "SERVICE",
    status: "PUBLISHED",
    locale: "en-US",
    slug: `synthetic-service-${version}`,
    title: "Synthetic public service",
    summary: null,
    body: "Synthetic integration content only.",
    category: {
      id: randomUUID(),
      slug: "services",
      path: ["services"],
      nameZhHans: "服务",
      nameEn: "Services",
      aliases: [],
    },
    region: {
      id: randomUUID(),
      code: "US-CA-LA",
      slug: "los-angeles",
      path: ["southern-california", "los-angeles"],
      nameZhHans: "洛杉矶",
      nameEn: "Los Angeles",
      aliases: ["LA"],
    },
    price: { amountMinor: null, currency: "USD", unit: "NEGOTIABLE" },
    location: { precision: "CITY" },
    attributes: [],
    publisher: { ownerId: randomUUID(), displayName: "Synthetic Publisher" },
    qualityScore: 0.5,
    isSponsored: false,
    promotion: null,
    publishedAt: timestamp,
    expiresAt: "2026-09-01T12:00:00.000Z",
    updatedAt: timestamp,
    contentVersion: version,
    indexedAt: timestamp,
  };
}

integration("Listing search rebuild with real OpenSearch", () => {
  const prefix = `socal_rb_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  const names = listingIndexNames(prefix);
  const operationId = randomUUID();
  const candidate = listingRebuildIndexName(prefix, operationId);
  let client: Client;

  beforeAll(() => {
    client = new Client({ node, requestTimeout: 10_000, maxRetries: 2 });
  });

  afterAll(async () => {
    if (!client) return;
    for (const index of [candidate, names.physical]) {
      const exists = await client.indices.exists({ index });
      if (exists.body) await client.indices.delete({ index });
    }
    await client.close();
  });

  it("creates an alias-free candidate, validates versions, switches, and rolls back atomically", async () => {
    const manager = new ListingIndexManager(client, prefix);
    const catalog = new OpenSearchListingIndexCatalog(client);
    await manager.ensure();
    const source = await manager.resolveAliasTarget();
    expect(source).toBe(names.physical);
    await expect(manager.createRebuildIndex(candidate)).resolves.toBe("created");
    const candidateAliases = (await client.indices.getAlias({ index: candidate }))
      .body as opensearchtypes.IndicesGetAliasResponse;
    expect(candidateAliases[candidate]?.aliases).toEqual({});

    const listingId = randomUUID();
    const writer = new OpenSearchListingIndex(client, candidate, candidate);
    await expect(writer.upsert(document(listingId, 7), 7)).resolves.toBe("applied");
    await catalog.refresh(candidate);
    await expect(catalog.listVersions({ index: candidate, limit: 100 })).resolves.toEqual({
      items: [{ id: listingId, version: 7 }],
      nextCursor: null,
    });

    await manager.switchAliases(source, candidate);
    await expect(manager.resolveAliasTarget()).resolves.toBe(candidate);
    const switched = (await client.indices.getAlias({ index: candidate }))
      .body as opensearchtypes.IndicesGetAliasResponse;
    expect(switched[candidate]?.aliases).toMatchObject({
      [names.readAlias]: {},
      [names.writeAlias]: { is_write_index: true },
    });

    await manager.switchAliases(candidate, source);
    await expect(manager.resolveAliasTarget()).resolves.toBe(source);
    const rolledBack = (await client.indices.getAlias({ index: source }))
      .body as opensearchtypes.IndicesGetAliasResponse;
    expect(rolledBack[source]?.aliases).toMatchObject({
      [names.readAlias]: {},
      [names.writeAlias]: { is_write_index: true },
    });
  });
});
