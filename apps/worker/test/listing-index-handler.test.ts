import { randomUUID } from "node:crypto";
import type { ListingSearchProjection } from "@socal/database/listing-search";
import { describe, expect, it, vi } from "vitest";
import type { OutboxJobEnvelope } from "../src/outbox/bullmq-outbox.publisher";
import {
  ListingIndexHandler,
  ListingSearchProjectionError,
  PermanentListingSearchEventError,
  buildListingSearchDocument,
  listingSearchEventPriority,
  parseListingSearchEnvelope,
} from "../src/search/listing-index-handler";
import type { ListingIndexWriter } from "../src/search/listing-index";

const listingId = "10000000-0000-4000-8000-000000000001";
const eventId = "10000000-0000-4000-8000-000000000002";
const occurredAt = new Date("2026-07-29T18:00:00.000Z");
const handledAt = new Date("2026-07-29T18:00:07.000Z");

function projection(overrides: Partial<ListingSearchProjection> = {}): ListingSearchProjection {
  return {
    id: listingId,
    type: "RENTAL",
    locale: "zh-Hans",
    slug: "synthetic-rental",
    title: "测试出租",
    summary: "Public summary",
    body: "Public body",
    category: {
      id: randomUUID(),
      slug: "rentals",
      path: ["housing", "rentals"],
      nameZhHans: "房屋出租",
      nameEn: "Rentals",
      aliases: ["租房"],
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
    price: { amount: "3250.50", currency: "USD", unit: "MONTHLY" },
    location: { precision: "APPROXIMATE", latitude: 34.123, longitude: -118.321 },
    attributes: {
      bedrooms: 2,
      furnished: true,
      neighborhood: "Synthetic district",
      nested: { ignored: true },
    },
    publisher: {
      ownerId: randomUUID(),
      displayName: "Synthetic Publisher",
      avatarUrl: null,
      organizationId: null,
      organizationSlug: null,
      organizationVerification: null,
    },
    qualityScore: 0.8,
    isSponsored: false,
    publishedAt: new Date("2026-07-20T00:00:00.000Z"),
    expiresAt: new Date("2026-08-20T00:00:00.000Z"),
    updatedAt: new Date("2026-07-29T17:59:00.000Z"),
    version: 5,
    ...overrides,
  };
}

function envelope(
  eventType: "listing.published" | "listing.deleted" = "listing.published",
): OutboxJobEnvelope {
  return {
    version: 1,
    eventId,
    aggregateType: "LISTING",
    aggregateId: listingId,
    eventType,
    occurredAt: occurredAt.toISOString(),
    payload: {
      schemaVersion: 1,
      listingId,
      aggregateVersion: 4,
      phone: "must-not-be-consumed",
    },
  };
}

function index(overrides: Partial<ListingIndexWriter> = {}): ListingIndexWriter {
  return {
    upsert: () => Promise.resolve("applied"),
    remove: () => Promise.resolve("applied"),
    version: () => Promise.resolve(null),
    ...overrides,
  };
}

describe("Listing index event handler", () => {
  it("parses only the strict event identity/version envelope", () => {
    expect(parseListingSearchEnvelope(envelope(), "listing.published")).toEqual({
      listingId,
      aggregateVersion: 4,
      occurredAt,
    });
    expect(() =>
      parseListingSearchEnvelope({ ...envelope(), aggregateType: "USER" }, "listing.published"),
    ).toThrow(PermanentListingSearchEventError);
    expect(() =>
      parseListingSearchEnvelope(envelope("listing.deleted"), "listing.published"),
    ).toThrow(PermanentListingSearchEventError);
    expect(listingSearchEventPriority("listing.deleted")).toBe("urgent");
    expect(listingSearchEventPriority("listing.published")).toBe("normal");
  });

  it("builds integer-money and primitive-only public documents", () => {
    const document = buildListingSearchDocument(projection(), handledAt);
    expect(document).toMatchObject({
      id: listingId,
      status: "PUBLISHED",
      price: { amountMinor: 325_050, currency: "USD", unit: "MONTHLY" },
      location: { point: { lat: 34.123, lon: -118.321 } },
      contentVersion: 5,
      indexedAt: handledAt.toISOString(),
    });
    expect(document.attributes).toEqual([
      { key: "bedrooms", numberValue: 2 },
      { key: "furnished", booleanValue: true },
      {
        key: "neighborhood",
        keywordValue: "Synthetic district",
        textValue: "Synthetic district",
      },
    ]);
    expect(() =>
      buildListingSearchDocument(
        projection({ price: { amount: "1.00", currency: "CAD", unit: "FIXED" } }),
        handledAt,
      ),
    ).toThrow(ListingSearchProjectionError);
  });

  it("reloads the newer canonical projection and external-versions the upsert", async () => {
    const upsert = vi.fn(() => Promise.resolve<"applied">("applied"));
    const observations: unknown[] = [];
    const handler = new ListingIndexHandler(
      {
        findById: () => Promise.resolve({ id: listingId, version: 5, projection: projection() }),
      },
      index({ upsert }),
      (value) => observations.push(value),
    );

    await expect(handler.handle(envelope(), "listing.published", handledAt)).resolves.toEqual({
      operation: "upsert",
      outcome: "applied",
      version: 5,
    });
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ id: listingId, contentVersion: 5 }),
      5,
    );
    expect(observations).toEqual([
      {
        operation: "upsert",
        outcome: "applied",
        priority: "normal",
        freshnessSeconds: 7,
      },
    ]);
  });

  it("prioritizes canonical deletion and records bounded freshness", async () => {
    const remove = vi.fn(() => Promise.resolve<"missing">("missing"));
    const observations: unknown[] = [];
    const handler = new ListingIndexHandler(
      {
        findById: () => Promise.resolve({ id: listingId, version: 6, projection: null }),
      },
      index({ remove }),
      (value) => observations.push(value),
    );

    await expect(
      handler.handle(envelope("listing.deleted"), "listing.deleted", handledAt),
    ).resolves.toEqual({
      operation: "delete",
      outcome: "missing",
      version: 6,
    });
    expect(remove).toHaveBeenCalledWith(listingId, 6);
    expect(observations).toEqual([
      {
        operation: "delete",
        outcome: "missing",
        priority: "urgent",
        freshnessSeconds: 7,
      },
    ]);
  });

  it("retries when the canonical store is unexpectedly behind the durable event", async () => {
    const observations: unknown[] = [];
    const handler = new ListingIndexHandler(
      {
        findById: () =>
          Promise.resolve({ id: listingId, version: 3, projection: projection({ version: 3 }) }),
      },
      index(),
      (value) => observations.push(value),
    );

    await expect(handler.handle(envelope(), "listing.published", handledAt)).rejects.toThrow(
      "Canonical Listing version is behind",
    );
    expect(observations).toEqual([
      {
        operation: "upsert",
        outcome: "failed",
        priority: "normal",
        freshnessSeconds: 7,
      },
    ]);
  });
});
