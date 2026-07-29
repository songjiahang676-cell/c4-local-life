export const listingTypes = ["JOB", "RENTAL", "TRANSFER", "SECONDHAND", "SERVICE"] as const;
export type ListingType = (typeof listingTypes)[number];

export const contentStatuses = [
  "DRAFT",
  "SUBMITTED",
  "PUBLISHED",
  "EXPIRED",
  "ARCHIVED",
  "SUSPENDED",
  "DELETED",
] as const;
export type ContentStatus = (typeof contentStatuses)[number];

export const moderationStatuses = [
  "NOT_REVIEWED",
  "AUTO_APPROVED",
  "PENDING_REVIEW",
  "APPROVED",
  "REJECTED",
  "ESCALATED",
] as const;
export type ModerationStatus = (typeof moderationStatuses)[number];

export const priceUnits = [
  "FIXED",
  "HOURLY",
  "DAILY",
  "WEEKLY",
  "MONTHLY",
  "YEARLY",
  "SQFT",
  "NEGOTIABLE",
  "FREE",
] as const;
export type PriceUnit = (typeof priceUnits)[number];

export type ListingPrice = {
  amountMinor: bigint | null;
  currency: "USD";
  unit: PriceUnit;
};

export type JobDetail = {
  kind: "JOB";
  wageMinMinor?: bigint | null;
  wageMaxMinor?: bigint | null;
  wageUnit?: "HOURLY" | "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY" | null;
};

export type RentalDetail = {
  kind: "RENTAL";
  bedrooms?: number | null;
  bathrooms?: number | null;
  depositMinor?: bigint | null;
};

export type TransferDetail = {
  kind: "TRANSFER";
  askingPriceMinor?: bigint | null;
  monthlyRentMinor?: bigint | null;
  leaseRemainingMonths?: number | null;
};

export type SecondhandDetail = {
  kind: "SECONDHAND";
  condition?: string | null;
};

export type ServiceDetail = {
  kind: "SERVICE";
  serviceRadiusMiles?: number | null;
};

export type ListingDetail =
  JobDetail | RentalDetail | TransferDetail | SecondhandDetail | ServiceDetail;

export type ListingAggregate = {
  id: string;
  type: ListingType;
  status: ContentStatus;
  moderationStatus: ModerationStatus;
  detail: ListingDetail;
  price: ListingPrice | null;
  publishedAt: Date | null;
  expiresAt: Date | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  version: number;
};

export type CreateDraftListingInput = {
  id: string;
  type: ListingType;
  detail: ListingDetail;
  price: ListingPrice | null;
  createdAt: Date;
};

type TransitionMetadata = {
  actorId: string;
  expectedVersion: number;
  occurredAt: Date;
  reasonCode: string;
};

export type ListingTransitionCommand =
  | (TransitionMetadata & { kind: "SUBMIT" })
  | (TransitionMetadata & { kind: "AUTO_APPROVE"; lifetimeDays: number })
  | (TransitionMetadata & { kind: "MODERATOR_APPROVE"; lifetimeDays: number })
  | (TransitionMetadata & { kind: "ESCALATE" })
  | (TransitionMetadata & { kind: "REJECT_TO_DRAFT" })
  | (TransitionMetadata & { kind: "SUSPEND" })
  | (TransitionMetadata & { kind: "RESTORE" })
  | (TransitionMetadata & { kind: "EXPIRE" })
  | (TransitionMetadata & { kind: "ARCHIVE" })
  | (TransitionMetadata & { kind: "DELETE" });

export type ListingTransitionEvent = {
  actorId: string;
  reasonCode: string;
  occurredAt: Date;
  previousStatus: ContentStatus;
  currentStatus: ContentStatus;
  previousModerationStatus: ModerationStatus;
  currentModerationStatus: ModerationStatus;
  previousVersion: number;
  currentVersion: number;
};

export type ListingTransitionResult = {
  listing: ListingAggregate;
  event: ListingTransitionEvent;
};

export type ListingDomainErrorCode =
  | "DETAIL_TYPE_MISMATCH"
  | "INVALID_DETAIL"
  | "INVALID_EXPIRY"
  | "INVALID_IDENTIFIER"
  | "INVALID_MODERATION_STATE"
  | "INVALID_PRICE"
  | "INVALID_STATE_TRANSITION"
  | "INVALID_TRANSITION_METADATA"
  | "VERSION_CONFLICT";

export class ListingDomainError extends Error {
  constructor(readonly code: ListingDomainErrorCode) {
    super("Listing domain invariant rejected the operation");
    this.name = "ListingDomainError";
  }
}

const maximumMoneyMinor = 99_999_999_999_999n;
const reasonCodePattern = /^[A-Z][A-Z0-9_]{2,63}$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const jobWageUnits = ["HOURLY", "DAILY", "WEEKLY", "MONTHLY", "YEARLY"] as const;

function fail(code: ListingDomainErrorCode): never {
  throw new ListingDomainError(code);
}

function isFiniteDate(value: Date): boolean {
  return Number.isFinite(value.getTime());
}

function assertMinorAmount(value: bigint | null | undefined, code: ListingDomainErrorCode): void {
  if (value === null || value === undefined) return;
  if (value < 0n || value > maximumMoneyMinor) fail(code);
}

function assertBoundedNumber(
  value: number | null | undefined,
  minimum: number,
  maximum: number,
): void {
  if (value === null || value === undefined) return;
  if (!Number.isFinite(value) || value < minimum || value > maximum) fail("INVALID_DETAIL");
}

function assertInteger(value: number | null | undefined, minimum: number, maximum: number): void {
  if (value === null || value === undefined) return;
  if (!Number.isInteger(value) || value < minimum || value > maximum) fail("INVALID_DETAIL");
}

function assertDetail(detail: ListingDetail, type: ListingType): void {
  if (!listingTypes.includes(type) || !listingTypes.includes(detail.kind)) {
    fail("INVALID_DETAIL");
  }
  if (detail.kind !== type) fail("DETAIL_TYPE_MISMATCH");

  switch (detail.kind) {
    case "JOB": {
      assertMinorAmount(detail.wageMinMinor, "INVALID_DETAIL");
      assertMinorAmount(detail.wageMaxMinor, "INVALID_DETAIL");
      if (
        detail.wageMinMinor !== null &&
        detail.wageMinMinor !== undefined &&
        detail.wageMaxMinor !== null &&
        detail.wageMaxMinor !== undefined &&
        detail.wageMinMinor > detail.wageMaxMinor
      ) {
        fail("INVALID_DETAIL");
      }
      if (
        detail.wageUnit !== null &&
        detail.wageUnit !== undefined &&
        !jobWageUnits.includes(detail.wageUnit)
      ) {
        fail("INVALID_DETAIL");
      }
      return;
    }
    case "RENTAL":
      assertBoundedNumber(detail.bedrooms, 0, 100);
      assertBoundedNumber(detail.bathrooms, 0, 100);
      assertMinorAmount(detail.depositMinor, "INVALID_DETAIL");
      return;
    case "TRANSFER":
      assertMinorAmount(detail.askingPriceMinor, "INVALID_DETAIL");
      assertMinorAmount(detail.monthlyRentMinor, "INVALID_DETAIL");
      assertInteger(detail.leaseRemainingMonths, 0, 1_200);
      return;
    case "SECONDHAND":
      if (
        detail.condition !== null &&
        detail.condition !== undefined &&
        (detail.condition.trim().length === 0 || detail.condition.length > 40)
      ) {
        fail("INVALID_DETAIL");
      }
      return;
    case "SERVICE":
      assertInteger(detail.serviceRadiusMiles, 0, 250);
  }
}

function assertPrice(price: ListingPrice | null): void {
  if (!price) return;
  if (price.currency !== "USD" || !priceUnits.includes(price.unit)) fail("INVALID_PRICE");
  if (price.unit === "FREE" || price.unit === "NEGOTIABLE") {
    if (price.amountMinor !== null) fail("INVALID_PRICE");
    return;
  }
  if (
    price.amountMinor === null ||
    price.amountMinor <= 0n ||
    price.amountMinor > maximumMoneyMinor
  ) {
    fail("INVALID_PRICE");
  }
}

function assertModerationState(listing: ListingAggregate): void {
  if (
    !contentStatuses.includes(listing.status) ||
    !moderationStatuses.includes(listing.moderationStatus)
  ) {
    fail("INVALID_MODERATION_STATE");
  }
  const valid =
    (listing.status === "DRAFT" &&
      (listing.moderationStatus === "NOT_REVIEWED" || listing.moderationStatus === "REJECTED")) ||
    (listing.status === "SUBMITTED" &&
      (listing.moderationStatus === "PENDING_REVIEW" ||
        listing.moderationStatus === "ESCALATED")) ||
    (["PUBLISHED", "EXPIRED", "ARCHIVED"].includes(listing.status) &&
      (listing.moderationStatus === "AUTO_APPROVED" || listing.moderationStatus === "APPROVED")) ||
    (listing.status === "SUSPENDED" && listing.moderationStatus === "REJECTED") ||
    listing.status === "DELETED";
  if (!valid) fail("INVALID_MODERATION_STATE");
}

function assertLifecycleTimestamps(listing: ListingAggregate): void {
  if (
    !isFiniteDate(listing.createdAt) ||
    !isFiniteDate(listing.updatedAt) ||
    listing.updatedAt < listing.createdAt
  ) {
    fail("INVALID_EXPIRY");
  }
  if (listing.status === "DELETED") {
    if (!listing.deletedAt || !isFiniteDate(listing.deletedAt)) fail("INVALID_EXPIRY");
  } else if (listing.deletedAt !== null) {
    fail("INVALID_EXPIRY");
  }

  const hasPublicationWindow = listing.publishedAt !== null || listing.expiresAt !== null;
  if (
    hasPublicationWindow &&
    (!listing.publishedAt ||
      !listing.expiresAt ||
      !isFiniteDate(listing.publishedAt) ||
      !isFiniteDate(listing.expiresAt) ||
      listing.publishedAt < listing.createdAt ||
      listing.expiresAt <= listing.publishedAt)
  ) {
    fail("INVALID_EXPIRY");
  }
  if (
    ["DRAFT", "SUBMITTED"].includes(listing.status) &&
    (listing.publishedAt !== null || listing.expiresAt !== null)
  ) {
    fail("INVALID_EXPIRY");
  }
  if (
    ["PUBLISHED", "EXPIRED", "ARCHIVED"].includes(listing.status) &&
    (listing.publishedAt === null || listing.expiresAt === null)
  ) {
    fail("INVALID_EXPIRY");
  }
  if (listing.status === "EXPIRED" && listing.expiresAt && listing.updatedAt < listing.expiresAt) {
    fail("INVALID_EXPIRY");
  }
}

export function assertListingInvariants(listing: ListingAggregate): void {
  if (!uuidPattern.test(listing.id)) {
    fail("INVALID_IDENTIFIER");
  }
  if (!Number.isInteger(listing.version) || listing.version < 1) {
    fail("VERSION_CONFLICT");
  }
  assertDetail(listing.detail, listing.type);
  assertPrice(listing.price);
  assertModerationState(listing);
  assertLifecycleTimestamps(listing);
}

export function createDraftListing(input: CreateDraftListingInput): ListingAggregate {
  const listing: ListingAggregate = {
    id: input.id,
    type: input.type,
    status: "DRAFT",
    moderationStatus: "NOT_REVIEWED",
    detail: input.detail,
    price: input.price,
    publishedAt: null,
    expiresAt: null,
    deletedAt: null,
    createdAt: new Date(input.createdAt),
    updatedAt: new Date(input.createdAt),
    version: 1,
  };
  assertListingInvariants(listing);
  return listing;
}

function addUtcDays(value: Date, days: number): Date {
  if (!Number.isInteger(days) || days < 1 || days > 365) fail("INVALID_EXPIRY");
  return new Date(value.getTime() + days * 86_400_000);
}

function validateTransitionMetadata(
  listing: ListingAggregate,
  command: ListingTransitionCommand,
): void {
  if (command.expectedVersion !== listing.version) fail("VERSION_CONFLICT");
  if (!uuidPattern.test(command.actorId)) fail("INVALID_IDENTIFIER");
  if (
    !isFiniteDate(command.occurredAt) ||
    command.occurredAt < listing.updatedAt ||
    !reasonCodePattern.test(command.reasonCode)
  ) {
    fail("INVALID_TRANSITION_METADATA");
  }
}

function isSubmittedReview(listing: ListingAggregate): boolean {
  return (
    listing.status === "SUBMITTED" &&
    (listing.moderationStatus === "PENDING_REVIEW" || listing.moderationStatus === "ESCALATED")
  );
}

export function transitionListing(
  current: ListingAggregate,
  command: ListingTransitionCommand,
): ListingTransitionResult {
  assertListingInvariants(current);
  validateTransitionMetadata(current, command);

  const next: ListingAggregate = {
    ...current,
    updatedAt: new Date(command.occurredAt),
    version: current.version + 1,
  };

  switch (command.kind) {
    case "SUBMIT":
      if (current.status !== "DRAFT") fail("INVALID_STATE_TRANSITION");
      next.status = "SUBMITTED";
      next.moderationStatus = "PENDING_REVIEW";
      break;
    case "AUTO_APPROVE":
      if (current.status !== "SUBMITTED" || current.moderationStatus !== "PENDING_REVIEW") {
        fail("INVALID_STATE_TRANSITION");
      }
      next.status = "PUBLISHED";
      next.moderationStatus = "AUTO_APPROVED";
      next.publishedAt = new Date(command.occurredAt);
      next.expiresAt = addUtcDays(command.occurredAt, command.lifetimeDays);
      break;
    case "MODERATOR_APPROVE":
      if (!isSubmittedReview(current)) fail("INVALID_STATE_TRANSITION");
      next.status = "PUBLISHED";
      next.moderationStatus = "APPROVED";
      next.publishedAt = new Date(command.occurredAt);
      next.expiresAt = addUtcDays(command.occurredAt, command.lifetimeDays);
      break;
    case "ESCALATE":
      if (current.status !== "SUBMITTED" || current.moderationStatus !== "PENDING_REVIEW") {
        fail("INVALID_STATE_TRANSITION");
      }
      next.moderationStatus = "ESCALATED";
      break;
    case "REJECT_TO_DRAFT":
      if (!isSubmittedReview(current)) fail("INVALID_STATE_TRANSITION");
      next.status = "DRAFT";
      next.moderationStatus = "REJECTED";
      break;
    case "SUSPEND":
      if (current.status !== "SUBMITTED" && current.status !== "PUBLISHED") {
        fail("INVALID_STATE_TRANSITION");
      }
      next.status = "SUSPENDED";
      next.moderationStatus = "REJECTED";
      break;
    case "RESTORE":
      if (
        current.status !== "SUSPENDED" ||
        current.moderationStatus !== "REJECTED" ||
        current.publishedAt === null ||
        current.expiresAt === null ||
        command.occurredAt >= current.expiresAt
      ) {
        fail("INVALID_STATE_TRANSITION");
      }
      next.status = "PUBLISHED";
      next.moderationStatus = "APPROVED";
      break;
    case "EXPIRE":
      if (
        current.status !== "PUBLISHED" ||
        !current.expiresAt ||
        command.occurredAt < current.expiresAt
      ) {
        fail("INVALID_STATE_TRANSITION");
      }
      next.status = "EXPIRED";
      break;
    case "ARCHIVE":
      if (current.status !== "PUBLISHED") fail("INVALID_STATE_TRANSITION");
      next.status = "ARCHIVED";
      break;
    case "DELETE":
      if (current.status === "DELETED") fail("INVALID_STATE_TRANSITION");
      next.status = "DELETED";
      next.deletedAt = new Date(command.occurredAt);
      break;
  }

  assertListingInvariants(next);
  return {
    listing: next,
    event: {
      actorId: command.actorId,
      reasonCode: command.reasonCode,
      occurredAt: new Date(command.occurredAt),
      previousStatus: current.status,
      currentStatus: next.status,
      previousModerationStatus: current.moderationStatus,
      currentModerationStatus: next.moderationStatus,
      previousVersion: current.version,
      currentVersion: next.version,
    },
  };
}
