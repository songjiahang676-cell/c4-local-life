import type { opensearchtypes } from "@opensearch-project/opensearch";
import {
  buildListingIndexDefinition,
  listingIndexNames,
  listingIndexSchemaVersion,
  type ListingIndexDefinition,
  type ListingIndexNames,
} from "./listing-index-definition";

export type ListingIndexClient = Readonly<{
  indices: Readonly<{
    exists(request: { index: string }): Promise<{ body: boolean }>;
    create(request: {
      body: ListingIndexDefinition;
      index: string;
      wait_for_active_shards: string;
    }): Promise<unknown>;
    getMapping(request: {
      index: string;
    }): Promise<{ body: opensearchtypes.IndicesGetMappingResponse }>;
    getAlias(request: {
      index: string;
    }): Promise<{ body: opensearchtypes.IndicesGetAliasResponse }>;
  }>;
}>;

export type EnsureListingIndexResult = Readonly<{
  outcome: "created" | "existing";
  names: ListingIndexNames;
  schemaVersion: number;
}>;

export class ListingIndexContractError extends Error {
  readonly code = "LISTING_INDEX_CONTRACT_MISMATCH";

  constructor(message: string) {
    super(message);
    this.name = "ListingIndexContractError";
  }
}

function mappingMeta(
  response: opensearchtypes.IndicesGetMappingResponse,
  physicalIndex: string,
): Record<string, unknown> | null {
  const mapping = response[physicalIndex]?.mappings;
  if (!mapping || typeof mapping !== "object") return null;
  const meta = mapping._meta;
  return meta && typeof meta === "object" && !Array.isArray(meta)
    ? (meta as Record<string, unknown>)
    : null;
}

export class ListingIndexManager {
  readonly #client: ListingIndexClient;
  readonly #names: ListingIndexNames;

  constructor(client: ListingIndexClient, indexPrefix: string) {
    this.#client = client;
    this.#names = listingIndexNames(indexPrefix);
  }

  async ensure(): Promise<EnsureListingIndexResult> {
    const exists = await this.#client.indices.exists({ index: this.#names.physical });
    if (exists.body) {
      await this.#validateExisting();
      return {
        outcome: "existing",
        names: this.#names,
        schemaVersion: listingIndexSchemaVersion,
      };
    }

    try {
      await this.#client.indices.create({
        index: this.#names.physical,
        body: buildListingIndexDefinition(this.#names),
        wait_for_active_shards: "1",
      });
    } catch (error: unknown) {
      const createdByAnotherActor = await this.#client.indices.exists({
        index: this.#names.physical,
      });
      if (!createdByAnotherActor.body) throw error;
    }

    await this.#validateExisting();
    return {
      outcome: "created",
      names: this.#names,
      schemaVersion: listingIndexSchemaVersion,
    };
  }

  async #validateExisting(): Promise<void> {
    const [mapping, aliases] = await Promise.all([
      this.#client.indices.getMapping({ index: this.#names.physical }),
      this.#client.indices.getAlias({ index: this.#names.physical }),
    ]);
    const meta = mappingMeta(mapping.body, this.#names.physical);
    if (
      meta?.schemaVersion !== listingIndexSchemaVersion ||
      meta.projection !== "public-listing" ||
      meta.canonicalSource !== "postgresql" ||
      meta.pii !== "excluded"
    ) {
      throw new ListingIndexContractError(
        `Index ${this.#names.physical} does not match Listing schema v${listingIndexSchemaVersion}`,
      );
    }

    const indexAliases = aliases.body[this.#names.physical]?.aliases;
    if (
      !indexAliases ||
      !(this.#names.readAlias in indexAliases) ||
      indexAliases[this.#names.writeAlias]?.is_write_index !== true
    ) {
      throw new ListingIndexContractError(
        `Index ${this.#names.physical} is missing its read/write alias contract`,
      );
    }
  }
}
