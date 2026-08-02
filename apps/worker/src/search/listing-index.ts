import { errors, type Client } from "@opensearch-project/opensearch";
import type { ListingSearchDocument } from "./listing-index-definition";

export type ListingIndexMutationOutcome = "applied" | "stale" | "missing";

export type ListingIndexReader = {
  version(listingId: string): Promise<number | null>;
};

export type ListingIndexWriter = ListingIndexReader & {
  upsert(document: ListingSearchDocument, version: number): Promise<ListingIndexMutationOutcome>;
  remove(listingId: string, version: number): Promise<ListingIndexMutationOutcome>;
};

export type ListingIndexVersionPage = Readonly<{
  items: readonly Readonly<{ id: string; version: number }>[];
  nextCursor: string | null;
}>;

type ListingIndexVersionSearchResponse = Readonly<{
  hits: Readonly<{
    hits: readonly Readonly<{
      _source?: Readonly<{ id?: string; contentVersion?: number }>;
    }>[];
  }>;
}>;

function isVersionConflict(error: unknown): boolean {
  return error instanceof errors.ResponseError && error.statusCode === 409;
}

function isMissing(error: unknown): boolean {
  return error instanceof errors.ResponseError && error.statusCode === 404;
}

function sourceVersion(value: unknown): number | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  if (!("_source" in value)) return null;
  const source = value._source;
  if (source === null || typeof source !== "object" || Array.isArray(source)) return null;
  if (!("contentVersion" in source) || !Number.isInteger(source.contentVersion)) return null;
  const version = source.contentVersion as number;
  return version > 0 ? version : null;
}

export class OpenSearchListingIndex implements ListingIndexWriter {
  constructor(
    private readonly client: Client,
    private readonly readAlias: string,
    private readonly writeAlias: string,
  ) {}

  async upsert(
    document: ListingSearchDocument,
    version: number,
  ): Promise<ListingIndexMutationOutcome> {
    try {
      await this.client.index({
        index: this.writeAlias,
        id: document.id,
        body: document,
        version,
        version_type: "external_gte",
      });
      return "applied";
    } catch (error: unknown) {
      if (isVersionConflict(error)) return "stale";
      throw error;
    }
  }

  async remove(listingId: string, version: number): Promise<ListingIndexMutationOutcome> {
    try {
      const response = await this.client.delete({
        index: this.writeAlias,
        id: listingId,
        version,
        version_type: "external_gte",
      });
      return response.body.result === "not_found" ? "missing" : "applied";
    } catch (error: unknown) {
      if (isVersionConflict(error)) return "stale";
      if (isMissing(error)) return "missing";
      throw error;
    }
  }

  async version(listingId: string): Promise<number | null> {
    try {
      const response = await this.client.get({
        index: this.readAlias,
        id: listingId,
        _source_includes: ["contentVersion"],
      });
      return sourceVersion(response.body);
    } catch (error: unknown) {
      if (isMissing(error)) return null;
      throw error;
    }
  }
}

export class RebuildAwareListingIndex implements ListingIndexWriter {
  constructor(
    private readonly client: Client,
    private readonly primary: ListingIndexWriter,
    private readonly secondaryTargets: (now: Date) => Promise<readonly string[]>,
  ) {}

  version(listingId: string): Promise<number | null> {
    return this.primary.version(listingId);
  }

  async upsert(
    document: ListingSearchDocument,
    version: number,
  ): Promise<ListingIndexMutationOutcome> {
    const primary = await this.primary.upsert(document, version);
    const secondary = await Promise.all(
      (await this.secondaryTargets(new Date())).map((target) =>
        new OpenSearchListingIndex(this.client, target, target).upsert(document, version),
      ),
    );
    return this.#combinedOutcome(primary, secondary);
  }

  async remove(listingId: string, version: number): Promise<ListingIndexMutationOutcome> {
    const primary = await this.primary.remove(listingId, version);
    const secondary = await Promise.all(
      (await this.secondaryTargets(new Date())).map((target) =>
        new OpenSearchListingIndex(this.client, target, target).remove(listingId, version),
      ),
    );
    return this.#combinedOutcome(primary, secondary);
  }

  #combinedOutcome(
    primary: ListingIndexMutationOutcome,
    secondary: readonly ListingIndexMutationOutcome[],
  ): ListingIndexMutationOutcome {
    const outcomes = [primary, ...secondary];
    if (outcomes.includes("applied")) return "applied";
    if (outcomes.includes("stale")) return "stale";
    return "missing";
  }
}

export class OpenSearchListingIndexCatalog {
  constructor(private readonly client: Client) {}

  writer(index: string): ListingIndexWriter {
    return new OpenSearchListingIndex(this.client, index, index);
  }

  async refresh(index: string): Promise<void> {
    await this.client.indices.refresh({ index });
  }

  async listVersions(input: {
    index: string;
    afterId?: string;
    limit: number;
  }): Promise<ListingIndexVersionPage> {
    if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 1_000) {
      throw new RangeError("Listing index version page limit must be between 1 and 1000");
    }
    const response = await this.client.search<ListingIndexVersionSearchResponse>({
      index: input.index,
      body: {
        size: input.limit,
        query: { match_all: {} },
        sort: [{ id: { order: "asc" } }],
        ...(input.afterId ? { search_after: [input.afterId] } : {}),
        _source: ["id", "contentVersion"],
      },
    });
    const items = response.body.hits.hits.map((hit) => {
      const source = hit._source;
      if (
        !source ||
        typeof source.id !== "string" ||
        typeof source.contentVersion !== "number" ||
        !Number.isInteger(source.contentVersion) ||
        source.contentVersion < 1
      ) {
        throw new Error("Listing index contains an invalid version projection");
      }
      return { id: source.id, version: source.contentVersion };
    });
    return {
      items,
      nextCursor: items.length === input.limit ? (items.at(-1)?.id ?? null) : null,
    };
  }
}
