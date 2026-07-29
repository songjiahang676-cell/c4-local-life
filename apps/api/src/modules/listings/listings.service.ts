import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type { ApiEnvironment } from "@socal/config";
import type {
  CreateListingInput,
  Category,
  ListingCollection,
  ListListingsQuery,
  ListingSubmissionResponse,
  ListingRevisionCollection,
  ListingRevisionView,
  ListListingRevisionsQuery,
  Region,
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
  type ListingRevisionCursor,
  type ListingRevisionDiffEntry,
  type ListingRevisionReasonCode,
  type ListingRevisionSnapshot,
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
  type: ListingType;
  categoryId: string | null;
  regionCode: string | null;
  limit: number;
};

type PublicListingCursorPayload = {
  version: 1;
  type: ListingType;
  categoryId: string | null;
  regionCode: string | null;
  publishedAt: string;
  id: string;
};

type ListingRevisionCursorPayload = {
  version: 1;
  listingId: string;
  createdAt: string;
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
    .update("socal-public-listing-page-cursor-v3\0", "utf8")
    .update(encoded, "utf8")
    .digest("base64url");
}

function revisionCursorSignature(secret: string, encoded: string): string {
  return createHmac("sha256", secret)
    .update("socal-listing-revision-cursor-v1\0", "utf8")
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

type ValidatedJobDetail = NonNullable<ListingDraftWriteFields["jobDetail"]>;
type ValidatedTransferDetail = NonNullable<ListingDraftWriteFields["transferDetail"]>;
type ValidatedSecondhandDetail = NonNullable<ListingDraftWriteFields["secondhandDetail"]>;
type ValidatedServiceDetail = NonNullable<ListingDraftWriteFields["serviceDetail"]>;
type ValidatedVerticalDetails = Pick<
  ListingDraftWriteFields,
  "jobDetail" | "secondhandDetail" | "serviceDetail" | "transferDetail"
>;

const jobWageUnits = ["HOURLY", "DAILY", "WEEKLY", "MONTHLY", "YEARLY"] as const;
const secondhandPriceUnits = ["FIXED", "NEGOTIABLE", "FREE"] as const;
const servicePriceUnits = ["HOURLY", "FIXED", "NEGOTIABLE"] as const;

function optionalAttributeString(
  attributes: Record<string, ListingDraftJsonValue>,
  key: string,
): string | null {
  const value = attributes[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function optionalAttributeBoolean(
  attributes: Record<string, ListingDraftJsonValue>,
  key: string,
): boolean | null {
  const value = attributes[key];
  return typeof value === "boolean" ? value : null;
}

function requiredAttributeNumber(
  attributes: Record<string, ListingDraftJsonValue>,
  key: string,
  errors: Record<string, string[]>,
): number | null {
  const value = attributes[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    errors[key] = ["is required"];
    return null;
  }
  return value;
}

function requiredAttributeStrings(
  attributes: Record<string, ListingDraftJsonValue>,
  key: string,
  errors: Record<string, string[]>,
): string[] | null {
  const value = attributes[key];
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    !value.every((item): item is string => typeof item === "string")
  ) {
    errors[key] = ["must contain at least one value"];
    return null;
  }
  return value;
}

function validatedJobDetail(
  type: ListingType,
  price: Money | null,
  attributes: Record<string, ListingDraftJsonValue>,
): ValidatedJobDetail | null {
  if (type !== "JOB") return null;
  const errors: Record<string, string[]> = {};
  const employerName = optionalAttributeString(attributes, "employerName");
  const employmentType = optionalAttributeString(attributes, "employmentType");
  const wageMax = optionalAttributeString(attributes, "wageMax");
  const wageUnit = price?.unit;
  if (!employerName) errors.employerName = ["is required"];
  if (!employmentType) errors.employmentType = ["is required"];
  if (
    !price?.amount ||
    !wageUnit ||
    !jobWageUnits.includes(wageUnit as (typeof jobWageUnits)[number])
  ) {
    errors.price = ["must include a positive Job wage and supported wage unit"];
  }
  if (!wageMax || !/^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/.test(wageMax)) {
    errors.wageMax = ["must be a valid wage amount"];
  }
  if (attributes.employmentPolicyAcknowledged !== true) {
    errors.employmentPolicyAcknowledged = ["must be acknowledged"];
  }
  if (
    Object.keys(errors).length > 0 ||
    !employerName ||
    !employmentType ||
    !price?.amount ||
    !wageMax ||
    !wageUnit
  ) {
    throw new ListingValidationError(errors);
  }
  if (toMinorAmount(price.amount) > toMinorAmount(wageMax)) {
    throw new ListingValidationError({
      wageMax: ["must be greater than or equal to wage minimum"],
    });
  }
  const visaSupport = attributes.visaSupport;
  return {
    employerName,
    employmentType,
    wageMin: normalizedAmount(price) ?? price.amount,
    wageMax: normalizedAmount({ ...price, amount: wageMax }) ?? wageMax,
    wageUnit,
    experienceLevel: optionalAttributeString(attributes, "experienceLevel"),
    remoteType: optionalAttributeString(attributes, "remoteType"),
    visaSupport: typeof visaSupport === "boolean" ? visaSupport : null,
  };
}

function validatedTransferDetail(
  type: ListingType,
  price: Money | null,
  attributes: Record<string, ListingDraftJsonValue>,
): ValidatedTransferDetail | null {
  if (type !== "TRANSFER") return null;
  const errors: Record<string, string[]> = {};
  const businessType = optionalAttributeString(attributes, "businessType");
  const monthlyRent = optionalAttributeString(attributes, "monthlyRent");
  const leaseRemainingMonths = requiredAttributeNumber(attributes, "leaseRemainingMonths", errors);
  const reasonForTransfer = optionalAttributeString(attributes, "reasonForTransfer");
  if (!businessType) errors.businessType = ["is required"];
  if (!price?.amount || price.unit !== "FIXED") {
    errors.price = ["must include a positive fixed asking price"];
  }
  if (!monthlyRent || !/^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/.test(monthlyRent)) {
    errors.monthlyRent = ["must be a valid monthly rent amount"];
  }
  if (
    leaseRemainingMonths !== null &&
    (!Number.isInteger(leaseRemainingMonths) ||
      leaseRemainingMonths < 0 ||
      leaseRemainingMonths > 1_200)
  ) {
    errors.leaseRemainingMonths = ["must be an integer from 0 through 1200"];
  }
  if (!reasonForTransfer) errors.reasonForTransfer = ["is required"];
  if (attributes.financialDisclaimerAcknowledged !== true) {
    errors.financialDisclaimerAcknowledged = ["must be acknowledged"];
  }
  if (
    Object.keys(errors).length > 0 ||
    !businessType ||
    !price?.amount ||
    !monthlyRent ||
    leaseRemainingMonths === null ||
    !reasonForTransfer
  ) {
    throw new ListingValidationError(errors);
  }
  return {
    businessType,
    askingPrice: normalizedAmount(price) ?? price.amount,
    monthlyRent:
      normalizedAmount({ amount: monthlyRent, currency: "USD", unit: "MONTHLY" }) ?? monthlyRent,
    leaseRemainingMonths,
    reasonForTransfer,
    includesInventory: optionalAttributeBoolean(attributes, "includesInventory"),
  };
}

function validatedSecondhandDetail(
  type: ListingType,
  price: Money | null,
  attributes: Record<string, ListingDraftJsonValue>,
): ValidatedSecondhandDetail | null {
  if (type !== "SECONDHAND") return null;
  const errors: Record<string, string[]> = {};
  const condition = optionalAttributeString(attributes, "condition");
  const deliveryOptions = requiredAttributeStrings(attributes, "deliveryOptions", errors);
  if (!condition) errors.condition = ["is required"];
  if (
    !price ||
    !secondhandPriceUnits.includes(price.unit as (typeof secondhandPriceUnits)[number])
  ) {
    errors.price = ["must use a fixed, negotiable, or free price"];
  }
  if (attributes.marketplacePolicyAcknowledged !== true) {
    errors.marketplacePolicyAcknowledged = ["must be acknowledged"];
  }
  if (Object.keys(errors).length > 0 || !condition || !deliveryOptions) {
    throw new ListingValidationError(errors);
  }
  return {
    condition,
    brand: optionalAttributeString(attributes, "brand"),
    model: optionalAttributeString(attributes, "model"),
    deliveryOptions,
  };
}

function validatedServiceDetail(
  type: ListingType,
  price: Money | null,
  attributes: Record<string, ListingDraftJsonValue>,
): ValidatedServiceDetail | null {
  if (type !== "SERVICE") return null;
  const errors: Record<string, string[]> = {};
  const serviceRadiusMiles = requiredAttributeNumber(attributes, "serviceRadiusMiles", errors);
  const availability = requiredAttributeStrings(attributes, "availability", errors);
  if (
    serviceRadiusMiles !== null &&
    (!Number.isInteger(serviceRadiusMiles) || serviceRadiusMiles < 1 || serviceRadiusMiles > 100)
  ) {
    errors.serviceRadiusMiles = ["must be an integer from 1 through 100"];
  }
  if (!price || !servicePriceUnits.includes(price.unit as (typeof servicePriceUnits)[number])) {
    errors.price = ["must use an hourly, fixed, or negotiable price"];
  }
  if (attributes.servicePolicyAcknowledged !== true) {
    errors.servicePolicyAcknowledged = ["must be acknowledged"];
  }
  if (Object.keys(errors).length > 0 || serviceRadiusMiles === null || !availability) {
    throw new ListingValidationError(errors);
  }
  return {
    serviceRadiusMiles,
    licenseNumber: optionalAttributeString(attributes, "licenseNumber"),
    insured: optionalAttributeBoolean(attributes, "insured"),
    emergencyService: optionalAttributeBoolean(attributes, "emergencyService"),
    availability,
  };
}

function validatedVerticalDetails(
  type: ListingType,
  price: Money | null,
  attributes: Record<string, ListingDraftJsonValue>,
): ValidatedVerticalDetails {
  return {
    jobDetail: validatedJobDetail(type, price, attributes),
    transferDetail: validatedTransferDetail(type, price, attributes),
    secondhandDetail: validatedSecondhandDetail(type, price, attributes),
    serviceDetail: validatedServiceDetail(type, price, attributes),
  };
}

function assertDomainDraft(
  id: string,
  type: ListingType,
  price: Money | null,
  details: ValidatedVerticalDetails,
  now: Date,
): void {
  try {
    const detail: ListingDetail =
      type === "JOB" && details.jobDetail
        ? {
            kind: "JOB",
            wageMinMinor: toMinorAmount(details.jobDetail.wageMin),
            wageMaxMinor: toMinorAmount(details.jobDetail.wageMax),
            wageUnit: details.jobDetail.wageUnit as
              "HOURLY" | "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY",
          }
        : type === "TRANSFER" && details.transferDetail
          ? {
              kind: "TRANSFER",
              askingPriceMinor: toMinorAmount(details.transferDetail.askingPrice),
              monthlyRentMinor: toMinorAmount(details.transferDetail.monthlyRent),
              leaseRemainingMonths: details.transferDetail.leaseRemainingMonths,
            }
          : type === "SECONDHAND" && details.secondhandDetail
            ? { kind: "SECONDHAND", condition: details.secondhandDetail.condition }
            : type === "SERVICE" && details.serviceDetail
              ? { kind: "SERVICE", serviceRadiusMiles: details.serviceDetail.serviceRadiusMiles }
              : emptyDetail(type);
    createDraftListing({
      id,
      type,
      detail,
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
  const { body: _body, createdAt: _createdAt, ...summary } = toPublicView(listing);
  void _body;
  void _createdAt;
  return { ...summary, type: listing.type };
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
    latestRevision: listing.latestRevision ? toRevisionView(listing.latestRevision) : null,
  };
}

function toRevisionView(
  revision: NonNullable<OwnerListingProjection["latestRevision"]>,
): ListingRevisionView {
  return {
    ...revision,
    diff: revision.diff,
    createdAt: revision.createdAt.toISOString(),
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
  details: ValidatedVerticalDetails;
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
    ...input.details,
  };
}

function revisionJsonEqual(left: unknown, right: unknown): boolean {
  return canonicalize(left) === canonicalize(right);
}

function withinEditDistance(left: string, right: string, maximum: number): boolean {
  if (Math.abs(left.length - right.length) > maximum) return false;
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = Array<number>(right.length + 1).fill(maximum + 1);
    current[0] = leftIndex;
    const start = Math.max(1, leftIndex - maximum);
    const end = Math.min(right.length, leftIndex + maximum);
    for (let rightIndex = start; rightIndex <= end; rightIndex += 1) {
      current[rightIndex] = Math.min(
        (previous[rightIndex] ?? maximum + 1) + 1,
        (current[rightIndex - 1] ?? maximum + 1) + 1,
        (previous[rightIndex - 1] ?? maximum + 1) +
          (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return (previous[right.length] ?? maximum + 1) <= maximum;
}

function normalizedRevisionText(value: string | null): string {
  return (value ?? "").normalize("NFKC").replace(/\s+/gu, " ").trim();
}

function minorTextChange(before: string | null, after: string | null, field: string): boolean {
  const left = normalizedRevisionText(before);
  const right = normalizedRevisionText(after);
  if (left === right) return true;
  const longest = Math.max(left.length, right.length);
  const maximum =
    field === "body"
      ? Math.min(20, Math.max(2, Math.ceil(longest * 0.02)))
      : field === "summary"
        ? Math.min(6, Math.max(2, Math.ceil(longest * 0.04)))
        : Math.min(3, Math.max(1, Math.ceil(longest * 0.04)));
  return withinEditDistance(left, right, maximum);
}

function safeRevisionAttributes(
  attributes: Record<string, ListingDraftJsonValue>,
): Record<string, ListingDraftJsonValue> {
  return Object.fromEntries(
    Object.entries(attributes).filter(
      ([key]) => !/(phone|email|contact|address|latitude|longitude)/iu.test(key),
    ),
  );
}

function changedAttributeKeys(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): string[] {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((key) => !revisionJsonEqual(before[key], after[key]))
    .sort();
}

function revisionDiff(
  before: ListingRevisionSnapshot,
  after: ListingRevisionSnapshot,
  changedRawAttributeKeys?: readonly string[],
): {
  diff: ListingRevisionDiffEntry[];
  materialReasons: ListingRevisionReasonCode[];
  changedTextFields: Array<"title" | "summary" | "body">;
} {
  const diff: ListingRevisionDiffEntry[] = [];
  const materialReasons: ListingRevisionReasonCode[] = [];
  const changedTextFields: Array<"title" | "summary" | "body"> = [];
  const add = (
    field: ListingRevisionDiffEntry["field"],
    beforeValue: ListingRevisionDiffEntry["before"],
    afterValue: ListingRevisionDiffEntry["after"],
  ): void => {
    if (revisionJsonEqual(beforeValue, afterValue)) return;
    diff.push({
      field,
      kind: beforeValue === null ? "ADDED" : afterValue === null ? "REMOVED" : "CHANGED",
      before: beforeValue,
      after: afterValue,
    });
  };
  add("locale", before.locale, after.locale);
  if (before.locale !== after.locale) materialReasons.push("LOCALE_CHANGED");
  for (const field of ["title", "summary", "body"] as const) {
    if (before[field] === after[field]) continue;
    changedTextFields.push(field);
    add(field, before[field], after[field]);
    if (!minorTextChange(before[field], after[field], field)) {
      materialReasons.push(
        field === "title"
          ? "TITLE_MATERIAL_CHANGE"
          : field === "summary"
            ? "SUMMARY_MATERIAL_CHANGE"
            : "BODY_MATERIAL_CHANGE",
      );
    }
  }
  add("price", before.price, after.price);
  if (!revisionJsonEqual(before.price, after.price)) materialReasons.push("PRICE_CHANGED");
  add("category", before.category, after.category);
  if (before.category.id !== after.category.id) materialReasons.push("CATEGORY_CHANGED");
  add("region", before.region, after.region);
  if (before.region.id !== after.region.id) materialReasons.push("REGION_CHANGED");
  add("location", before.location, after.location);
  if (!revisionJsonEqual(before.location, after.location)) {
    materialReasons.push("LOCATION_CHANGED");
  }
  add("contactMode", before.contactMode, after.contactMode);
  if (before.contactMode !== after.contactMode) materialReasons.push("CONTACT_MODE_CHANGED");
  const attributeKeys = [
    ...(changedRawAttributeKeys ?? changedAttributeKeys(before.attributes, after.attributes)),
  ];
  if (attributeKeys.length > 0) {
    diff.push({
      field: "attributes",
      kind: "CHANGED",
      before: { changedKeys: attributeKeys },
      after: { changedKeys: attributeKeys },
    });
    materialReasons.push("ATTRIBUTES_CHANGED");
  }
  if (!revisionJsonEqual(before.mediaIds, after.mediaIds)) {
    add("mediaIds", before.mediaIds, after.mediaIds);
    materialReasons.push("MEDIA_CHANGED");
  }
  return { diff, materialReasons, changedTextFields };
}

function findCategory(nodes: readonly Category[], id: string): Category | null {
  for (const node of nodes) {
    if (node.id === id) return node;
    const nested = findCategory(node.children ?? [], id);
    if (nested) return nested;
  }
  return null;
}

function findRegion(nodes: readonly Region[], id: string): Region | null {
  for (const node of nodes) {
    if (node.id === id) return node;
    const nested = findRegion(node.children ?? [], id);
    if (nested) return nested;
  }
  return null;
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
      type: normalized.type,
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

  async listRevisions(
    context: PolicyRequestContext,
    listingId: string,
    query: ListListingRevisionsQuery,
    now = new Date(),
  ): Promise<ListingRevisionCollection> {
    const actorUserId = authenticatedUserId(context);
    const listing = await this.store.findByIdForOwner({ actorUserId, listingId, now });
    if (!listing) throw new ListingNotFoundError();
    await this.policies.require({
      action: listingObjectPolicyActions.draftRead,
      context,
      resource: {
        type: "listing",
        id: listing.id,
        ownerUserId: listing.organizationId ? null : listing.ownerId,
        organizationId: listing.organizationId,
        state: listing.status,
        deleted: false,
      },
    });
    const cursor = query.cursor ? this.#decodeRevisionCursor(query.cursor, listingId) : undefined;
    const result = await this.store.listRevisions({
      actorUserId,
      listingId,
      ...(cursor ? { cursor } : {}),
      limit: query.limit ?? 20,
      now,
    });
    if (result.kind === "not_found") throw new ListingNotFoundError();
    return {
      data: result.items.map(toRevisionView),
      page: {
        hasMore: result.nextCursor !== null,
        nextCursor: result.nextCursor
          ? this.#encodeRevisionCursor(listingId, result.nextCursor)
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
    const attributes = cloneAttributes(input.attributes);
    const details = validatedVerticalDetails(input.type, input.price ?? null, attributes);
    assertDomainDraft(id, input.type, input.price ?? null, details, now);
    const fields = buildWriteFields({
      patch: input,
      references,
      attributes,
      details,
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
    idempotencyKey?: string,
  ): Promise<ListingOwnerResponse> {
    await this.policies.require({
      action: activeUserPolicyActions.listingDraftUpdate,
      context,
    });
    const actorUserId = authenticatedUserId(context);
    const now = new Date();
    const hash = requestHash({ listingId, expectedVersion, input });
    if (idempotencyKey) {
      const retry = await this.store.findPublishedRevisionRetry({
        actorUserId,
        idempotencyKey,
        requestHash: hash,
        now,
      });
      if (retry.kind === "conflict") throw new ListingIdempotencyConflictError();
      if (retry.kind === "exact_retry") return { data: toOwnerView(retry.listing) };
    }
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
    if (current.status !== "DRAFT" && current.status !== "PUBLISHED") {
      throw new ListingStateConflictError();
    }
    if (current.status === "PUBLISHED" && !idempotencyKey) {
      throw new ListingValidationError({
        idempotencyKey: ["is required for published edits"],
      });
    }
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
    const details = validatedVerticalDetails(current.type, nextMoney, attributes);
    assertDomainDraft(current.id, current.type, nextMoney, details, now);
    const fields = buildWriteFields({
      current,
      patch: input,
      references,
      attributes,
      details,
      slug: current.slug,
    });
    if (current.status === "PUBLISHED") {
      const candidate = await this.store.findSubmissionCandidate({ actorUserId, listingId });
      if (!candidate) throw new ListingNotFoundError();
      const form = await this.taxonomy.getPublishedFormSchema(references.categoryId, {
        version: references.formSchemaVersion,
      });
      const categories = await this.taxonomy.listCategories({
        activeOnly: true,
        vertical: current.type,
      });
      const regions = await this.taxonomy.listRegions({ activeOnly: true });
      const category = findCategory(categories.data, references.categoryId);
      const region = findRegion(regions.data, references.regionId);
      if (!category || !region) throw new ListingValidationError();
      const defaultLifetimeDays = form.definition.publicationPolicy?.defaultLifetimeDays ?? 30;
      const before: ListingRevisionSnapshot = {
        locale: current.locale as "zh-Hans" | "en-US",
        title: current.title,
        summary: current.summary,
        body: current.body,
        price: current.price
          ? {
              amount: current.price.amount,
              currency: "USD",
              unit: current.price.unit ?? "FIXED",
            }
          : null,
        category: {
          id: current.category.id,
          code: current.category.slug,
          nameZhHans: current.category.nameZhHans,
          nameEn: current.category.nameEn,
        },
        region: {
          id: current.region.id,
          code: current.region.code,
          nameZhHans: current.region.nameZhHans,
          nameEn: current.region.nameEn,
        },
        location: { precision: locationPrecision(current.location.precision) },
        contactMode: current.contactMode,
        attributes: safeRevisionAttributes(cloneAttributes(current.attributes)),
        mediaIds: [...current.mediaIds],
        formSchemaVersion: current.formSchemaVersion,
        defaultLifetimeDays,
      };
      const after: ListingRevisionSnapshot = {
        locale: fields.locale as "zh-Hans" | "en-US",
        title: fields.title,
        summary: fields.summary,
        body: fields.body,
        price: fields.priceUnit
          ? {
              amount: fields.priceAmount,
              currency: "USD",
              unit: fields.priceUnit,
            }
          : null,
        category: {
          id: category.id,
          code: category.slug,
          nameZhHans: category.name["zh-Hans"],
          nameEn: category.name["en-US"],
        },
        region: {
          id: region.id,
          code: region.code,
          nameZhHans: region.name["zh-Hans"],
          nameEn: region.name["en-US"],
        },
        location: { precision: locationPrecision(fields.locationPrecision) },
        contactMode: fields.contactMode,
        attributes: safeRevisionAttributes(fields.attributes),
        mediaIds: [...fields.mediaIds],
        formSchemaVersion: references.formSchemaVersion,
        defaultLifetimeDays,
      };
      const changes = revisionDiff(
        before,
        after,
        changedAttributeKeys(cloneAttributes(current.attributes), fields.attributes),
      );
      if (changes.diff.length === 0) {
        throw new ListingValidationError({ body: ["patch does not change the Listing"] });
      }
      const risk = evaluateListingSubmissionRisk({
        listingType: current.type,
        title: fields.title,
        summary: fields.summary,
        body: fields.body,
        accountCreatedAt: candidate.actorCreatedAt,
        occurredAt: now,
        publicationPolicy: form.definition.publicationPolicy ?? {},
      });
      const riskReasons: ListingRevisionReasonCode[] =
        risk.riskTier === "LOW" ? [] : ["MODERATION_RISK_SIGNAL"];
      const major = changes.materialReasons.length > 0 || riskReasons.length > 0;
      const reasonCodes: ListingRevisionReasonCode[] = major
        ? [...new Set([...changes.materialReasons, ...riskReasons])]
        : ["MINOR_TEXT_EDIT"];
      const result = await this.store.revisePublished({
        ...fields,
        actorUserId,
        listingId,
        expectedVersion,
        idempotencyKey: idempotencyKey as string,
        requestHash: hash,
        requestId: context.requestId,
        occurredAt: now,
        classification: major ? "MAJOR_EDIT" : "MINOR_EDIT",
        reasonCodes,
        snapshot: after,
        diff: changes.diff,
        inputHash: requestHash({
          listingId,
          expectedVersion,
          snapshot: after,
          formSchema: form.definition,
        }),
        ruleSetKey: risk.ruleSetKey,
        ruleSetVersion: risk.ruleSetVersion,
        riskTier: risk.riskTier,
        hits: risk.hits,
      });
      if (result.kind === "revised" || result.kind === "exact_retry") {
        return { data: toOwnerView(result.listing) };
      }
      if (result.kind === "idempotency_conflict") {
        throw new ListingIdempotencyConflictError();
      }
      if (result.kind === "not_found") throw new ListingNotFoundError();
      if (result.kind === "invalid_media") {
        throw new ListingValidationError({
          mediaIds: ["must contain only owner-scoped READY listing images"],
        });
      }
      if (result.kind === "invalid_reference") throw new ListingValidationError();
      if (result.kind === "version_conflict" || result.kind === "time_conflict") {
        throw new ListingVersionConflictError(result.currentVersion);
      }
      throw new ListingStateConflictError();
    }
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
    if (
      candidate.status !== "DRAFT" ||
      (candidate.moderationStatus !== "NOT_REVIEWED" && candidate.moderationStatus !== "REJECTED")
    ) {
      throw new ListingStateConflictError();
    }

    const parsedForm = categoryFormSchemaSchema.safeParse(candidate.formSchemaDefinition);
    if (!parsedForm.success) throw new ListingValidationError();
    const occurredAt = new Date();
    const risk = evaluateListingSubmissionRisk({
      listingType: candidate.type,
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
      listingType: candidate.type,
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

  #encodeRevisionCursor(listingId: string, cursor: ListingRevisionCursor): string {
    const payload: ListingRevisionCursorPayload = {
      version: 1,
      listingId,
      createdAt: cursor.createdAt.toISOString(),
      id: cursor.id,
    };
    const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
    return `${encoded}.${revisionCursorSignature(this.#cursorSecret, encoded)}`;
  }

  #decodeRevisionCursor(value: string, listingId: string): ListingRevisionCursor {
    const [encoded, signature, extra] = value.split(".");
    if (!encoded || !signature || extra || encoded.length > 1_024) {
      throw new ListingCursorError();
    }
    const expected = revisionCursorSignature(this.#cursorSecret, encoded);
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
    const candidate = payload as Partial<ListingRevisionCursorPayload>;
    if (
      candidate.version !== 1 ||
      candidate.listingId !== listingId ||
      typeof candidate.createdAt !== "string" ||
      typeof candidate.id !== "string" ||
      !uuidPattern.test(candidate.id)
    ) {
      throw new ListingCursorError();
    }
    const createdAt = new Date(candidate.createdAt);
    if (!Number.isFinite(createdAt.getTime()) || createdAt.toISOString() !== candidate.createdAt) {
      throw new ListingCursorError();
    }
    return { createdAt, id: candidate.id };
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
