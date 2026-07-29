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
