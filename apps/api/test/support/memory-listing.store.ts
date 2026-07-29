import type {
  CreateListingDraftInput,
  CreateListingDraftResult,
  FindListingDraftCreateRetryInput,
  FindListingDraftCreateRetryResult,
  ListingDraftReferences,
  ListingDraftWriteFields,
  ListingStore,
  FindListingSubmissionRetryInput,
  FindListingSubmissionRetryResult,
  ListingSubmissionCandidate,
  ListingSubmissionProjection,
  OwnerListingProjection,
  OwnerListingTransitionInput,
  OwnerListingTransitionResult,
  PublicListingListInput,
  PublicListingListResult,
  PublicListingProjection,
  ResolveListingDraftReferencesInput,
  UpdateListingDraftInput,
  UpdateListingDraftResult,
  SubmitListingInput,
  SubmitListingResult,
} from "../../src/modules/listings/listing.store";
import { MemoryTaxonomyStore } from "./memory-taxonomy.store";

export const memoryListingCategoryId = "11111111-1111-4111-8111-111111111111";
export const memoryJobCategoryId = "11111111-1111-4111-8111-111111111112";
export const memoryListingRegionId = "22222222-2222-4222-8222-222222222222";
export const memoryListingRegionCode = "US-CA-ORANGE-IRVINE";

const category = {
  id: memoryListingCategoryId,
  vertical: "RENTAL" as const,
  slug: "synthetic-rentals",
  nameZhHans: "测试租房",
  nameEn: "Synthetic Rentals",
};
const jobCategory = {
  id: memoryJobCategoryId,
  vertical: "JOB" as const,
  slug: "synthetic-jobs",
  nameZhHans: "测试招聘",
  nameEn: "Synthetic Jobs",
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
      {
        ...jobCategory,
        parentId: null,
        iconKey: "job",
        formSchemaVersion: 1,
        isActive: true,
        sortOrder: 1,
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
          publicationPolicy: {
            defaultLifetimeDays: 30,
            manualReviewRequired: false,
          },
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
      {
        id: "33333333-3333-4333-8333-333333333334",
        categoryId: memoryJobCategoryId,
        version: 1,
        revision: 1,
        definition: {
          categoryId: memoryJobCategoryId,
          version: 1,
          fields: [
            {
              key: "employerName",
              type: "TEXT",
              label: { "zh-Hans": "雇主", "en-US": "Employer" },
              required: true,
              filterable: false,
              searchable: true,
              visibility: "PUBLIC",
              sortOrder: 10,
              validation: { minLength: 2, maxLength: 160 },
            },
            {
              key: "employmentType",
              type: "SELECT",
              label: { "zh-Hans": "雇佣类型", "en-US": "Employment type" },
              required: true,
              filterable: true,
              searchable: true,
              visibility: "PUBLIC",
              sortOrder: 20,
              options: [{ value: "full-time", label: { "zh-Hans": "全职", "en-US": "Full time" } }],
            },
            {
              key: "experienceLevel",
              type: "SELECT",
              label: { "zh-Hans": "经验", "en-US": "Experience" },
              required: true,
              filterable: true,
              searchable: true,
              visibility: "PUBLIC",
              sortOrder: 30,
              options: [{ value: "entry", label: { "zh-Hans": "入门", "en-US": "Entry" } }],
            },
            {
              key: "remoteType",
              type: "SELECT",
              label: { "zh-Hans": "办公方式", "en-US": "Work arrangement" },
              required: true,
              filterable: true,
              searchable: true,
              visibility: "PUBLIC",
              sortOrder: 40,
              options: [{ value: "onsite", label: { "zh-Hans": "现场", "en-US": "On-site" } }],
            },
            {
              key: "wageMax",
              type: "MONEY",
              label: { "zh-Hans": "最高薪资", "en-US": "Maximum wage" },
              required: true,
              filterable: true,
              searchable: false,
              visibility: "PUBLIC",
              sortOrder: 50,
              validation: { min: 0.01, max: 99999999.99 },
            },
            {
              key: "schedule",
              type: "TEXT",
              label: { "zh-Hans": "工作时间", "en-US": "Schedule" },
              required: true,
              filterable: false,
              searchable: true,
              visibility: "PUBLIC",
              sortOrder: 60,
              validation: { minLength: 2, maxLength: 160 },
            },
            {
              key: "employmentPolicyAcknowledged",
              type: "BOOLEAN",
              label: { "zh-Hans": "就业政策", "en-US": "Employment policy" },
              required: true,
              filterable: false,
              searchable: false,
              visibility: "OWNER_ONLY",
              sortOrder: 100,
            },
          ],
          publicationPolicy: {
            defaultLifetimeDays: 30,
            manualReviewRequired: false,
          },
        },
        contentHash: "1".repeat(64),
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
  const selectedCategory = input.type === "JOB" ? jobCategory : category;
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
    category: selectedCategory,
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
    category: {
      ...(row.type === "JOB" ? jobCategory : category),
      id: fields.categoryId,
    },
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
  readonly #submissionIdempotency = new Map<
    string,
    { hash: string; submission: ListingSubmissionProjection }
  >();
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
    const selectedCategory = input.type === "JOB" ? jobCategory : category;
    return Promise.resolve(
      input.type === selectedCategory.vertical &&
        input.categoryId === selectedCategory.id &&
        input.regionCode === region.code &&
        (input.formSchemaVersion === undefined || input.formSchemaVersion === 1)
        ? {
            categoryId: selectedCategory.id,
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
    const listing = this.#publicRows.get(input.listingId);
    return Promise.resolve(
      listing &&
        listing.publishedAt <= input.now &&
        listing.expiresAt > input.now &&
        listing.status === "PUBLISHED"
        ? structuredClone(listing)
        : null,
    );
  }

  listPublic(input: PublicListingListInput): Promise<PublicListingListResult> {
    const rows = [...this.#publicRows.values()]
      .filter(
        (listing) =>
          listing.type === input.type &&
          listing.status === "PUBLISHED" &&
          listing.publishedAt <= input.now &&
          listing.expiresAt > input.now &&
          (!input.categoryId || listing.category.id === input.categoryId) &&
          (!input.regionCode || listing.region.code === input.regionCode) &&
          (!input.cursor ||
            listing.publishedAt < input.cursor.publishedAt ||
            (listing.publishedAt.getTime() === input.cursor.publishedAt.getTime() &&
              listing.id < input.cursor.id)),
      )
      .sort(
        (left, right) =>
          right.publishedAt.getTime() - left.publishedAt.getTime() ||
          right.id.localeCompare(left.id),
      );
    const page = rows.slice(0, input.limit);
    const last = page.at(-1);
    return Promise.resolve({
      items: structuredClone(page),
      nextCursor:
        rows.length > input.limit && last
          ? { publishedAt: new Date(last.publishedAt), id: last.id }
          : null,
    });
  }

  findByIdForOwner(input: {
    actorUserId: string;
    listingId: string;
    now: Date;
  }): Promise<OwnerListingProjection | null> {
    const row = this.#rows.get(input.listingId);
    return Promise.resolve(
      row && row.status !== "DELETED" && this.#canRead(input.actorUserId, row)
        ? cloneOwner(row)
        : null,
    );
  }

  transitionOwner(input: OwnerListingTransitionInput): Promise<OwnerListingTransitionResult> {
    const row = this.#rows.get(input.listingId);
    if (!row || !this.#canWrite(input.actorUserId, row)) {
      return Promise.resolve({ kind: "not_found" });
    }
    if (input.kind === "DELETE" && row.status === "DELETED") {
      return Promise.resolve({ kind: "already_deleted" });
    }
    if (
      input.kind === "ARCHIVE" &&
      row.status === "ARCHIVED" &&
      (input.expectedVersion === row.version || input.expectedVersion === row.version - 1)
    ) {
      return Promise.resolve({ kind: "already_archived", version: row.version });
    }
    if (row.version !== input.expectedVersion) {
      return Promise.resolve({ kind: "version_conflict", currentVersion: row.version });
    }
    if (input.occurredAt < row.updatedAt) {
      return Promise.resolve({ kind: "time_conflict", currentVersion: row.version });
    }
    if (input.kind === "ARCHIVE" && row.status !== "PUBLISHED") {
      return Promise.resolve({ kind: "state_conflict", currentVersion: row.version });
    }
    const updated: OwnerListingProjection = {
      ...row,
      status: input.kind === "ARCHIVE" ? "ARCHIVED" : "DELETED",
      updatedAt: input.occurredAt,
      version: row.version + 1,
    };
    this.#rows.set(updated.id, updated);
    this.#publicRows.delete(updated.id);
    const action = input.kind === "ARCHIVE" ? "listing.archived" : "listing.deleted";
    this.auditActions.push(action);
    this.outboxEvents.push(action);
    return Promise.resolve({ kind: "transitioned", version: updated.version });
  }

  findSubmissionRetry(
    input: FindListingSubmissionRetryInput,
  ): Promise<FindListingSubmissionRetryResult> {
    const evidence = this.#submissionIdempotency.get(
      `${input.actorUserId}:${input.idempotencyKey}`,
    );
    if (!evidence) return Promise.resolve({ kind: "missing" });
    return Promise.resolve(
      evidence.hash === input.requestHash
        ? { kind: "exact_retry", submission: structuredClone(evidence.submission) }
        : { kind: "conflict" },
    );
  }

  findSubmissionCandidate(input: {
    actorUserId: string;
    listingId: string;
  }): Promise<ListingSubmissionCandidate | null> {
    const row = this.#rows.get(input.listingId);
    if (!row || !this.#canWrite(input.actorUserId, row)) return Promise.resolve(null);
    return Promise.resolve({
      id: row.id,
      type: row.type,
      ownerId: row.ownerId,
      organizationId: row.organizationId,
      status: row.status,
      moderationStatus: row.moderationStatus,
      title: row.title,
      summary: row.summary,
      body: row.body,
      priceAmount: row.price?.amount ?? null,
      priceUnit: row.price?.unit ?? null,
      formSchemaDefinition: {
        categoryId: row.category.id,
        version: row.formSchemaVersion,
        fields: [],
        publicationPolicy: {
          defaultLifetimeDays: 30,
          manualReviewRequired: false,
        },
      },
      actorCreatedAt: new Date("2025-01-01T00:00:00.000Z"),
      publishedAt: row.publishedAt,
      expiresAt: row.expiresAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      version: row.version,
    });
  }

  submit(input: SubmitListingInput): Promise<SubmitListingResult> {
    const key = `${input.actorUserId}:${input.idempotencyKey}`;
    const evidence = this.#submissionIdempotency.get(key);
    if (evidence) {
      return Promise.resolve(
        evidence.hash === input.requestHash
          ? { kind: "exact_retry", submission: structuredClone(evidence.submission) }
          : { kind: "idempotency_conflict" },
      );
    }
    const row = this.#rows.get(input.listingId);
    if (!row || !this.#canWrite(input.actorUserId, row)) {
      return Promise.resolve({ kind: "not_found" });
    }
    if (row.version !== input.expectedVersion) {
      return Promise.resolve({ kind: "version_conflict", currentVersion: row.version });
    }
    if (row.status !== "DRAFT" || row.moderationStatus !== "NOT_REVIEWED") {
      return Promise.resolve({ kind: "state_conflict", currentVersion: row.version });
    }
    const updated: OwnerListingProjection = {
      ...row,
      status: input.decision.contentStatus,
      moderationStatus: input.decision.moderationStatus,
      publishedAt: input.decision.publishedAt,
      expiresAt: input.decision.expiresAt,
      updatedAt: input.occurredAt,
      version: input.decision.resultVersion,
    };
    this.#rows.set(updated.id, updated);
    if (updated.status === "PUBLISHED" && updated.publishedAt && updated.expiresAt) {
      this.#publicRows.set(updated.id, {
        id: updated.id,
        type: updated.type,
        status: "PUBLISHED",
        locale: updated.locale,
        title: updated.title,
        slug: updated.slug,
        summary: updated.summary,
        body: updated.body,
        price: structuredClone(updated.price),
        region: structuredClone(updated.region),
        category: structuredClone(updated.category),
        owner: structuredClone(updated.owner),
        organization: structuredClone(updated.organization),
        location: { precision: updated.location.precision },
        attributes: structuredClone(updated.attributes),
        featured: updated.isFeatured && Boolean(updated.featuredUntil),
        featuredUntil: updated.featuredUntil,
        publishedAt: updated.publishedAt,
        expiresAt: updated.expiresAt,
        createdAt: updated.createdAt,
        updatedAt: updated.updatedAt,
        version: updated.version,
      });
    }
    const submission = {
      resourceId: row.id,
      previousStatus: "DRAFT" as const,
      currentStatus: input.decision.contentStatus,
      previousModerationStatus: "NOT_REVIEWED" as const,
      currentModerationStatus: input.decision.moderationStatus,
      riskTier: input.riskTier,
      ruleSetVersion: input.ruleSetVersion,
      caseId: input.riskTier === "LOW" ? null : "77777777-7777-4777-8777-777777777777",
      occurredAt: input.occurredAt,
      version: input.decision.resultVersion,
    };
    this.#submissionIdempotency.set(key, { hash: input.requestHash, submission });
    this.auditActions.push("listing.submission.evaluated");
    this.outboxEvents.push(...input.decision.transitions.map((event) => event.eventType));
    return Promise.resolve({ kind: "submitted", submission: structuredClone(submission) });
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
