import { createHash, randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type {
  CreateListingInput,
  ListingOwnerResponse,
  ListingOwnerView,
  ListingResponse,
  Money,
  PublicListingView,
  UpdateListingInput,
} from "@socal/contracts";
import {
  activeUserPolicyActions,
  listingObjectPolicyActions,
  PolicyService,
  type PolicyRequestContext,
} from "../../common/authorization/policy";
import { CategoryFormSchemaNotFoundError, TaxonomyService } from "../taxonomy/taxonomy.service";
import {
  createDraftListing,
  ListingDomainError,
  type ListingDetail,
  type ListingPrice,
  type ListingType,
} from "./listing-domain";
import {
  LISTING_STORE,
  type ListingDraftJsonValue,
  type ListingDraftWriteFields,
  type ListingStore,
  type OwnerListingProjection,
  type PublicListingProjection,
} from "./listing.store";

export class ListingNotFoundError extends Error {
  constructor() {
    super("Listing not found");
    this.name = "ListingNotFoundError";
  }
}

export class ListingAccessDeniedError extends Error {
  constructor() {
    super("Access denied");
    this.name = "ListingAccessDeniedError";
  }
}

export class ListingIdempotencyConflictError extends Error {
  constructor() {
    super("Idempotency key was already used with a different request");
    this.name = "ListingIdempotencyConflictError";
  }
}

export class ListingVersionConflictError extends Error {
  constructor(readonly currentVersion?: number) {
    super("Listing version conflict");
    this.name = "ListingVersionConflictError";
  }
}

export class ListingStateConflictError extends Error {
  constructor() {
    super("Listing is not an editable draft");
    this.name = "ListingStateConflictError";
  }
}

export class ListingValidationError extends Error {
  constructor(readonly errors?: Record<string, string[]>) {
    super("Listing validation failed");
    this.name = "ListingValidationError";
  }
}

export type ListingReadResult = {
  response: ListingResponse;
  privateView: boolean;
  version: number;
};

const locationPrecisions = ["CITY", "NEIGHBORHOOD", "APPROXIMATE", "EXACT"] as const;

function authenticatedUserId(context: PolicyRequestContext): string {
  if (context.actor.kind === "guest") throw new ListingAccessDeniedError();
  return context.actor.userId;
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const record = value as Record<string, unknown>;
  const entries = Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`);
  return `{${entries.join(",")}}`;
}

function requestHash(value: unknown): string {
  return createHash("sha256").update(canonicalize(value), "utf8").digest("hex");
}

function toMinorAmount(amount: string): bigint {
  const [whole = "0", fraction = ""] = amount.split(".");
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
}

function toDomainPrice(price: Money | null | undefined): ListingPrice | null {
  if (!price) return null;
  return {
    amountMinor: price.amount === null ? null : toMinorAmount(price.amount),
    currency: "USD",
    unit: price.unit,
  };
}

function normalizedAmount(price: Money | null | undefined): string | null {
  if (!price?.amount) return null;
  const minor = toMinorAmount(price.amount);
  return `${minor / 100n}.${(minor % 100n).toString().padStart(2, "0")}`;
}

function emptyDetail(type: ListingType): ListingDetail {
  return { kind: type } as ListingDetail;
}

function assertDomainDraft(id: string, type: ListingType, price: Money | null, now: Date): void {
  try {
    createDraftListing({
      id,
      type,
      detail: emptyDetail(type),
      price: toDomainPrice(price),
      createdAt: now,
    });
  } catch (error) {
    if (error instanceof ListingDomainError) throw new ListingValidationError();
    throw error;
  }
}

function locationPrecision(value: string): (typeof locationPrecisions)[number] {
  const parsed = locationPrecisions.find((candidate) => candidate === value);
  if (!parsed) throw new Error("Stored Listing location precision is invalid");
  return parsed;
}

function toMoney(price: OwnerListingProjection["price"]): Money | null {
  if (!price) return null;
  if (price.currency !== "USD" || price.unit === null) {
    throw new Error("Stored Listing price is invalid");
  }
  return {
    amount: price.amount,
    currency: "USD",
    unit: price.unit,
  };
}

function commonView(
  listing: OwnerListingProjection | PublicListingProjection,
): Omit<PublicListingView, "expiresAt" | "featured" | "publishedAt" | "status"> {
  return {
    id: listing.id,
    type: listing.type,
    locale: listing.locale as "zh-Hans" | "en-US",
    title: listing.title,
    slug: listing.slug,
    summary: listing.summary,
    body: listing.body,
    price: toMoney(listing.price),
    region: listing.region,
    category: listing.category,
    owner: listing.owner,
    organization: listing.organization,
    location: {
      precision: locationPrecision(listing.location.precision),
    },
    attributes: listing.attributes,
    featuredUntil: listing.featuredUntil?.toISOString() ?? null,
    createdAt: listing.createdAt.toISOString(),
    updatedAt: listing.updatedAt.toISOString(),
    version: listing.version,
  };
}

function toPublicView(listing: PublicListingProjection): PublicListingView {
  return {
    ...commonView(listing),
    status: "PUBLISHED",
    featured: listing.featured,
    publishedAt: listing.publishedAt.toISOString(),
    expiresAt: listing.expiresAt.toISOString(),
  };
}

function toOwnerView(listing: OwnerListingProjection): ListingOwnerView {
  const base = commonView(listing);
  const point = listing.location.point
    ? {
        latitude: Number(listing.location.point.latitude),
        longitude: Number(listing.location.point.longitude),
      }
    : undefined;
  return {
    ...base,
    ownerId: listing.ownerId,
    organizationId: listing.organizationId,
    formSchemaVersion: listing.formSchemaVersion,
    status: listing.status,
    moderationStatus: listing.moderationStatus,
    location: {
      precision: locationPrecision(listing.location.precision),
      ...(point ? { point } : {}),
    },
    contactMode: listing.contactMode,
    mediaIds: listing.mediaIds,
    isFeatured: listing.isFeatured,
    publishedAt: listing.publishedAt?.toISOString() ?? null,
    expiresAt: listing.expiresAt?.toISOString() ?? null,
  };
}

function cloneAttributes(
  attributes: OwnerListingProjection["attributes"] | CreateListingInput["attributes"],
): Record<string, ListingDraftJsonValue> {
  return JSON.parse(JSON.stringify(attributes)) as Record<string, ListingDraftJsonValue>;
}

function buildWriteFields(input: {
  current?: OwnerListingProjection;
  patch: CreateListingInput | UpdateListingInput;
  references: { categoryId: string; formSchemaVersion: number; regionId: string };
  attributes: Record<string, ListingDraftJsonValue>;
  slug: string;
}): ListingDraftWriteFields {
  const current = input.current;
  const patch = input.patch;
  const normalizedPrice =
    "price" in patch && patch.price !== undefined
      ? patch.price
      : current
        ? toMoney(current.price)
        : null;
  const locationPatch = "location" in patch ? patch.location : undefined;
  const currentPoint = current?.location.point;
  const point =
    locationPatch?.point === null
      ? undefined
      : locationPatch?.point
        ? locationPatch.point
        : currentPoint
          ? {
              latitude: Number(currentPoint.latitude),
              longitude: Number(currentPoint.longitude),
            }
          : undefined;
  return {
    categoryId: input.references.categoryId,
    formSchemaVersion: input.references.formSchemaVersion,
    regionId: input.references.regionId,
    locale: patch.locale ?? current?.locale ?? "zh-Hans",
    title: patch.title ?? current?.title ?? "",
    slug: input.slug,
    summary:
      "summary" in patch && patch.summary !== undefined
        ? patch.summary
        : (current?.summary ?? null),
    body: patch.body ?? current?.body ?? "",
    priceAmount: normalizedAmount(normalizedPrice),
    currency: "USD",
    priceUnit: normalizedPrice?.unit ?? null,
    contactMode: patch.contactMode ?? current?.contactMode ?? "IN_APP",
    attributes: input.attributes,
    latitude: point ? String(point.latitude) : null,
    longitude: point ? String(point.longitude) : null,
    locationPrecision: locationPatch?.precision ?? current?.location.precision ?? "CITY",
    mediaIds:
      "mediaIds" in patch && patch.mediaIds !== undefined
        ? patch.mediaIds
        : (current?.mediaIds ?? []),
  };
}

export function listingEtag(version: number): string {
  return `"listing-v${version}"`;
}

export function listingVersionFromEtag(value: string | undefined): number | null {
  if (!value) return null;
  const match = /^"listing-v([1-9]\d{0,9})"$/.exec(value);
  if (!match) return null;
  const version = Number(match[1]);
  return Number.isSafeInteger(version) && version <= 2_147_483_647 ? version : null;
}

@Injectable()
export class ListingsService {
  constructor(
    @Inject(LISTING_STORE) private readonly store: ListingStore,
    private readonly taxonomy: TaxonomyService,
    private readonly policies: PolicyService,
  ) {}

  list(): { data: PublicListingView[]; page: { hasMore: false; nextCursor: null } } {
    return { data: [], page: { hasMore: false, nextCursor: null } };
  }

  async create(
    context: PolicyRequestContext,
    idempotencyKey: string,
    input: CreateListingInput,
  ): Promise<ListingOwnerResponse> {
    await this.policies.require({
      action: activeUserPolicyActions.listingDraftCreate,
      context,
    });
    const actorUserId = authenticatedUserId(context);
    const now = new Date();
    const hash = requestHash(input);
    const retry = await this.store.findCreateRetry({
      actorUserId,
      idempotencyKey,
      requestHash: hash,
      now,
    });
    if (retry.kind === "conflict") throw new ListingIdempotencyConflictError();
    if (retry.kind === "exact_retry") return { data: toOwnerView(retry.listing) };
    const references = await this.store.resolveReferences({
      type: input.type,
      categoryId: input.categoryId,
      regionCode: input.regionCode,
    });
    if (!references) throw new ListingValidationError();
    await this.#validateAttributes(
      references.categoryId,
      references.formSchemaVersion,
      input.attributes,
    );

    const id = randomUUID();
    assertDomainDraft(id, input.type, input.price ?? null, now);
    const fields = buildWriteFields({
      patch: input,
      references,
      attributes: cloneAttributes(input.attributes),
      slug: `${input.type.toLowerCase()}-${id}`,
    });
    const result = await this.store.createDraft({
      ...fields,
      id,
      actorUserId,
      organizationId: input.organizationId ?? null,
      type: input.type,
      idempotencyKey,
      requestHash: hash,
      requestId: context.requestId,
      occurredAt: now,
    });
    if (result.kind === "created" || result.kind === "exact_retry") {
      return { data: toOwnerView(result.listing) };
    }
    if (result.kind === "idempotency_conflict") throw new ListingIdempotencyConflictError();
    if (result.kind === "invalid_media") {
      throw new ListingValidationError({
        mediaIds: ["must contain only owner-scoped READY listing images"],
      });
    }
    if (result.kind === "invalid_reference") throw new ListingValidationError();
    throw new ListingAccessDeniedError();
  }

  async get(context: PolicyRequestContext, listingId: string): Promise<ListingReadResult> {
    const now = new Date();
    if (context.actor.kind === "authenticated") {
      const ownerListing = await this.store.findByIdForOwner({
        actorUserId: context.actor.userId,
        listingId,
        now,
      });
      if (ownerListing) {
        await this.policies.require({
          action: listingObjectPolicyActions.draftRead,
          context,
          resource: {
            type: "listing",
            id: ownerListing.id,
            ownerUserId: ownerListing.organizationId ? null : ownerListing.ownerId,
            organizationId: ownerListing.organizationId,
            state: ownerListing.status,
            deleted: false,
          },
        });
        return {
          response: { data: toOwnerView(ownerListing) },
          privateView: true,
          version: ownerListing.version,
        };
      }
    }
    const publicListing = await this.store.findPublicById({ listingId, now });
    if (!publicListing) throw new ListingNotFoundError();
    return {
      response: { data: toPublicView(publicListing) },
      privateView: false,
      version: publicListing.version,
    };
  }

  async update(
    context: PolicyRequestContext,
    listingId: string,
    expectedVersion: number,
    input: UpdateListingInput,
  ): Promise<ListingOwnerResponse> {
    await this.policies.require({
      action: activeUserPolicyActions.listingDraftUpdate,
      context,
    });
    const actorUserId = authenticatedUserId(context);
    const now = new Date();
    const current = await this.store.findByIdForOwner({ actorUserId, listingId, now });
    if (!current) throw new ListingNotFoundError();
    await this.policies.require({
      action: listingObjectPolicyActions.draftWrite,
      context,
      resource: {
        type: "listing",
        id: current.id,
        ownerUserId: current.organizationId ? null : current.ownerId,
        organizationId: current.organizationId,
        state: current.status,
        deleted: false,
      },
    });
    if (current.version !== expectedVersion) {
      throw new ListingVersionConflictError(current.version);
    }
    if (current.status !== "DRAFT") throw new ListingStateConflictError();
    const categoryChanged =
      input.categoryId !== undefined && input.categoryId !== current.category.id;
    const references = await this.store.resolveReferences({
      type: current.type,
      categoryId: input.categoryId ?? current.category.id,
      regionCode: input.regionCode ?? current.region.code,
      ...(categoryChanged ? {} : { formSchemaVersion: current.formSchemaVersion }),
    });
    if (!references) throw new ListingValidationError();
    const attributes = cloneAttributes(input.attributes ?? current.attributes);
    await this.#validateAttributes(references.categoryId, references.formSchemaVersion, attributes);

    const currentMoney = toMoney(current.price);
    const nextMoney = input.price === undefined ? currentMoney : input.price;
    assertDomainDraft(current.id, current.type, nextMoney, now);
    const fields = buildWriteFields({
      current,
      patch: input,
      references,
      attributes,
      slug: current.slug,
    });
    const result = await this.store.updateDraft({
      ...fields,
      actorUserId,
      listingId,
      expectedVersion,
      requestId: context.requestId,
      occurredAt: now,
    });
    if (result.kind === "updated") {
      return { data: toOwnerView(result.listing) };
    }
    if (result.kind === "not_found") throw new ListingNotFoundError();
    if (result.kind === "invalid_media") {
      throw new ListingValidationError({
        mediaIds: ["must contain only owner-scoped READY listing images"],
      });
    }
    if (result.kind === "invalid_reference") throw new ListingValidationError();
    if (result.kind === "state_conflict") throw new ListingStateConflictError();
    if (result.kind === "time_conflict" || result.kind === "version_conflict") {
      throw new ListingVersionConflictError(result.currentVersion);
    }
    throw new ListingStateConflictError();
  }

  async #validateAttributes(
    categoryId: string,
    formSchemaVersion: number,
    attributes: Record<string, unknown>,
  ): Promise<void> {
    try {
      const validation = await this.taxonomy.validateAttributes(
        categoryId,
        formSchemaVersion,
        attributes,
      );
      if (!validation.valid) throw new ListingValidationError(validation.errors);
    } catch (error) {
      if (error instanceof CategoryFormSchemaNotFoundError) {
        throw new ListingValidationError();
      }
      throw error;
    }
  }
}
