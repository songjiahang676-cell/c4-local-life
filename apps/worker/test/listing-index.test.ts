import { describe, expect, it, vi } from "vitest";
import {
  buildListingIndexDefinition,
  listingIndexNames,
  listingIndexSchemaVersion,
} from "../src/search/listing-index-definition";
import {
  ListingIndexContractError,
  ListingIndexManager,
  type ListingIndexClient,
} from "../src/search/listing-index-manager";

type FakeIndexState = {
  exists: boolean;
  meta: Record<string, unknown>;
  aliases: Record<string, { is_write_index?: boolean }>;
};

function fakeClient(
  physical: string,
  state: FakeIndexState,
): ListingIndexClient & { create: ReturnType<typeof vi.fn> } {
  const create = vi.fn(() => {
    state.exists = true;
    return Promise.resolve();
  });
  return {
    create,
    indices: {
      exists: vi.fn(() => Promise.resolve({ body: state.exists })),
      create,
      getMapping: vi.fn(() =>
        Promise.resolve({
          body: {
            [physical]: {
              mappings: { _meta: state.meta },
            },
          },
        }),
      ),
      getAlias: vi.fn(() =>
        Promise.resolve({
          body: {
            [physical]: {
              aliases: state.aliases,
            },
          },
        }),
      ),
    },
  };
}

function validState(prefix: string): FakeIndexState {
  const names = listingIndexNames(prefix);
  return {
    exists: false,
    meta: {
      schemaVersion: listingIndexSchemaVersion,
      projection: "public-listing",
      canonicalSource: "postgresql",
      pii: "excluded",
    },
    aliases: {
      [names.readAlias]: {},
      [names.writeAlias]: { is_write_index: true },
    },
  };
}

function collectPropertyPaths(value: unknown, prefix = ""): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const record = value as Record<string, unknown>;
  const properties = record.properties;
  if (!properties || typeof properties !== "object" || Array.isArray(properties)) return [];
  return Object.entries(properties as Record<string, unknown>).flatMap(([name, property]) => {
    const path = prefix ? `${prefix}.${name}` : name;
    return [path, ...collectPropertyPaths(property, path)];
  });
}

describe("Listing index contract", () => {
  it("uses stable versioned names and rejects unsafe prefixes", () => {
    expect(listingIndexNames("socal_local")).toEqual({
      physical: "socal_local_listings_v1",
      readAlias: "socal_local_listings_read",
      writeAlias: "socal_local_listings_write",
    });
    for (const unsafe of ["A", "UPPER_CASE", "-leading", "two words", "a".repeat(41)]) {
      expect(() => listingIndexNames(unsafe)).toThrow(/prefix/);
    }
  });

  it("defines strict bilingual, geo, alias, and public-field mappings", () => {
    const names = listingIndexNames("socal_test");
    const definition = buildListingIndexDefinition(names);
    expect(definition.aliases).toEqual({
      [names.readAlias]: {},
      [names.writeAlias]: { is_write_index: true },
    });
    expect(definition.mappings).toMatchObject({
      dynamic: "strict",
      _meta: {
        schemaVersion: 1,
        projection: "public-listing",
        canonicalSource: "postgresql",
        pii: "excluded",
      },
      properties: {
        title: {
          analyzer: "socal_bilingual_index",
          fields: {
            zh: { analyzer: "socal_zh_index" },
            en: { analyzer: "socal_en_index" },
            prefix: { analyzer: "socal_prefix_index" },
          },
        },
        location: {
          dynamic: "strict",
          properties: { point: { type: "geo_point", ignore_malformed: false } },
        },
      },
    });

    const fieldPaths = collectPropertyPaths(definition.mappings);
    for (const forbidden of [
      "phone",
      "email",
      "exactAddress",
      "contactMode",
      "moderationStatus",
      "riskScore",
      "objectKey",
      "licenseNumber",
      "latitude",
      "longitude",
    ]) {
      expect(fieldPaths.some((path) => path.toLowerCase().includes(forbidden.toLowerCase()))).toBe(
        false,
      );
    }
  });

  it("creates once and validates the same contract on repeated startup", async () => {
    const prefix = "socal_test";
    const names = listingIndexNames(prefix);
    const state = validState(prefix);
    const client = fakeClient(names.physical, state);
    const manager = new ListingIndexManager(client, prefix);

    await expect(manager.ensure()).resolves.toMatchObject({ outcome: "created", names });
    await expect(manager.ensure()).resolves.toMatchObject({ outcome: "existing", names });
    expect(client.create).toHaveBeenCalledTimes(1);
  });

  it("fails closed when an existing index has mapping or alias drift", async () => {
    const prefix = "socal_test";
    const names = listingIndexNames(prefix);
    const mappingDrift = validState(prefix);
    mappingDrift.exists = true;
    mappingDrift.meta.schemaVersion = 99;

    await expect(
      new ListingIndexManager(fakeClient(names.physical, mappingDrift), prefix).ensure(),
    ).rejects.toBeInstanceOf(ListingIndexContractError);

    const aliasDrift = validState(prefix);
    aliasDrift.exists = true;
    aliasDrift.aliases[names.writeAlias] = {};
    await expect(
      new ListingIndexManager(fakeClient(names.physical, aliasDrift), prefix).ensure(),
    ).rejects.toThrow(/alias contract/);
  });
});
