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
    updateAliases(request: {
      body: opensearchtypes.IndicesUpdateAliasesRequest["body"];
    }): Promise<unknown>;
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
    const aliasExists = await this.#client.indices.exists({ index: this.#names.readAlias });
    if (aliasExists.body) {
      await this.resolveAliasTarget();
      return {
        outcome: "existing",
        names: this.#names,
        schemaVersion: listingIndexSchemaVersion,
      };
    }

    const physicalExists = await this.#client.indices.exists({ index: this.#names.physical });
    if (physicalExists.body) {
      throw new ListingIndexContractError(
        `Index ${this.#names.physical} exists without the Listing alias contract`,
      );
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

    await this.resolveAliasTarget();
    return {
      outcome: "created",
      names: this.#names,
      schemaVersion: listingIndexSchemaVersion,
    };
  }

  async resolveAliasTarget(): Promise<string> {
    const aliases = await this.#client.indices.getAlias({ index: this.#names.readAlias });
    const targets = Object.entries(aliases.body);
    if (targets.length !== 1) {
      throw new ListingIndexContractError("Listing read/write aliases must share one write index");
    }
    const [target, value] = targets[0]!;
    if (
      !(this.#names.readAlias in value.aliases) ||
      value.aliases[this.#names.writeAlias]?.is_write_index !== true
    ) {
      throw new ListingIndexContractError("Listing read/write aliases must share one write index");
    }
    await this.validatePhysical(target);
    return target;
  }

  async createRebuildIndex(indexName: string): Promise<"created" | "existing"> {
    const exists = await this.#client.indices.exists({ index: indexName });
    if (exists.body) {
      await this.validatePhysical(indexName);
      await this.#validateCandidateAliases(indexName);
      return "existing";
    }
    await this.#client.indices.create({
      index: indexName,
      body: buildListingIndexDefinition(this.#names, { includeAliases: false }),
      wait_for_active_shards: "1",
    });
    await this.validatePhysical(indexName);
    await this.#validateCandidateAliases(indexName);
    return "created";
  }

  async switchAliases(expectedSource: string, targetIndex: string): Promise<void> {
    const current = await this.resolveAliasTarget();
    if (current === targetIndex) return;
    if (current !== expectedSource) {
      throw new ListingIndexContractError(
        `Listing alias source changed before switch (expected ${expectedSource}, found ${current})`,
      );
    }
    await this.validatePhysical(targetIndex);
    await this.#client.indices.updateAliases({
      body: {
        actions: [
          { remove: { index: expectedSource, alias: this.#names.readAlias } },
          { remove: { index: expectedSource, alias: this.#names.writeAlias } },
          { add: { index: targetIndex, alias: this.#names.readAlias } },
          {
            add: {
              index: targetIndex,
              alias: this.#names.writeAlias,
              is_write_index: true,
            },
          },
        ],
      },
    });
    const switched = await this.resolveAliasTarget();
    if (switched !== targetIndex) {
      throw new ListingIndexContractError("Listing alias switch did not converge on target index");
    }
  }

  async validatePhysical(physicalIndex: string): Promise<void> {
    const mapping = await this.#client.indices.getMapping({ index: physicalIndex });
    const meta = mappingMeta(mapping.body, physicalIndex);
    if (
      meta?.schemaVersion !== listingIndexSchemaVersion ||
      meta.projection !== "public-listing" ||
      meta.canonicalSource !== "postgresql" ||
      meta.pii !== "excluded"
    ) {
      throw new ListingIndexContractError(
        `Index ${physicalIndex} does not match Listing schema v${listingIndexSchemaVersion}`,
      );
    }
  }

  async #validateCandidateAliases(indexName: string): Promise<void> {
    const response = await this.#client.indices.getAlias({ index: indexName });
    if (Object.keys(response.body[indexName]?.aliases ?? {}).length !== 0) {
      throw new ListingIndexContractError(`Candidate index ${indexName} must not have aliases`);
    }
  }
}
