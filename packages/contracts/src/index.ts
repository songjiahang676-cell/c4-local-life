import { z } from "zod";
import type { components, operations, paths } from "./generated/openapi";

export type OpenApiComponents = components;
export type OpenApiOperations = operations;
export type OpenApiPaths = paths;
export type Locale = components["schemas"]["CreateListingRequest"]["locale"];
export type ListingType = components["schemas"]["ListingType"];
export type ContentStatus = components["schemas"]["ContentStatus"];
export type Money = components["schemas"]["Money"];
export type CreateListingInput = components["schemas"]["CreateListingRequest"];
export type UpdateListingInput = components["schemas"]["UpdateListingRequest"];
export type PublicListingView = components["schemas"]["PublicListingView"];
export type PublicListingSummaryView = components["schemas"]["PublicListingSummaryView"];
export type ListingCollection = components["schemas"]["ListingCollection"];
export type ListingOwnerView = components["schemas"]["ListingOwnerView"];
export type ListingResponse = components["schemas"]["ListingResponse"];
export type ListingOwnerResponse = components["schemas"]["ListingOwnerResponse"];
export type ListingSubmissionResponse = components["schemas"]["ListingSubmissionResponse"];
export type ListingSearchInput = NonNullable<operations["searchContent"]["parameters"]["query"]>;
export type ListListingsQuery = NonNullable<operations["listListings"]["parameters"]["query"]>;
export type ProblemDetails = components["schemas"]["ProblemDetails"];
export type Session = components["schemas"]["Session"];
export type SessionResponse = components["schemas"]["SessionResponse"];
export type PlatformRole = components["schemas"]["PlatformRole"];
export type AdminNavigationItem = components["schemas"]["AdminNavigationItem"];
export type AdminSession = components["schemas"]["AdminSession"];
export type AdminSessionResponse = components["schemas"]["AdminSessionResponse"];
export type AdminMfaEnrollmentResponse = components["schemas"]["AdminMfaEnrollmentResponse"];
export type AdminMfaEnrollmentVerifyRequest =
  components["schemas"]["AdminMfaEnrollmentVerifyRequest"];
export type AdminMfaVerifyRequest = components["schemas"]["AdminMfaVerifyRequest"];
export type AdminMfaActivationResponse = components["schemas"]["AdminMfaActivationResponse"];
export type AdminMfaVerificationResponse = components["schemas"]["AdminMfaVerificationResponse"];
export type ModerationCase = components["schemas"]["ModerationCase"];
export type ModerationCaseCollection = components["schemas"]["ModerationCaseCollection"];
export type ModerationCaseDetailResponse = components["schemas"]["ModerationCaseDetailResponse"];
export type ModerationActionRequest = components["schemas"]["ModerationActionRequest"];
export type ModerationActionResponse = components["schemas"]["ModerationActionResponse"];
export type ListModerationCasesQuery = NonNullable<
  operations["listModerationCases"]["parameters"]["query"]
>;
export type OtpRequest = components["schemas"]["OtpRequest"];
export type OtpVerifyRequest = components["schemas"]["OtpVerifyRequest"];
export type OtpAcceptedResponse = components["schemas"]["OtpAcceptedResponse"];
export type PasswordLoginRequest = components["schemas"]["PasswordLoginRequest"];
export type PasswordRecoveryRequest = components["schemas"]["PasswordRecoveryRequest"];
export type PasswordRecoveryConfirmRequest =
  components["schemas"]["PasswordRecoveryConfirmRequest"];
export type PasswordRecoveryAcceptedResponse =
  components["schemas"]["PasswordRecoveryAcceptedResponse"];
export type PasswordRecoveryResponse = components["schemas"]["PasswordRecoveryResponse"];
export type MyProfile = components["schemas"]["MyProfile"];
export type MyProfileResponse = components["schemas"]["MyProfileResponse"];
export type UpdateMyProfileRequest = components["schemas"]["UpdateMyProfileRequest"];
export type SessionDevice = components["schemas"]["SessionDevice"];
export type SessionDeviceCollection = components["schemas"]["SessionDeviceCollection"];
export type ListMySessionsQuery = NonNullable<operations["listMySessions"]["parameters"]["query"]>;
export type Organization = components["schemas"]["Organization"];
export type OrganizationResponse = components["schemas"]["OrganizationResponse"];
export type OrganizationType = components["schemas"]["OrganizationType"];
export type MembershipRole = components["schemas"]["MembershipRole"];
export type OrganizationMember = components["schemas"]["OrganizationMember"];
export type OrganizationMemberCollection = components["schemas"]["OrganizationMemberCollection"];
export type CreateOrganizationRequest = components["schemas"]["CreateOrganizationRequest"];
export type ListOrganizationMembersQuery = NonNullable<
  operations["listOrganizationMembers"]["parameters"]["query"]
>;
export type RegionType = components["schemas"]["RegionType"];
export type TaxonomyAlias = components["schemas"]["TaxonomyAlias"];
export type Region = components["schemas"]["Region"];
export type Category = components["schemas"]["Category"];
export type ListRegionsQuery = NonNullable<operations["listRegions"]["parameters"]["query"]>;
export type ListCategoriesQuery = NonNullable<operations["listCategories"]["parameters"]["query"]>;
export type RegionCollectionResponse =
  operations["listRegions"]["responses"][200]["content"]["application/json"];
export type CategoryCollectionResponse =
  operations["listCategories"]["responses"][200]["content"]["application/json"];
export type CategoryFormSchema = components["schemas"]["CategoryFormSchema"];
export type FormField = components["schemas"]["FormField"];
export type FormFieldValidation = components["schemas"]["FormFieldValidation"];
export type FormPublicationPolicy = components["schemas"]["FormPublicationPolicy"];
export type GetCategoryFormSchemaQuery = NonNullable<
  operations["getCategoryFormSchema"]["parameters"]["query"]
>;
export type CreateUploadRequest = components["schemas"]["CreateUploadRequest"];
export type CreateUploadResponse = components["schemas"]["CreateUploadResponse"];
export type MediaProcessingResponse = components["schemas"]["MediaProcessingResponse"];
export type MediaStatusResponse = components["schemas"]["MediaStatusResponse"];

export const localeSchema: z.ZodType<Locale> = z.enum(["zh-Hans", "en-US"]);
export const listingTypeSchema: z.ZodType<ListingType> = z.enum([
  "JOB",
  "RENTAL",
  "TRANSFER",
  "SECONDHAND",
  "SERVICE",
]);
export const contentStatusSchema: z.ZodType<ContentStatus> = z.enum([
  "DRAFT",
  "SUBMITTED",
  "PUBLISHED",
  "EXPIRED",
  "ARCHIVED",
  "SUSPENDED",
  "DELETED",
]);

const safeUploadFilenameSchema = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .refine(
    (value) =>
      value !== "." &&
      value !== ".." &&
      !/[\\/]/.test(value) &&
      !Array.from(value).some((character) => {
        const codePoint = character.codePointAt(0) ?? 0;
        return (
          codePoint <= 0x1f ||
          (codePoint >= 0x7f && codePoint <= 0x9f) ||
          (codePoint >= 0x202a && codePoint <= 0x202e) ||
          (codePoint >= 0x2066 && codePoint <= 0x2069)
        );
      }),
    "Filename contains unsupported characters",
  );

export const createUploadRequestSchema: z.ZodType<CreateUploadRequest> = z
  .object({
    filename: safeUploadFilenameSchema,
    mimeType: z.enum(["image/jpeg", "image/png", "image/webp", "application/pdf"]),
    byteSize: z.number().int().min(1).max(20_971_520),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    purpose: z.enum(["LISTING_MEDIA", "AVATAR", "BUSINESS_LOGO", "AD_CREATIVE", "VERIFICATION"]),
  })
  .strict();

export const mediaStatusResponseSchema: z.ZodType<MediaStatusResponse> = z
  .object({
    data: z
      .object({
        mediaId: z.uuid(),
        status: z.enum(["UPLOADING", "SCANNING", "READY", "REJECTED"]),
        rejectionCode: z
          .string()
          .regex(/^[A-Z][A-Z0-9_]{2,63}$/)
          .nullable(),
        updatedAt: z.iso.datetime({ offset: true }),
      })
      .strict(),
  })
  .strict();

export const idempotencyKeySchema = z
  .string()
  .min(16)
  .max(128)
  .regex(
    /^[A-Za-z0-9._:-]+$/,
    "Idempotency-Key must contain only letters, digits, dot, underscore, colon or hyphen",
  );

const fixedPriceUnits = [
  "FIXED",
  "HOURLY",
  "DAILY",
  "WEEKLY",
  "MONTHLY",
  "YEARLY",
  "SQFT",
] as const;
const nonFixedPriceUnits = ["NEGOTIABLE", "FREE"] as const;
const priceUnitSchema = z.enum([...fixedPriceUnits, ...nonFixedPriceUnits]);
const moneyAmountSchema = z.string().regex(/^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/);

export const moneySchema: z.ZodType<Money> = z
  .object({
    amount: moneyAmountSchema.nullable(),
    currency: z.literal("USD"),
    unit: priceUnitSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (nonFixedPriceUnits.includes(value.unit as (typeof nonFixedPriceUnits)[number])) {
      if (value.amount !== null) {
        context.addIssue({
          code: "custom",
          path: ["amount"],
          message: "FREE and NEGOTIABLE prices must not include an amount",
        });
      }
      return;
    }
    if (value.amount === null || Number(value.amount) <= 0) {
      context.addIssue({
        code: "custom",
        path: ["amount"],
        message: "A positive amount is required for this price unit",
      });
    }
  });

const geoPointSchema = z
  .object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
  })
  .strict();

const forbiddenBidiPattern = /[\u202a-\u202e\u2066-\u2069]/u;

function safeListingText(value: string, multiline: boolean): boolean {
  if (forbiddenBidiPattern.test(value)) return false;
  return !Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    if (multiline && (character === "\n" || character === "\r" || character === "\t")) {
      return false;
    }
    return codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f);
  });
}

const listingTitleSchema = z
  .string()
  .trim()
  .min(5)
  .max(120)
  .refine((value) => safeListingText(value, false), "Title contains unsupported characters");
const listingSummarySchema = z
  .string()
  .trim()
  .max(240)
  .refine((value) => safeListingText(value, false), "Summary contains unsupported characters");
const listingBodySchema = z
  .string()
  .trim()
  .min(20)
  .max(10_000)
  .refine((value) => safeListingText(value, true), "Body contains unsupported characters");
const listingRegionCodeSchema = z
  .string()
  .min(2)
  .max(80)
  .regex(/^[A-Za-z0-9._:-]+$/);
const listingAttributesSchema = z
  .record(z.string(), z.json())
  .refine((value) => Object.keys(value).length <= 100, "Attributes exceed the field limit");
const listingMediaIdsSchema = z
  .array(z.uuid())
  .max(20)
  .refine((value) => new Set(value).size === value.length, "Media IDs must be unique");
const listingContactModeSchema = z.enum(["IN_APP", "PHONE_REVEAL", "EMAIL_REVEAL"]);
const listingLocationPrecisionSchema = z.enum(["CITY", "NEIGHBORHOOD", "APPROXIMATE", "EXACT"]);
const createListingLocationSchema = z
  .object({
    precision: listingLocationPrecisionSchema.default("CITY"),
    point: geoPointSchema.optional(),
  })
  .strict();
const updateListingLocationSchema = z
  .object({
    precision: listingLocationPrecisionSchema.optional(),
    point: geoPointSchema.nullable().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, "Location patch must not be empty");

export const createListingSchema: z.ZodType<CreateListingInput> = z
  .object({
    type: listingTypeSchema,
    locale: localeSchema.default("zh-Hans"),
    categoryId: z.uuid(),
    organizationId: z.uuid().optional(),
    regionCode: listingRegionCodeSchema,
    title: listingTitleSchema,
    summary: listingSummarySchema.optional(),
    body: listingBodySchema,
    price: moneySchema.optional(),
    location: createListingLocationSchema.optional(),
    attributes: listingAttributesSchema.default({}),
    mediaIds: listingMediaIdsSchema.default([]),
    contactMode: listingContactModeSchema.default("IN_APP"),
  })
  .strict();

export const updateListingSchema: z.ZodType<UpdateListingInput> = z
  .object({
    locale: localeSchema.optional(),
    categoryId: z.uuid().optional(),
    regionCode: listingRegionCodeSchema.optional(),
    title: listingTitleSchema.optional(),
    summary: listingSummarySchema.nullable().optional(),
    body: listingBodySchema.optional(),
    price: moneySchema.nullable().optional(),
    location: updateListingLocationSchema.optional(),
    attributes: listingAttributesSchema.optional(),
    mediaIds: listingMediaIdsSchema.optional(),
    contactMode: listingContactModeSchema.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, "Listing patch must not be empty");

export const listingSearchSchema: z.ZodType<ListingSearchInput> = z
  .object({
    q: z.string().trim().max(120).optional(),
    type: listingTypeSchema.optional(),
    categoryId: z.uuid().optional(),
    regionCode: z.string().max(80).optional(),
    latitude: z.coerce.number().min(-90).max(90).optional(),
    longitude: z.coerce.number().min(-180).max(180).optional(),
    radiusMiles: z.coerce.number().int().min(1).max(100).optional(),
    minPrice: z.coerce.number().nonnegative().optional(),
    maxPrice: z.coerce.number().nonnegative().optional(),
    sort: z
      .enum(["RELEVANCE", "NEWEST", "PRICE_ASC", "PRICE_DESC", "DISTANCE"])
      .default("RELEVANCE"),
    cursor: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();

export const listListingsQuerySchema: z.ZodType<ListListingsQuery> = z
  .object({
    type: z.literal("RENTAL").default("RENTAL"),
    categoryId: z.uuid().optional(),
    regionCode: z.string().trim().min(2).max(80).optional(),
    cursor: z.string().max(512).optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  })
  .strict();

export const problemDetailsSchema: z.ZodType<ProblemDetails> = z
  .object({
    type: z.string(),
    title: z.string(),
    status: z.number().int().min(400).max(599),
    detail: z.string(),
    instance: z.string(),
    requestId: z.string(),
    errors: z.record(z.string(), z.array(z.string())).optional(),
  })
  .strict();

export const otpRequestSchema: z.ZodType<OtpRequest> = z
  .object({
    channel: z.enum(["SMS", "EMAIL"]),
    destination: z.string().trim().min(1).max(320),
    purpose: z.enum(["SIGN_IN", "VERIFY_CONTACT", "SENSITIVE_ACTION"]),
    locale: localeSchema.default("zh-Hans"),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.channel === "EMAIL" && !z.email().max(320).safeParse(value.destination).success) {
      context.addIssue({
        code: "custom",
        path: ["destination"],
        message: "Invalid email address",
      });
    }
    if (value.channel === "SMS" && !/^\+[1-9]\d{7,14}$/.test(value.destination)) {
      context.addIssue({
        code: "custom",
        path: ["destination"],
        message: "Invalid E.164 phone number",
      });
    }
  });

export const otpVerifyRequestSchema: z.ZodType<OtpVerifyRequest> = z
  .object({
    challengeId: z.uuid(),
    code: z.string().regex(/^\d{6}$/),
  })
  .strict();

export const passwordLoginRequestSchema: z.ZodType<PasswordLoginRequest> = z
  .object({
    identifier: z.string().trim().min(1).max(320),
    password: z.string().min(1).max(512),
  })
  .strict()
  .superRefine((value, context) => {
    const validEmail = z.email().max(320).safeParse(value.identifier).success;
    const validPhone = /^\+[1-9]\d{7,14}$/.test(value.identifier);
    if (!validEmail && !validPhone) {
      context.addIssue({
        code: "custom",
        path: ["identifier"],
        message: "Invalid account identifier",
      });
    }
  });

export const passwordRecoveryRequestSchema: z.ZodType<PasswordRecoveryRequest> = z
  .object({
    channel: z.enum(["EMAIL", "SMS"]),
    destination: z.string().trim().min(1).max(320),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.channel === "EMAIL" && !z.email().max(320).safeParse(value.destination).success) {
      context.addIssue({
        code: "custom",
        path: ["destination"],
        message: "Invalid email address",
      });
    }
    if (value.channel === "SMS" && !/^\+[1-9]\d{7,14}$/.test(value.destination)) {
      context.addIssue({
        code: "custom",
        path: ["destination"],
        message: "Invalid E.164 phone number",
      });
    }
  });

export const passwordRecoveryConfirmRequestSchema: z.ZodType<PasswordRecoveryConfirmRequest> = z
  .object({
    recoveryRequestId: z.uuid(),
    token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    newPassword: z.string().min(15).max(128),
  })
  .strict();

export const adminMfaEnrollmentVerifyRequestSchema: z.ZodType<AdminMfaEnrollmentVerifyRequest> = z
  .object({
    credentialId: z.uuid(),
    code: z.string().regex(/^\d{6}$/),
  })
  .strict();

export const adminMfaVerifyRequestSchema: z.ZodType<AdminMfaVerifyRequest> = z
  .object({
    code: z
      .string()
      .trim()
      .transform((value) => value.toUpperCase())
      .pipe(z.string().regex(/^(?:\d{6}|[A-Z2-7]{4}(?:-[A-Z2-7]{4}){3})$/)),
  })
  .strict();

export const listModerationCasesQuerySchema: z.ZodType<ListModerationCasesQuery> = z
  .object({
    queue: z.literal("listing-submission").default("listing-submission"),
    status: z.enum(["OPEN", "ASSIGNED", "RESOLVED", "APPEALED", "CLOSED"]).default("OPEN"),
    riskTier: z.enum(["MEDIUM", "HIGH"]).optional(),
    minPriority: z.coerce.number().int().min(0).max(100).optional(),
    cursor: z.string().max(512).optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  })
  .strict();

const moderationReasonByAction = {
  APPROVE: ["CONTENT_POLICY_COMPLIANT"],
  REQUEST_CHANGES: ["NEEDS_CLARIFICATION"],
  REJECT: ["PROHIBITED_CONTENT", "EXTERNAL_PAYMENT_RISK"],
  ESCALATE: ["ESCALATE_SENIOR_REVIEW"],
} as const;

function safeModerationNote(value: string): boolean {
  return !Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    const allowedWhitespace = codePoint === 0x09 || codePoint === 0x0a || codePoint === 0x0d;
    return (
      (codePoint <= 0x1f && !allowedWhitespace) ||
      (codePoint >= 0x7f && codePoint <= 0x9f) ||
      isBidirectionalControl(codePoint)
    );
  });
}

export const moderationActionRequestSchema: z.ZodType<ModerationActionRequest> = z
  .object({
    action: z.enum(["APPROVE", "REQUEST_CHANGES", "REJECT", "ESCALATE"]),
    reasonCode: z.enum([
      "CONTENT_POLICY_COMPLIANT",
      "NEEDS_CLARIFICATION",
      "PROHIBITED_CONTENT",
      "EXTERNAL_PAYMENT_RISK",
      "ESCALATE_SENIOR_REVIEW",
    ]),
    note: z
      .string()
      .trim()
      .min(1)
      .max(500)
      .refine(safeModerationNote, "Note contains unsupported characters")
      .optional(),
  })
  .strict()
  .superRefine((value, context) => {
    const allowed = moderationReasonByAction[value.action] as readonly string[];
    if (!allowed.includes(value.reasonCode)) {
      context.addIssue({
        code: "custom",
        path: ["reasonCode"],
        message: "Reason code is not allowed for this moderation action",
      });
    }
  });

function isBidirectionalControl(codePoint: number): boolean {
  return (
    (codePoint >= 0x202a && codePoint <= 0x202e) || (codePoint >= 0x2066 && codePoint <= 0x2069)
  );
}

function hasUnsupportedDisplayNameCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return (
      codePoint <= 0x1f ||
      (codePoint >= 0x7f && codePoint <= 0x9f) ||
      isBidirectionalControl(codePoint)
    );
  });
}

function hasUnsupportedBioCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    const allowedWhitespace = codePoint === 0x09 || codePoint === 0x0a || codePoint === 0x0d;
    return (
      (codePoint <= 0x1f && !allowedWhitespace) ||
      (codePoint >= 0x7f && codePoint <= 0x9f) ||
      isBidirectionalControl(codePoint)
    );
  });
}

export const updateMyProfileSchema: z.ZodType<UpdateMyProfileRequest> = z
  .object({
    displayName: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .refine((value) => !hasUnsupportedDisplayNameCharacter(value), {
        message: "Display name contains unsupported characters",
      })
      .optional(),
    bio: z
      .string()
      .trim()
      .max(500)
      .refine((value) => !hasUnsupportedBioCharacter(value), {
        message: "Bio contains unsupported characters",
      })
      .nullable()
      .optional(),
    preferredLocale: localeSchema.optional(),
    homeRegionId: z.uuid().nullable().optional(),
  })
  .strict()
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    path: [],
    message: "At least one profile field is required",
  });

export const listMySessionsQuerySchema: z.ZodType<ListMySessionsQuery> = z
  .object({
    cursor: z.string().max(512).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();

export const createOrganizationSchema: z.ZodType<CreateOrganizationRequest> = z
  .object({
    type: z.enum(["MERCHANT", "SERVICE_PROVIDER", "SUPPLIER", "MEDIA"]),
    displayName: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .refine((value) => !hasUnsupportedDisplayNameCharacter(value), {
        message: "Display name contains unsupported characters",
      }),
    legalName: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .refine((value) => !hasUnsupportedDisplayNameCharacter(value), {
        message: "Legal name contains unsupported characters",
      })
      .nullable()
      .optional(),
    slug: z
      .string()
      .min(3)
      .max(80)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  })
  .strict();

export const listOrganizationMembersQuerySchema: z.ZodType<ListOrganizationMembersQuery> = z
  .object({
    cursor: z.string().max(512).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();

const taxonomyQueryTextSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .refine((value) => !hasUnsupportedDisplayNameCharacter(value), {
    message: "Taxonomy query contains unsupported characters",
  })
  .transform((value) => value.normalize("NFKC"));

const activeOnlyQuerySchema = z.preprocess((value) => {
  if (value === "true") return true;
  if (value === "false") return false;
  return value;
}, z.literal(true));

export const listRegionsQuerySchema: z.ZodType<ListRegionsQuery> = z
  .object({
    parentCode: z
      .string()
      .trim()
      .regex(/^[A-Z0-9-]{2,80}$/)
      .optional(),
    type: z
      .enum(["COUNTRY", "STATE", "COUNTY", "CITY", "NEIGHBORHOOD", "ZIP_CODE", "REGION_GROUP"])
      .optional(),
    activeOnly: activeOnlyQuerySchema.default(true),
    q: taxonomyQueryTextSchema.optional(),
  })
  .strict();

export const listCategoriesQuerySchema: z.ZodType<ListCategoriesQuery> = z
  .object({
    vertical: listingTypeSchema.optional(),
    parentId: z.uuid().optional(),
    activeOnly: activeOnlyQuerySchema.default(true),
    q: taxonomyQueryTextSchema.optional(),
  })
  .strict();

export const getCategoryFormSchemaQuerySchema: z.ZodType<GetCategoryFormSchemaQuery> = z
  .object({
    version: z.coerce.number().int().min(1).optional(),
  })
  .strict();

const localizedTextSchema = z
  .object({
    "zh-Hans": z.string().trim().min(1).max(120),
    "en-US": z.string().trim().min(1).max(120),
  })
  .strict();

const formOptionSchema = z
  .object({
    value: z
      .string()
      .min(1)
      .max(80)
      .regex(/^[a-z0-9][a-zA-Z0-9_-]*$/),
    label: localizedTextSchema,
  })
  .strict();

function isSafeFormPattern(value: string): boolean {
  if (
    /\\(?:[1-9]|k<)/.test(value) ||
    /\(\?[=!<]/.test(value) ||
    /\([^)]*(?:[+*]|\{\d+,?\d*\})[^)]*\)(?:[+*]|\{\d+,?\d*\})/.test(value)
  ) {
    return false;
  }
  try {
    void new RegExp(value, "u");
    return true;
  } catch {
    return false;
  }
}

const formFieldValidationSchema = z
  .object({
    min: z.number().finite().optional(),
    max: z.number().finite().optional(),
    minLength: z.number().int().min(0).max(10_000).optional(),
    maxLength: z.number().int().min(1).max(10_000).optional(),
    pattern: z
      .string()
      .min(1)
      .max(256)
      .refine(isSafeFormPattern, "Unsafe regular expression")
      .optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.min !== undefined && value.max !== undefined && value.min > value.max) {
      context.addIssue({ code: "custom", path: ["max"], message: "max must be >= min" });
    }
    if (
      value.minLength !== undefined &&
      value.maxLength !== undefined &&
      value.minLength > value.maxLength
    ) {
      context.addIssue({
        code: "custom",
        path: ["maxLength"],
        message: "maxLength must be >= minLength",
      });
    }
  });

const selectableFieldTypes = new Set(["SELECT", "MULTISELECT"]);
const filterableFieldTypes = new Set([
  "NUMBER",
  "MONEY",
  "SELECT",
  "MULTISELECT",
  "BOOLEAN",
  "DATE",
]);

export const formFieldSchema: z.ZodType<FormField> = z
  .object({
    key: z
      .string()
      .min(2)
      .max(80)
      .regex(/^[a-z][a-zA-Z0-9_]{1,79}$/),
    type: z.enum([
      "TEXT",
      "TEXTAREA",
      "NUMBER",
      "MONEY",
      "SELECT",
      "MULTISELECT",
      "BOOLEAN",
      "DATE",
      "LOCATION",
      "PHONE",
      "EMAIL",
    ]),
    label: localizedTextSchema,
    helpText: localizedTextSchema.optional(),
    required: z.boolean(),
    filterable: z.boolean(),
    searchable: z.boolean(),
    options: z.array(formOptionSchema).max(100).optional(),
    validation: formFieldValidationSchema.optional(),
    visibility: z.enum(["PUBLIC", "OWNER_ONLY", "MODERATOR_ONLY"]),
    sortOrder: z.number().int().min(0),
  })
  .strict()
  .superRefine((field, context) => {
    const selectable = selectableFieldTypes.has(field.type);
    if (selectable && (!field.options || field.options.length === 0)) {
      context.addIssue({
        code: "custom",
        path: ["options"],
        message: "Selectable fields require at least one option",
      });
    }
    if (!selectable && field.options !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["options"],
        message: "Only selectable fields may define options",
      });
    }
    if (field.filterable && !filterableFieldTypes.has(field.type)) {
      context.addIssue({
        code: "custom",
        path: ["filterable"],
        message: "Field type is not eligible for normalized filtering",
      });
    }
    if (
      (field.type === "PHONE" || field.type === "EMAIL") &&
      (field.visibility === "PUBLIC" || field.searchable || field.filterable)
    ) {
      context.addIssue({
        code: "custom",
        path: ["visibility"],
        message: "Contact fields must be private and cannot be indexed",
      });
    }
    const validation = field.validation;
    if (
      validation &&
      (validation.min !== undefined || validation.max !== undefined) &&
      field.type !== "NUMBER" &&
      field.type !== "MONEY"
    ) {
      context.addIssue({
        code: "custom",
        path: ["validation"],
        message: "Numeric bounds apply only to NUMBER or MONEY fields",
      });
    }
    if (
      validation &&
      (validation.minLength !== undefined || validation.maxLength !== undefined) &&
      field.type !== "TEXT" &&
      field.type !== "TEXTAREA" &&
      field.type !== "MULTISELECT" &&
      field.type !== "PHONE" &&
      field.type !== "EMAIL"
    ) {
      context.addIssue({
        code: "custom",
        path: ["validation"],
        message: "Length bounds apply only to text or MULTISELECT fields",
      });
    }
    if (
      validation?.pattern !== undefined &&
      field.type !== "TEXT" &&
      field.type !== "TEXTAREA" &&
      field.type !== "PHONE" &&
      field.type !== "EMAIL"
    ) {
      context.addIssue({
        code: "custom",
        path: ["validation", "pattern"],
        message: "Patterns apply only to text fields",
      });
    }
    const optionValues = new Set<string>();
    for (const [index, option] of (field.options ?? []).entries()) {
      if (optionValues.has(option.value)) {
        context.addIssue({
          code: "custom",
          path: ["options", index, "value"],
          message: "Option values must be unique",
        });
      }
      optionValues.add(option.value);
    }
  });

export const formPublicationPolicySchema: z.ZodType<FormPublicationPolicy> = z
  .object({
    defaultLifetimeDays: z.number().int().min(1).max(365).optional(),
    manualReviewRequired: z.boolean().optional(),
    phoneVerificationRequired: z.boolean().optional(),
    maxMedia: z.number().int().min(0).max(20).optional(),
    allowExactAddress: z.boolean().optional(),
  })
  .strict();

export const categoryFormSchemaSchema: z.ZodType<CategoryFormSchema> = z
  .object({
    categoryId: z.uuid(),
    version: z.number().int().min(1),
    fields: z.array(formFieldSchema).max(100),
    publicationPolicy: formPublicationPolicySchema.optional(),
  })
  .strict()
  .superRefine((definition, context) => {
    const fieldKeys = new Set<string>();
    for (const [index, field] of definition.fields.entries()) {
      if (fieldKeys.has(field.key)) {
        context.addIssue({
          code: "custom",
          path: ["fields", index, "key"],
          message: "Field keys must be unique",
        });
      }
      fieldKeys.add(field.key);
    }
  });
