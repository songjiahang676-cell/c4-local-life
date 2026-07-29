import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type { ApiEnvironment } from "@socal/config";
import type {
  CreateListingInput,
  ListingCollection,
  ListListingsQuery,
  ListingSubmissionResponse,
  ListingOwnerResponse,
  ListingOwnerView,
  ListingResponse,
  Money,
  PublicListingSummaryView,
  PublicListingView,
  UpdateListingInput,
} from "@socal/contracts";
import { API_ENVIRONMENT } from "../../common/api-environment.token";
import { categoryFormSchemaSchema } from "@socal/contracts";
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
  transitionListing,
  type ListingAggregate,
  type ListingDetail,
  type ListingPrice,
  type ListingType,
} from "./listing-domain";
import { evaluateListingSubmissionRisk } from "./moderation-risk";
import {
  LISTING_STORE,
  type ListingDraftJsonValue,
  type ListingDraftWriteFields,
  type ListingSubmissionProjection,
  type ListingSubmissionTransitionEvidence,
  type ListingStore,
  type OwnerListingProjection,
  type PublicListingCursor,
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
  constructor(message = "Listing state transition is not allowed") {
    super(message);
    this.name = "ListingStateConflictError";
  }
}

export class ListingValidationError extends Error {
  constructor(readonly errors?: Record<string, string[]>) {
    super("Listing validation failed");
    this.name = "ListingValidationError";
  }
}

export class ListingCursorError extends Error {
  constructor() {
    super("Listing cursor is invalid");
    this.name = "ListingCursorError";
  }
}

export type ListingReadResult = {
  response: ListingResponse;
  privateView: boolean;
  version: number;
};

type NormalizedPublicListingQuery = {
  type: "RENTAL";
  categoryId: string | null;
  regionCode: string | null;
  limit: number;
};

type PublicListingCursorPayload = {
  version: 1;
  type: "RENTAL";
  categoryId: string | null;
  regionCode: string | null;
  publishedAt: string;
  id: string;
};

const locationPrecisions = ["CITY", "NEIGHBORHOOD", "APPROXIMATE", "EXACT"] as const;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

function cursorSignature(secret: string, encoded: string): string {
  return createHmac("sha256", secret)
    .update("socal-public-rental-page-cursor-v1\0", "utf8")
    .update(encoded, "utf8")
    .digest("base64url");
}

function signaturesMatch(expected: string, provided: string): boolean {
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(provided);
  return (
    expectedBuffer.length === providedBuffer.length &&
    timingSafeEqual(expectedBuffer, providedBuffer)
  );
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

function candidatePrice(input: {
  priceAmount: string | null;
  priceUnit: ListingPrice["unit"] | null;
}): ListingPrice | null {
  if (input.priceAmount === null && input.priceUnit === null) return null;
  if (input.priceUnit === null) throw new ListingValidationError();
  return {
    amountMinor: input.priceAmount === null ? null : toMinorAmount(input.priceAmount),
    currency: "USD",
    unit: input.priceUnit,
  };
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

function toPublicSummary(listing: PublicListingProjection): PublicListingSummaryView {
  if (listing.type !== "RENTAL") {
    throw new Error("Public Listing collection currently supports Rental only");
  }
  const { body: _body, createdAt: _createdAt, ...summary } = toPublicView(listing);
  void _body;
  void _createdAt;
  return { ...summary, type: "RENTAL" };
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
  readonly #cursorSecret: string;

  constructor(
    @Inject(API_ENVIRONMENT) environment: ApiEnvironment,
    @Inject(LISTING_STORE) private readonly store: ListingStore,
    private readonly taxonomy: TaxonomyService,
    private readonly policies: PolicyService,
  ) {
    this.#cursorSecret = environment.SESSION_SECRET.reveal();
  }

  async list(query: ListListingsQuery, now = new Date()): Promise<ListingCollection> {
    const normalized = {
      type: query.type ?? "RENTAL",
      categoryId: query.categoryId ?? null,
      regionCode: query.regionCode ?? null,
      limit: query.limit ?? 20,
    } as const;
    const cursor = query.cursor ? this.#decodePublicCursor(query.cursor, normalized) : undefined;
    const result = await this.store.listPublic({
      type: "RENTAL",
      ...(normalized.categoryId ? { categoryId: normalized.categoryId } : {}),
      ...(normalized.regionCode ? { regionCode: normalized.regionCode } : {}),
      ...(cursor ? { cursor } : {}),
      limit: normalized.limit,
      now,
    });
    return {
      data: result.items.map(toPublicSummary),
      page: {
        hasMore: result.nextCursor !== null,
        nextCursor: result.nextCursor
          ? this.#encodePublicCursor(normalized, result.nextCursor)
          : null,
      },
      generatedAt: now.toISOString(),
    };
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

  async archive(
    context: PolicyRequestContext,
    listingId: string,
    expectedVersion: number,
  ): Promise<ListingOwnerResponse> {
    const transition = await this.#ownerLifecycleTransition(
      context,
      listingId,
      expectedVersion,
      "ARCHIVE",
    );
    if (transition.kind !== "transitioned") throw new ListingStateConflictError();
    return {
      data: toOwnerView({
        ...transition.current,
        status: "ARCHIVED",
        updatedAt: transition.occurredAt,
        version: transition.version,
      }),
    };
  }

  async delete(
    context: PolicyRequestContext,
    listingId: string,
    expectedVersion: number,
  ): Promise<void> {
    await this.#ownerLifecycleTransition(context, listingId, expectedVersion, "DELETE");
  }

  async submit(
    context: PolicyRequestContext,
    listingId: string,
    expectedVersion: number,
    idempotencyKey: string,
  ): Promise<ListingSubmissionResponse> {
    await this.policies.require({
      action: activeUserPolicyActions.listingSubmit,
      context,
    });
    const actorUserId = authenticatedUserId(context);
    const hash = requestHash({ listingId, expectedVersion });
    const retry = await this.store.findSubmissionRetry({
      actorUserId,
      idempotencyKey,
      requestHash: hash,
    });
    if (retry.kind === "conflict") throw new ListingIdempotencyConflictError();
    if (retry.kind === "exact_retry") {
      return { data: this.#submissionResponse(retry.submission) };
    }

    const candidate = await this.store.findSubmissionCandidate({ actorUserId, listingId });
    if (!candidate) throw new ListingNotFoundError();
    await this.policies.require({
      action: listingObjectPolicyActions.submit,
      context,
      resource: {
        type: "listing",
        id: candidate.id,
        ownerUserId: candidate.organizationId ? null : candidate.ownerId,
        organizationId: candidate.organizationId,
        state: candidate.status,
        deleted: false,
      },
    });
    if (candidate.version !== expectedVersion) {
      throw new ListingVersionConflictError(candidate.version);
    }
    if (candidate.status !== "DRAFT" || candidate.moderationStatus !== "NOT_REVIEWED") {
      throw new ListingStateConflictError();
    }

    const parsedForm = categoryFormSchemaSchema.safeParse(candidate.formSchemaDefinition);
    if (!parsedForm.success) throw new ListingValidationError();
    const occurredAt = new Date();
    const risk = evaluateListingSubmissionRisk({
      title: candidate.title,
      summary: candidate.summary,
      body: candidate.body,
      accountCreatedAt: candidate.actorCreatedAt,
      occurredAt,
      publicationPolicy: parsedForm.data.publicationPolicy ?? {},
    });
    const aggregate: ListingAggregate = {
      id: candidate.id,
      type: candidate.type,
      status: candidate.status,
      moderationStatus: candidate.moderationStatus,
      detail: emptyDetail(candidate.type),
      price: candidatePrice(candidate),
      publishedAt: candidate.publishedAt,
      expiresAt: candidate.expiresAt,
      deletedAt: null,
      createdAt: candidate.createdAt,
      updatedAt: candidate.updatedAt,
      version: candidate.version,
    };

    let submitted;
    try {
      submitted = transitionListing(aggregate, {
        kind: "SUBMIT",
        actorId: actorUserId,
        expectedVersion,
        occurredAt,
        reasonCode: "RISK_EVALUATED",
      });
    } catch (error) {
      if (error instanceof ListingDomainError) throw new ListingStateConflictError();
      throw error;
    }
    const transitions: ListingSubmissionTransitionEvidence[] = [
      {
        eventType: "listing.submitted" as const,
        ...submitted.event,
        aggregateVersion: submitted.event.currentVersion,
      },
    ];
    let finalListing = submitted.listing;
    if (risk.riskTier === "LOW") {
      if (!risk.defaultLifetimeDays) throw new ListingValidationError();
      const approved = transitionListing(finalListing, {
        kind: "AUTO_APPROVE",
        actorId: actorUserId,
        expectedVersion: finalListing.version,
        occurredAt,
        reasonCode: "LOW_RISK_AUTO_APPROVED",
        lifetimeDays: risk.defaultLifetimeDays,
      });
      finalListing = approved.listing;
      transitions.push({
        eventType: "listing.published",
        ...approved.event,
        aggregateVersion: approved.event.currentVersion,
      });
    } else if (risk.riskTier === "HIGH") {
      const escalated = transitionListing(finalListing, {
        kind: "ESCALATE",
        actorId: actorUserId,
        expectedVersion: finalListing.version,
        occurredAt,
        reasonCode: "HIGH_RISK_ESCALATED",
      });
      finalListing = escalated.listing;
      transitions.push({
        eventType: "listing.moderation.escalated",
        ...escalated.event,
        aggregateVersion: escalated.event.currentVersion,
      });
    }
    const inputHash = requestHash({
      listingId: candidate.id,
      listingVersion: candidate.version,
      title: candidate.title,
      summary: candidate.summary,
      body: candidate.body,
      actorCreatedAt: candidate.actorCreatedAt.toISOString(),
      formSchema: parsedForm.data,
    });
    const result = await this.store.submit({
      actorUserId,
      listingId,
      expectedVersion,
      idempotencyKey,
      requestHash: hash,
      requestId: context.requestId,
      occurredAt,
      inputHash,
      ruleSetKey: risk.ruleSetKey,
      ruleSetVersion: risk.ruleSetVersion,
      riskTier: risk.riskTier,
      hits: risk.hits,
      decision: {
        contentStatus: finalListing.status,
        moderationStatus: finalListing.moderationStatus,
        publishedAt: finalListing.publishedAt,
        expiresAt: finalListing.expiresAt,
        resultVersion: finalListing.version,
        transitions,
      },
    });
    if (result.kind === "submitted" || result.kind === "exact_retry") {
      return { data: this.#submissionResponse(result.submission) };
    }
    if (result.kind === "idempotency_conflict") throw new ListingIdempotencyConflictError();
    if (result.kind === "version_conflict" || result.kind === "time_conflict") {
      throw new ListingVersionConflictError(result.currentVersion);
    }
    if (result.kind === "state_conflict") throw new ListingStateConflictError();
    throw new ListingNotFoundError();
  }

  async #ownerLifecycleTransition(
    context: PolicyRequestContext,
    listingId: string,
    expectedVersion: number,
    kind: "ARCHIVE" | "DELETE",
  ): Promise<
    | {
        kind: "transitioned";
        current: OwnerListingProjection;
        occurredAt: Date;
        version: number;
      }
    | { kind: "already_deleted" }
  > {
    await this.policies.require({
      action:
        kind === "ARCHIVE"
          ? activeUserPolicyActions.listingArchive
          : activeUserPolicyActions.listingDelete,
      context,
    });
    const actorUserId = authenticatedUserId(context);
    const occurredAt = new Date();
    const current = await this.store.findByIdForOwner({
      actorUserId,
      listingId,
      now: occurredAt,
    });
    if (!current) {
      if (kind === "DELETE") {
        const retry = await this.store.transitionOwner({
          actorUserId,
          listingId,
          expectedVersion,
          kind,
          requestId: context.requestId,
          occurredAt,
        });
        if (retry.kind === "already_deleted") return retry;
      }
      throw new ListingNotFoundError();
    }
    await this.policies.require({
      action: listingObjectPolicyActions.lifecycleWrite,
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
    if (kind === "ARCHIVE" && current.status === "ARCHIVED") {
      if (expectedVersion !== current.version && expectedVersion !== current.version - 1) {
        throw new ListingVersionConflictError(current.version);
      }
      return {
        kind: "transitioned",
        current,
        occurredAt: current.updatedAt,
        version: current.version,
      };
    }
    if (current.version !== expectedVersion) {
      throw new ListingVersionConflictError(current.version);
    }

    const aggregate: ListingAggregate = {
      id: current.id,
      type: current.type,
      status: current.status,
      moderationStatus: current.moderationStatus,
      detail: emptyDetail(current.type),
      price: toDomainPrice(toMoney(current.price)),
      publishedAt: current.publishedAt,
      expiresAt: current.expiresAt,
      deletedAt: null,
      createdAt: current.createdAt,
      updatedAt: current.updatedAt,
      version: current.version,
    };
    try {
      transitionListing(
        aggregate,
        kind === "ARCHIVE"
          ? {
              kind,
              actorId: actorUserId,
              expectedVersion,
              occurredAt,
              reasonCode: "OWNER_ARCHIVED",
            }
          : {
              kind,
              actorId: actorUserId,
              expectedVersion,
              occurredAt,
              reasonCode: "OWNER_DELETED",
            },
      );
    } catch (error) {
      if (error instanceof ListingDomainError) {
        if (error.code === "VERSION_CONFLICT") {
          throw new ListingVersionConflictError(current.version);
        }
        throw new ListingStateConflictError();
      }
      throw error;
    }

    const result = await this.store.transitionOwner({
      actorUserId,
      listingId,
      expectedVersion,
      kind,
      requestId: context.requestId,
      occurredAt,
    });
    if (result.kind === "transitioned") {
      return { kind: "transitioned", current, occurredAt, version: result.version };
    }
    if (result.kind === "already_archived") {
      return {
        kind: "transitioned",
        current,
        occurredAt,
        version: result.version,
      };
    }
    if (result.kind === "already_deleted") return result;
    if (result.kind === "version_conflict" || result.kind === "time_conflict") {
      throw new ListingVersionConflictError(result.currentVersion);
    }
    if (result.kind === "state_conflict") throw new ListingStateConflictError();
    if (result.kind === "actor_unavailable") throw new ListingAccessDeniedError();
    throw new ListingNotFoundError();
  }

  #encodePublicCursor(query: NormalizedPublicListingQuery, cursor: PublicListingCursor): string {
    const payload: PublicListingCursorPayload = {
      version: 1,
      type: query.type,
      categoryId: query.categoryId,
      regionCode: query.regionCode,
      publishedAt: cursor.publishedAt.toISOString(),
      id: cursor.id,
    };
    const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
    return `${encoded}.${cursorSignature(this.#cursorSecret, encoded)}`;
  }

  #decodePublicCursor(value: string, query: NormalizedPublicListingQuery): PublicListingCursor {
    const [encoded, signature, extra] = value.split(".");
    if (!encoded || !signature || extra || encoded.length > 1_024) {
      throw new ListingCursorError();
    }
    const expected = cursorSignature(this.#cursorSecret, encoded);
    if (!signaturesMatch(expected, signature)) throw new ListingCursorError();
    let payload: unknown;
    try {
      payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    } catch {
      throw new ListingCursorError();
    }
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new ListingCursorError();
    }
    const candidate = payload as Partial<PublicListingCursorPayload>;
    if (
      candidate.version !== 1 ||
      candidate.type !== query.type ||
      candidate.categoryId !== query.categoryId ||
      candidate.regionCode !== query.regionCode ||
      typeof candidate.publishedAt !== "string" ||
      typeof candidate.id !== "string" ||
      !uuidPattern.test(candidate.id)
    ) {
      throw new ListingCursorError();
    }
    const publishedAt = new Date(candidate.publishedAt);
    if (
      !Number.isFinite(publishedAt.getTime()) ||
      publishedAt.toISOString() !== candidate.publishedAt
    ) {
      throw new ListingCursorError();
    }
    return { publishedAt, id: candidate.id };
  }

  #submissionResponse(input: ListingSubmissionProjection): ListingSubmissionResponse["data"] {
    return {
      ...input,
      occurredAt: input.occurredAt.toISOString(),
    };
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
