import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { CreateListingInput, ListingType } from "@socal/contracts";

export type ListingSummary = {
  id: string;
  type: ListingType;
  title: string;
  regionCode: string;
  status: "DRAFT" | "PUBLISHED";
  createdAt: string;
};

@Injectable()
export class ListingsService {
  private readonly rows: ListingSummary[] = [];

  list(type?: ListingType, limit = 20): ListingSummary[] {
    return this.rows.filter((row) => !type || row.type === type).slice(0, limit);
  }

  create(input: CreateListingInput): ListingSummary {
    const listing: ListingSummary = {
      id: randomUUID(),
      type: input.type,
      title: input.title,
      regionCode: input.regionCode,
      status: "DRAFT",
      createdAt: new Date().toISOString(),
    };
    this.rows.unshift(listing);
    return listing;
  }
}
