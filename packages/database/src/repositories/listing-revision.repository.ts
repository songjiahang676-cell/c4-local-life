import { createHash } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  ContentStatus,
  ListingRevisionClassification,
  ModerationRiskTier,
  ModerationStatus,
  Prisma,
  PrismaClient,
  type ListingType,
} from "../../generated/prisma/client";
import {
  activeListingActor,
  activeListingOrganizationWriter,
  applyListingMediaBindings,
  applyListingVerticalDetails,
  listingReferencesRemainValid,
  listingVerticalDetailsMatchType,
  listingWriteData,
  validateReadyListingMediaBindings,
  type ListingDraftWriteFields,
} from "./listing-draft.repository";
import { ListingRepository, type OwnerListingProjection } from "./listing.repository";
import {
  listingRevisionSelect,
  mapListingRevision,
  type ListingRevisionDiffEntry,
  type ListingRevisionProjection,
  type ListingRevisionReasonCode,
  type ListingRevisionSnapshot,
} from "./listing-revision";
import type { ListingSubmissionRuleHitInput } from "./listing-submission.repository";

export type {
  ListingRevisionDiffEntry,
  ListingRevisionProjection,
  ListingRevisionReasonCode,
  ListingRevisionReviewState,
  ListingRevisionSnapshot,
} from "./listing-revision";

export type ListingRevisionRepositoryOptions = {
  connectionString: string;
  poolMaximum?: number;
};

export type ListingRevisionCursor = {
  createdAt: Date;
  id: string;
};

export type ListListingRevisionsInput = {
  actorUserId: string;
  listingId: string;
  cursor?: ListingRevisionCursor;
  limit: number;
  now: Date;
};

export type ListListingRevisionsResult =
  | {
      kind: "listed";
      items: ListingRevisionProjection[];
      nextCursor: ListingRevisionCursor | null;
    }
  | { kind: "not_found" };

export type FindPublishedRevisionRetryInput = {
  actorUserId: string;
  idempotencyKey: string;
  requestHash: string;
  now: Date;
};

export type FindPublishedRevisionRetryResult =
  | {
      kind: "exact_retry";
      listing: OwnerListingProjection;
      revision: ListingRevisionProjection;
    }
  | { kind: "conflict" | "missing" };

export type RevisePublishedListingInput = ListingDraftWriteFields & {
  actorUserId: string;
  listingId: string;
  expectedVersion: number;
  idempotencyKey: string;
  requestHash: string;
  requestId: string;
  occurredAt: Date;
  classification:
    | typeof ListingRevisionClassification.MINOR_EDIT
    | typeof ListingRevisionClassification.MAJOR_EDIT;
  reasonCodes: readonly ListingRevisionReasonCode[];
  snapshot: ListingRevisionSnapshot;
  diff: readonly ListingRevisionDiffEntry[];
  inputHash: string;
  ruleSetKey: string;
  ruleSetVersion: number;
  riskTier: ModerationRiskTier;
  hits: readonly ListingSubmissionRuleHitInput[];
};

export type RevisePublishedListingResult =
  | {
      kind: "revised" | "exact_retry";
      listing: OwnerListingProjection;
      revision: ListingRevisionProjection;
    }
  | {
      kind:
        | "actor_unavailable"
        | "idempotency_conflict"
        | "invalid_media"
        | "invalid_reference"
        | "not_found"
        | "state_conflict"
        | "time_conflict"
        | "version_conflict";
      currentVersion?: number;
    };

type ListingRevisionClient = PrismaClient | Prisma.TransactionClient;

function isRepositoryOptions(
  target: ListingRevisionClient | ListingRevisionRepositoryOptions,
): target is ListingRevisionRepositoryOptions {
  return "connectionString" in target;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
    .join(",")}}`;
}

function hashJson(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

function asJsonObject(value: object): Prisma.InputJsonObject {
  return value as Prisma.InputJsonObject;
}

function asJsonArray(value: readonly object[]): Prisma.InputJsonArray {
  return [...value] as Prisma.InputJsonArray;
}

async function lockIdempotencyKey(
  transaction: Prisma.TransactionClient,
  actorUserId: string,
  idempotencyKey: string,
): Promise<void> {
  await transaction.$executeRaw(
    Prisma.sql`SELECT pg_advisory_xact_lock(
      hashtextextended(${"listing-revision-v1"} || ':' || ${actorUserId} || ':' || ${idempotencyKey}, 0)
    )`,
  );
}

async function lockListing(
  transaction: Prisma.TransactionClient,
  listingId: string,
): Promise<boolean> {
  const rows = await transaction.$queryRaw<Array<{ id: string }>>(
    Prisma.sql`SELECT "id" FROM "listings" WHERE "id" = ${listingId}::uuid FOR UPDATE`,
  );
  return rows.length === 1;
}

async function findRetry(
  client: ListingRevisionClient,
  input: FindPublishedRevisionRetryInput,
): Promise<FindPublishedRevisionRetryResult> {
  const revision = await client.listingRevision.findUnique({
    where: {
      actorUserId_idempotencyKey: {
        actorUserId: input.actorUserId,
        idempotencyKey: input.idempotencyKey,
      },
    },
    select: {
      requestHash: true,
      listingId: true,
      ...listingRevisionSelect,
    },
  });
  if (!revision) return { kind: "missing" };
  if (revision.requestHash !== input.requestHash) return { kind: "conflict" };
  const listing = await new ListingRepository(client).findByIdForOwner({
    actorUserId: input.actorUserId,
    listingId: revision.listingId,
    now: input.now,
  });
  return listing
    ? { kind: "exact_retry", listing, revision: mapListingRevision(revision) }
    : { kind: "conflict" };
}

function caseSnapshot(input: {
  listingId: string;
  listingVersion: number;
  listingType: ListingType;
  snapshot: ListingRevisionSnapshot;
  previous: Prisma.JsonValue | null;
  revisionId: string;
  classification: ListingRevisionClassification;
  reasonCodes: readonly ListingRevisionReasonCode[];
  originalPublishedAt: Date;
  originalExpiresAt: Date;
  capturedAt: Date;
}): Prisma.InputJsonObject {
  return asJsonObject({
    listingId: input.listingId,
    listingVersion: input.listingVersion,
    type: input.listingType,
    locale: input.snapshot.locale,
    title: input.snapshot.title,
    summary: input.snapshot.summary,
    body: input.snapshot.body,
    price: input.snapshot.price,
    attributes: input.snapshot.attributes,
    contactMode: input.snapshot.contactMode,
    locationPrecision: input.snapshot.location.precision,
    mediaIds: input.snapshot.mediaIds,
    category: input.snapshot.category,
    region: input.snapshot.region,
    formSchemaVersion: input.snapshot.formSchemaVersion,
    defaultLifetimeDays: input.snapshot.defaultLifetimeDays,
    sensitiveFieldsRedacted: true,
    capturedAt: input.capturedAt.toISOString(),
    previous: input.previous,
    revision: {
      id: input.revisionId,
      classification: input.classification,
      reasonCodes: input.reasonCodes,
      originalPublishedAt: input.originalPublishedAt.toISOString(),
      originalExpiresAt: input.originalExpiresAt.toISOString(),
    },
  });
}

export class ListingRevisionRepository {
  readonly #client: ListingRevisionClient;
  readonly #ownedClient: PrismaClient | null;

  constructor(target: ListingRevisionClient | ListingRevisionRepositoryOptions) {
    if (isRepositoryOptions(target)) {
      const adapter = new PrismaPg({
        connectionString: target.connectionString,
        max: target.poolMaximum ?? 10,
      });
      this.#ownedClient = new PrismaClient({ adapter });
      this.#client = this.#ownedClient;
      return;
    }
    this.#client = target;
    this.#ownedClient = null;
  }

  findRetry(input: FindPublishedRevisionRetryInput): Promise<FindPublishedRevisionRetryResult> {
    return findRetry(this.#client, input);
  }

  async list(input: ListListingRevisionsInput): Promise<ListListingRevisionsResult> {
    const listing = await new ListingRepository(this.#client).findByIdForOwner({
      actorUserId: input.actorUserId,
      listingId: input.listingId,
      now: input.now,
    });
    if (!listing) return { kind: "not_found" };
    const rows = await this.#client.listingRevision.findMany({
      where: {
        listingId: input.listingId,
        ...(input.cursor
          ? {
              OR: [
                { createdAt: { lt: input.cursor.createdAt } },
                { createdAt: input.cursor.createdAt, id: { lt: input.cursor.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: input.limit + 1,
      select: listingRevisionSelect,
    });
    const page = rows.slice(0, input.limit);
    const last = page.at(-1);
    return {
      kind: "listed",
      items: page.map(mapListingRevision),
      nextCursor:
        rows.length > input.limit && last ? { createdAt: last.createdAt, id: last.id } : null,
    };
  }

  revise(input: RevisePublishedListingInput): Promise<RevisePublishedListingResult> {
    return this.#inTransaction(async (transaction) => {
      await lockIdempotencyKey(transaction, input.actorUserId, input.idempotencyKey);
      const retry = await findRetry(transaction, { ...input, now: input.occurredAt });
      if (retry.kind === "exact_retry") return retry;
      if (retry.kind === "conflict") return { kind: "idempotency_conflict" };
      if (!(await lockListing(transaction, input.listingId))) return { kind: "not_found" };

      if (!(await activeListingActor(transaction, input.actorUserId))) {
        return { kind: "actor_unavailable" };
      }
      const current = await transaction.listing.findUnique({
        where: { id: input.listingId },
        select: {
          id: true,
          type: true,
          ownerId: true,
          organizationId: true,
          status: true,
          moderationStatus: true,
          publishedAt: true,
          expiresAt: true,
          deletedAt: true,
          updatedAt: true,
          version: true,
          revisions: {
            orderBy: [{ revisionNumber: "desc" }],
            take: 1,
            select: { revisionNumber: true, snapshot: true },
          },
        },
      });
      if (!current || current.deletedAt !== null) return { kind: "not_found" };
      const authorized = current.organizationId
        ? await activeListingOrganizationWriter(
            transaction,
            input.actorUserId,
            current.organizationId,
          )
        : current.ownerId === input.actorUserId;
      if (!authorized) return { kind: "not_found" };
      if (current.version !== input.expectedVersion) {
        return { kind: "version_conflict", currentVersion: current.version };
      }
      if (
        current.status !== ContentStatus.PUBLISHED ||
        (current.moderationStatus !== ModerationStatus.APPROVED &&
          current.moderationStatus !== ModerationStatus.AUTO_APPROVED) ||
        !current.publishedAt ||
        !current.expiresAt ||
        current.expiresAt <= input.occurredAt
      ) {
        return { kind: "state_conflict", currentVersion: current.version };
      }
      if (input.occurredAt < current.updatedAt) {
        return { kind: "time_conflict", currentVersion: current.version };
      }
      if (
        !listingVerticalDetailsMatchType(current.type, input) ||
        !(await listingReferencesRemainValid(transaction, current.type, input))
      ) {
        return { kind: "invalid_reference" };
      }
      if (
        !(await validateReadyListingMediaBindings(transaction, {
          actorUserId: input.actorUserId,
          listingId: input.listingId,
          mediaIds: input.mediaIds,
        }))
      ) {
        return { kind: "invalid_media" };
      }

      const major = input.classification === ListingRevisionClassification.MAJOR_EDIT;
      const resultVersion = input.expectedVersion + 1;
      const resultContentStatus = major ? ContentStatus.SUBMITTED : ContentStatus.PUBLISHED;
      const effectiveRiskTier =
        major && input.riskTier === ModerationRiskTier.LOW
          ? ModerationRiskTier.MEDIUM
          : input.riskTier;
      const resultModerationStatus = major
        ? effectiveRiskTier === ModerationRiskTier.HIGH
          ? ModerationStatus.ESCALATED
          : ModerationStatus.PENDING_REVIEW
        : current.moderationStatus;

      const evaluation = await transaction.moderationEvaluation.create({
        data: {
          listingId: input.listingId,
          actorUserId: input.actorUserId,
          listingVersion: input.expectedVersion,
          ruleSetKey: input.ruleSetKey,
          ruleSetVersion: input.ruleSetVersion,
          riskTier: effectiveRiskTier,
          inputHash: input.inputHash,
          idempotencyKey: input.idempotencyKey,
          requestHash: input.requestHash,
          previousContentStatus: current.status,
          previousModerationStatus: current.moderationStatus,
          resultContentStatus,
          resultModerationStatus,
          resultListingVersion: resultVersion,
          occurredAt: input.occurredAt,
          ruleHits: {
            create: input.hits.map((hit) => ({
              ruleCode: hit.ruleCode,
              ruleVersion: hit.ruleVersion,
              severity: hit.severity,
              evidenceKey: hit.evidenceKey,
            })),
          },
        },
        select: { id: true },
      });

      const revision = await transaction.listingRevision.create({
        data: {
          listingId: input.listingId,
          actorUserId: input.actorUserId,
          evaluationId: evaluation.id,
          revisionNumber: (current.revisions[0]?.revisionNumber ?? 0) + 1,
          baseListingVersion: input.expectedVersion,
          resultListingVersion: resultVersion,
          classification: input.classification,
          reasonCodes: [...input.reasonCodes],
          snapshot: asJsonObject(input.snapshot),
          snapshotHash: hashJson(input.snapshot),
          diff: asJsonArray(input.diff),
          diffHash: hashJson(input.diff),
          riskTier: effectiveRiskTier,
          ruleSetKey: input.ruleSetKey,
          ruleSetVersion: input.ruleSetVersion,
          idempotencyKey: input.idempotencyKey,
          requestHash: input.requestHash,
          originalPublishedAt: current.publishedAt,
          originalExpiresAt: current.expiresAt,
          createdAt: input.occurredAt,
        },
        select: { id: true },
      });

      const changed = await transaction.listing.updateMany({
        where: {
          id: input.listingId,
          version: input.expectedVersion,
          status: ContentStatus.PUBLISHED,
          moderationStatus: current.moderationStatus,
          deletedAt: null,
        },
        data: {
          ...listingWriteData(input),
          status: resultContentStatus,
          moderationStatus: resultModerationStatus,
          publishedAt: major ? null : current.publishedAt,
          expiresAt: major ? null : current.expiresAt,
          version: resultVersion,
          updatedAt: input.occurredAt,
        },
      });
      if (changed.count !== 1) throw new Error("Locked Listing changed during revision");
      await applyListingVerticalDetails(transaction, input.listingId, input);
      await applyListingMediaBindings(transaction, {
        actorUserId: input.actorUserId,
        listingId: input.listingId,
        mediaIds: input.mediaIds,
      });

      let moderationCaseId: string | null = null;
      if (major) {
        const moderationCase = await transaction.moderationCase.create({
          data: {
            evaluationId: evaluation.id,
            targetType: "LISTING",
            targetId: input.listingId,
            queue: "listing-submission",
            priority: effectiveRiskTier === ModerationRiskTier.HIGH ? 80 : 50,
            createdAt: input.occurredAt,
            updatedAt: input.occurredAt,
          },
          select: { id: true },
        });
        moderationCaseId = moderationCase.id;
        const snapshot = caseSnapshot({
          listingId: input.listingId,
          listingVersion: resultVersion,
          listingType: current.type,
          snapshot: input.snapshot,
          previous: current.revisions[0]?.snapshot ?? null,
          revisionId: revision.id,
          classification: input.classification,
          reasonCodes: input.reasonCodes,
          originalPublishedAt: current.publishedAt,
          originalExpiresAt: current.expiresAt,
          capturedAt: input.occurredAt,
        });
        await transaction.moderationCaseSnapshot.create({
          data: {
            caseId: moderationCase.id,
            listingVersion: resultVersion,
            snapshot,
            snapshotHash: hashJson(snapshot),
            capturedAt: input.occurredAt,
          },
        });
      }

      await transaction.auditLog.create({
        data: {
          actorId: input.actorUserId,
          actorType: "USER",
          action: major ? "listing.revision.submitted" : "listing.revision.applied",
          targetType: "LISTING",
          targetId: input.listingId,
          requestId: input.requestId,
          metadata: {
            revisionId: revision.id,
            classification: input.classification,
            reasonCodes: input.reasonCodes,
            baseVersion: input.expectedVersion,
            resultVersion,
            riskTier: effectiveRiskTier,
            caseId: moderationCaseId,
          },
        },
      });
      await transaction.outboxEvent.create({
        data: {
          aggregateType: "LISTING",
          aggregateId: input.listingId,
          eventType: major
            ? effectiveRiskTier === ModerationRiskTier.HIGH
              ? "listing.moderation.escalated"
              : "listing.submitted"
            : "listing.revised",
          payload: {
            schemaVersion: 1,
            aggregateVersion: resultVersion,
            listingId: input.listingId,
            type: current.type,
            previousStatus: current.status,
            currentStatus: resultContentStatus,
            previousModerationStatus: current.moderationStatus,
            currentModerationStatus: resultModerationStatus,
            reasonCode: input.reasonCodes[0],
            evaluationId: evaluation.id,
            revisionId: revision.id,
            ruleSetKey: input.ruleSetKey,
            ruleSetVersion: input.ruleSetVersion,
            riskTier: effectiveRiskTier,
            caseId: moderationCaseId,
          },
        },
      });

      const listing = await new ListingRepository(transaction).findByIdForOwner({
        actorUserId: input.actorUserId,
        listingId: input.listingId,
        now: input.occurredAt,
      });
      if (!listing) throw new Error("Revised Listing could not be projected");
      const projectedRevision = listing.latestRevision;
      if (!projectedRevision || projectedRevision.id !== revision.id) {
        throw new Error("Revised Listing evidence could not be projected");
      }
      return { kind: "revised", listing, revision: projectedRevision };
    });
  }

  close(): Promise<void> {
    return this.#ownedClient?.$disconnect() ?? Promise.resolve();
  }

  #inTransaction<T>(operation: (transaction: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    if (this.#ownedClient) {
      return this.#ownedClient.$transaction(operation, {
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      });
    }
    return operation(this.#client as Prisma.TransactionClient);
  }
}
