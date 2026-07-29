import type {
  CreateListingDraftInput,
  CreateListingDraftResult,
  FindListingDraftCreateRetryInput,
  FindListingDraftCreateRetryResult,
  ListingDraftReferences,
  ListingDraftWriteFields,
  ListingStore,
  OwnerListingProjection,
  PublicListingProjection,
  ResolveListingDraftReferencesInput,
  UpdateListingDraftInput,
  UpdateListingDraftResult,
} from "../../src/modules/listings/listing.store";
import { MemoryTaxonomyStore } from "./memory-taxonomy.store";

export const memoryListingCategoryId = "11111111-1111-4111-8111-111111111111";
export const memoryListingRegionId = "22222222-2222-4222-8222-222222222222";
export const memoryListingRegionCode = "US-CA-ORANGE-IRVINE";

const category = {
  id: memoryListingCategoryId,
  vertical: "RENTAL" as const,
  slug: "synthetic-rentals",
  nameZhHans: "测试租房",
  nameEn: "Synthetic Rentals",
};
const region = {
  id: memoryListingRegionId,
  type: "CITY" as const,
  code: memoryListingRegionCode,
  slug: "synthetic-irvine",
  nameZhHans: "测试尔湾",
  nameEn: "Synthetic Irvine",
  timezone: "America/Los_Angeles",
};

export function createMemoryListingTaxonomyStore(): MemoryTaxonomyStore {
  const timestamp = new Date("2026-07-01T00:00:00.000Z");
  return new MemoryTaxonomyStore(
    [
      {
        ...region,
        parentId: null,
        latitude: 33.6846,
        longitude: -117.8265,
        isActive: true,
        sortOrder: 0,
        aliases: [],
      },
    ],
    [
      {
        ...category,
        parentId: null,
        iconKey: "rental",
        formSchemaVersion: 1,
        isActive: true,
        sortOrder: 0,
        aliases: [],
      },
    ],
    [
      {
        id: "33333333-3333-4333-8333-333333333333",
        categoryId: memoryListingCategoryId,
        version: 1,
        revision: 1,
        definition: {
          categoryId: memoryListingCategoryId,
          version: 1,
          fields: [],
        },
        contentHash: "0".repeat(64),
        basedOnVersion: null,
        createdById: null,
        updatedById: null,
        publishedById: null,
        createdAt: timestamp,
        updatedAt: timestamp,
        publishedAt: timestamp,
      },
    ],
  );
}

function cloneOwner(row: OwnerListingProjection): OwnerListingProjection {
  return structuredClone(row);
}

function rowFromCreate(input: CreateListingDraftInput): OwnerListingProjection {
  return {
    id: input.id,
    type: input.type,
    ownerId: input.actorUserId,
    organizationId: input.organizationId,
    formSchemaVersion: input.formSchemaVersion,
    status: "DRAFT",
    moderationStatus: "NOT_REVIEWED",
    locale: input.locale,
    title: input.title,
    slug: input.slug,
    summary: input.summary,
    body: input.body,
    price:
      input.priceAmount === null && input.priceUnit === null
        ? null
        : {
            amount: input.priceAmount,
            currency: input.currency,
            unit: input.priceUnit,
          },
    region,
    category,
    owner: {
      id: input.actorUserId,
      displayName: "Synthetic Listing Owner",
      avatarUrl: null,
    },
    organization: input.organizationId
      ? {
          id: input.organizationId,
          displayName: "Synthetic Listing Organization",
          slug: `synthetic-${input.organizationId}`,
          verificationStatus: "UNVERIFIED",
        }
      : null,
    location: {
      precision: input.locationPrecision,
      ...(input.latitude !== null && input.longitude !== null
        ? {
            point: {
              latitude: input.latitude,
              longitude: input.longitude,
            },
          }
        : {}),
    },
    contactMode: input.contactMode,
    attributes: structuredClone(input.attributes),
    mediaIds: [...input.mediaIds],
    isFeatured: false,
    featuredUntil: null,
    publishedAt: null,
    expiresAt: null,
    createdAt: new Date(input.occurredAt),
    updatedAt: new Date(input.occurredAt),
    version: 1,
  };
}

function applyFields(
  row: OwnerListingProjection,
  fields: ListingDraftWriteFields,
  occurredAt: Date,
): OwnerListingProjection {
  return {
    ...row,
    category: { ...category, id: fields.categoryId },
    formSchemaVersion: fields.formSchemaVersion,
    region: { ...region, id: fields.regionId },
    locale: fields.locale,
    title: fields.title,
    slug: fields.slug,
    summary: fields.summary,
    body: fields.body,
    price:
      fields.priceAmount === null && fields.priceUnit === null
        ? null
        : {
            amount: fields.priceAmount,
            currency: fields.currency,
            unit: fields.priceUnit,
          },
    contactMode: fields.contactMode,
    attributes: structuredClone(fields.attributes),
    mediaIds: [...fields.mediaIds],
    location: {
      precision: fields.locationPrecision,
      ...(fields.latitude !== null && fields.longitude !== null
        ? {
            point: {
              latitude: fields.latitude,
              longitude: fields.longitude,
            },
          }
        : {}),
    },
    updatedAt: new Date(occurredAt),
    version: row.version + 1,
  };
}

export class MemoryListingStore implements ListingStore {
  readonly auditActions: string[] = [];
  readonly outboxEvents: string[] = [];
  readonly #rows = new Map<string, OwnerListingProjection>();
  readonly #publicRows = new Map<string, PublicListingProjection>();
  readonly #idempotency = new Map<string, { hash: string; listingId: string }>();
  readonly #organizationReaders = new Map<string, Set<string>>();
  readonly #organizationWriters = new Map<string, Set<string>>();
  readonly #readyMedia = new Set<string>();

  registerReadyMedia(...mediaIds: readonly string[]): void {
    for (const mediaId of mediaIds) this.#readyMedia.add(mediaId);
  }

  registerOrganization(
    organizationId: string,
    input: { readers?: readonly string[]; writers?: readonly string[] },
  ): void {
    this.#organizationReaders.set(organizationId, new Set(input.readers ?? []));
    this.#organizationWriters.set(organizationId, new Set(input.writers ?? []));
  }

  registerPublic(listing: PublicListingProjection): void {
    this.#publicRows.set(listing.id, structuredClone(listing));
  }

  resolveReferences(
    input: ResolveListingDraftReferencesInput,
  ): Promise<ListingDraftReferences | null> {
    return Promise.resolve(
      input.type === category.vertical &&
        input.categoryId === category.id &&
        input.regionCode === region.code &&
        (input.formSchemaVersion === undefined || input.formSchemaVersion === 1)
        ? {
            categoryId: category.id,
            formSchemaVersion: 1,
            regionId: region.id,
          }
        : null,
    );
  }

  findCreateRetry(
    input: FindListingDraftCreateRetryInput,
  ): Promise<FindListingDraftCreateRetryResult> {
    const evidence = this.#idempotency.get(`${input.actorUserId}:${input.idempotencyKey}`);
    if (!evidence) return Promise.resolve({ kind: "missing" });
    if (evidence.hash !== input.requestHash) return Promise.resolve({ kind: "conflict" });
    const row = this.#rows.get(evidence.listingId);
    return Promise.resolve(
      row && this.#canRead(input.actorUserId, row)
        ? { kind: "exact_retry", listing: cloneOwner(row) }
        : { kind: "conflict" },
    );
  }

  createDraft(input: CreateListingDraftInput): Promise<CreateListingDraftResult> {
    if (
      input.organizationId &&
      !this.#organizationWriters.get(input.organizationId)?.has(input.actorUserId)
    ) {
      return Promise.resolve({ kind: "invalid_organization" });
    }
    if (input.mediaIds.some((mediaId) => !this.#readyMedia.has(mediaId))) {
      return Promise.resolve({ kind: "invalid_media" });
    }
    const key = `${input.actorUserId}:${input.idempotencyKey}`;
    const existing = this.#idempotency.get(key);
    if (existing) {
      const row = this.#rows.get(existing.listingId);
      return Promise.resolve(
        existing.hash === input.requestHash && row
          ? { kind: "exact_retry", listing: cloneOwner(row) }
          : { kind: "idempotency_conflict" },
      );
    }
    const row = rowFromCreate(input);
    this.#rows.set(row.id, row);
    this.#idempotency.set(key, { hash: input.requestHash, listingId: row.id });
    this.auditActions.push("listing.draft.created");
    this.outboxEvents.push("listing.draft.created");
    return Promise.resolve({ kind: "created", listing: cloneOwner(row) });
  }

  updateDraft(input: UpdateListingDraftInput): Promise<UpdateListingDraftResult> {
    const row = this.#rows.get(input.listingId);
    if (!row || !this.#canWrite(input.actorUserId, row)) {
      return Promise.resolve({ kind: "not_found" });
    }
    if (row.version !== input.expectedVersion) {
      return Promise.resolve({ kind: "version_conflict", currentVersion: row.version });
    }
    if (row.status !== "DRAFT") {
      return Promise.resolve({ kind: "state_conflict", currentVersion: row.version });
    }
    if (input.mediaIds.some((mediaId) => !this.#readyMedia.has(mediaId))) {
      return Promise.resolve({ kind: "invalid_media" });
    }
    const updated = applyFields(row, input, input.occurredAt);
    this.#rows.set(updated.id, updated);
    this.auditActions.push("listing.draft.updated");
    this.outboxEvents.push("listing.draft.updated");
    return Promise.resolve({ kind: "updated", listing: cloneOwner(updated) });
  }

  findPublicById(input: { listingId: string; now: Date }): Promise<PublicListingProjection | null> {
    return Promise.resolve(structuredClone(this.#publicRows.get(input.listingId) ?? null));
  }

  findByIdForOwner(input: {
    actorUserId: string;
    listingId: string;
    now: Date;
  }): Promise<OwnerListingProjection | null> {
    const row = this.#rows.get(input.listingId);
    return Promise.resolve(row && this.#canRead(input.actorUserId, row) ? cloneOwner(row) : null);
  }

  #canRead(actorUserId: string, row: OwnerListingProjection): boolean {
    return row.organizationId
      ? Boolean(
          this.#organizationReaders.get(row.organizationId)?.has(actorUserId) ||
          this.#organizationWriters.get(row.organizationId)?.has(actorUserId),
        )
      : row.ownerId === actorUserId;
  }

  #canWrite(actorUserId: string, row: OwnerListingProjection): boolean {
    return row.organizationId
      ? Boolean(this.#organizationWriters.get(row.organizationId)?.has(actorUserId))
      : row.ownerId === actorUserId;
  }
}
