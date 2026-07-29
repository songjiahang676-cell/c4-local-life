import { PrismaPg } from "@prisma/adapter-pg";
import {
  ContentStatus,
  MembershipRole,
  ModerationRiskTier,
  ModerationStatus,
  Prisma,
  PrismaClient,
  UserStatus,
  type ListingType,
  type PriceUnit,
} from "../../generated/prisma/client";

export type ListingSubmissionRepositoryOptions = {
  connectionString: string;
  poolMaximum?: number;
};

export type ListingSubmissionCandidate = {
  id: string;
  type: ListingType;
  ownerId: string;
  organizationId: string | null;
  status: ContentStatus;
  moderationStatus: ModerationStatus;
  title: string;
  summary: string | null;
  body: string;
  priceAmount: string | null;
  priceUnit: PriceUnit | null;
  formSchemaDefinition: unknown;
  actorCreatedAt: Date;
  publishedAt: Date | null;
  expiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  version: number;
};

export type ListingSubmissionTransitionEvidence = {
  eventType: "listing.submitted" | "listing.published" | "listing.moderation.escalated";
  previousStatus: ContentStatus;
  currentStatus: ContentStatus;
  previousModerationStatus: ModerationStatus;
  currentModerationStatus: ModerationStatus;
  aggregateVersion: number;
  reasonCode: string;
};

export type ListingSubmissionDecision = {
  contentStatus: ContentStatus;
  moderationStatus: ModerationStatus;
  publishedAt: Date | null;
  expiresAt: Date | null;
  resultVersion: number;
  transitions: readonly ListingSubmissionTransitionEvidence[];
};

export type ListingSubmissionRuleHitInput = {
  ruleCode: string;
  ruleVersion: number;
  severity: Exclude<ModerationRiskTier, "LOW">;
  evidenceKey: string;
};

export type SubmitListingInput = {
  actorUserId: string;
  listingId: string;
  expectedVersion: number;
  idempotencyKey: string;
  requestHash: string;
  requestId: string;
  occurredAt: Date;
  inputHash: string;
  ruleSetKey: string;
  ruleSetVersion: number;
  riskTier: ModerationRiskTier;
  hits: readonly ListingSubmissionRuleHitInput[];
  decision: ListingSubmissionDecision;
};

export type ListingSubmissionProjection = {
  resourceId: string;
  previousStatus: ContentStatus;
  currentStatus: ContentStatus;
  previousModerationStatus: ModerationStatus;
  currentModerationStatus: ModerationStatus;
  riskTier: ModerationRiskTier;
  ruleSetVersion: number;
  caseId: string | null;
  occurredAt: Date;
  version: number;
};

export type FindListingSubmissionRetryInput = {
  actorUserId: string;
  idempotencyKey: string;
  requestHash: string;
};

export type FindListingSubmissionRetryResult =
  | { kind: "exact_retry"; submission: ListingSubmissionProjection }
  | { kind: "conflict" | "missing" };

export type SubmitListingResult =
  | { kind: "submitted" | "exact_retry"; submission: ListingSubmissionProjection }
  | {
      kind:
        | "actor_unavailable"
        | "idempotency_conflict"
        | "not_found"
        | "state_conflict"
        | "time_conflict"
        | "version_conflict";
      currentVersion?: number;
    };

type ListingSubmissionClient = PrismaClient | Prisma.TransactionClient;

const organizationListingRoles = [
  MembershipRole.OWNER,
  MembershipRole.ADMIN,
  MembershipRole.EDITOR,
] as const;

function isRepositoryOptions(
  target: ListingSubmissionClient | ListingSubmissionRepositoryOptions,
): target is ListingSubmissionRepositoryOptions {
  return "connectionString" in target;
}

async function lockIdempotencyKey(
  transaction: Prisma.TransactionClient,
  actorUserId: string,
  idempotencyKey: string,
): Promise<void> {
  await transaction.$executeRaw(
    Prisma.sql`SELECT pg_advisory_xact_lock(
      hashtextextended(${"listing-submit-v1"} || ':' || ${actorUserId} || ':' || ${idempotencyKey}, 0)
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

async function activeOrganizationWriter(
  transaction: Prisma.TransactionClient,
  actorUserId: string,
  organizationId: string,
): Promise<boolean> {
  const membership = await transaction.organizationMembership.findFirst({
    where: {
      organizationId,
      userId: actorUserId,
      role: { in: [...organizationListingRoles] },
      organization: { status: UserStatus.ACTIVE, deletedAt: null },
      user: { status: UserStatus.ACTIVE, deletedAt: null },
    },
    select: { userId: true },
  });
  return membership !== null;
}

function projectionFromEvaluation(input: {
  listingId: string;
  ruleSetVersion: number;
  riskTier: ModerationRiskTier;
  resultContentStatus: ContentStatus;
  resultModerationStatus: ModerationStatus;
  resultListingVersion: number;
  occurredAt: Date;
  moderationCase: { id: string } | null;
}): ListingSubmissionProjection {
  return {
    resourceId: input.listingId,
    previousStatus: ContentStatus.DRAFT,
    currentStatus: input.resultContentStatus,
    previousModerationStatus: ModerationStatus.NOT_REVIEWED,
    currentModerationStatus: input.resultModerationStatus,
    riskTier: input.riskTier,
    ruleSetVersion: input.ruleSetVersion,
    caseId: input.moderationCase?.id ?? null,
    occurredAt: input.occurredAt,
    version: input.resultListingVersion,
  };
}

async function findRetry(
  client: ListingSubmissionClient,
  input: FindListingSubmissionRetryInput,
): Promise<FindListingSubmissionRetryResult> {
  const evaluation = await client.moderationEvaluation.findUnique({
    where: {
      actorUserId_idempotencyKey: {
        actorUserId: input.actorUserId,
        idempotencyKey: input.idempotencyKey,
      },
    },
    select: {
      listingId: true,
      requestHash: true,
      ruleSetVersion: true,
      riskTier: true,
      resultContentStatus: true,
      resultModerationStatus: true,
      resultListingVersion: true,
      occurredAt: true,
      moderationCase: { select: { id: true } },
    },
  });
  if (!evaluation) return { kind: "missing" };
  return evaluation.requestHash === input.requestHash
    ? { kind: "exact_retry", submission: projectionFromEvaluation(evaluation) }
    : { kind: "conflict" };
}

export class ListingSubmissionRepository {
  readonly #client: ListingSubmissionClient;
  readonly #ownedClient: PrismaClient | null;

  constructor(target: ListingSubmissionClient | ListingSubmissionRepositoryOptions) {
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

  findRetry(input: FindListingSubmissionRetryInput): Promise<FindListingSubmissionRetryResult> {
    return findRetry(this.#client, input);
  }

  async findCandidate(input: {
    actorUserId: string;
    listingId: string;
  }): Promise<ListingSubmissionCandidate | null> {
    const actor = await this.#client.user.findFirst({
      where: { id: input.actorUserId, status: UserStatus.ACTIVE, deletedAt: null },
      select: { createdAt: true },
    });
    if (!actor) return null;
    const listing = await this.#client.listing.findFirst({
      where: {
        id: input.listingId,
        deletedAt: null,
        OR: [
          { ownerId: input.actorUserId, organizationId: null },
          {
            organization: {
              memberships: {
                some: {
                  userId: input.actorUserId,
                  role: { in: [...organizationListingRoles] },
                },
              },
            },
          },
        ],
      },
      select: {
        id: true,
        type: true,
        ownerId: true,
        organizationId: true,
        status: true,
        moderationStatus: true,
        title: true,
        summary: true,
        body: true,
        priceAmount: true,
        priceUnit: true,
        categoryId: true,
        formSchemaVersion: true,
        publishedAt: true,
        expiresAt: true,
        createdAt: true,
        updatedAt: true,
        version: true,
      },
    });
    if (!listing) return null;
    const formSchema = await this.#client.categoryFormSchemaVersion.findUnique({
      where: {
        categoryId_version: {
          categoryId: listing.categoryId,
          version: listing.formSchemaVersion,
        },
      },
      select: { definition: true, publishedAt: true },
    });
    if (!formSchema?.publishedAt) return null;
    return {
      id: listing.id,
      type: listing.type,
      ownerId: listing.ownerId,
      organizationId: listing.organizationId,
      status: listing.status,
      moderationStatus: listing.moderationStatus,
      title: listing.title,
      summary: listing.summary,
      body: listing.body,
      priceAmount: listing.priceAmount?.toFixed(2) ?? null,
      priceUnit: listing.priceUnit,
      formSchemaDefinition: formSchema.definition,
      actorCreatedAt: actor.createdAt,
      publishedAt: listing.publishedAt,
      expiresAt: listing.expiresAt,
      createdAt: listing.createdAt,
      updatedAt: listing.updatedAt,
      version: listing.version,
    };
  }

  submit(input: SubmitListingInput): Promise<SubmitListingResult> {
    return this.#inTransaction(async (transaction) => {
      await lockIdempotencyKey(transaction, input.actorUserId, input.idempotencyKey);
      const retry = await findRetry(transaction, input);
      if (retry.kind === "exact_retry") return retry;
      if (retry.kind === "conflict") return { kind: "idempotency_conflict" };
      if (!(await lockListing(transaction, input.listingId))) return { kind: "not_found" };

      const actor = await transaction.user.findFirst({
        where: { id: input.actorUserId, status: UserStatus.ACTIVE, deletedAt: null },
        select: { id: true },
      });
      if (!actor) return { kind: "actor_unavailable" };
      const current = await transaction.listing.findUnique({
        where: { id: input.listingId },
        select: {
          id: true,
          type: true,
          ownerId: true,
          organizationId: true,
          status: true,
          moderationStatus: true,
          deletedAt: true,
          updatedAt: true,
          version: true,
        },
      });
      if (!current || current.deletedAt !== null) return { kind: "not_found" };
      const authorized = current.organizationId
        ? await activeOrganizationWriter(transaction, input.actorUserId, current.organizationId)
        : current.ownerId === input.actorUserId;
      if (!authorized) return { kind: "not_found" };
      if (current.version !== input.expectedVersion) {
        return { kind: "version_conflict", currentVersion: current.version };
      }
      if (
        current.status !== ContentStatus.DRAFT ||
        current.moderationStatus !== ModerationStatus.NOT_REVIEWED
      ) {
        return { kind: "state_conflict", currentVersion: current.version };
      }
      if (input.occurredAt < current.updatedAt) {
        return { kind: "time_conflict", currentVersion: current.version };
      }

      const evaluation = await transaction.moderationEvaluation.create({
        data: {
          listingId: input.listingId,
          actorUserId: input.actorUserId,
          listingVersion: input.expectedVersion,
          ruleSetKey: input.ruleSetKey,
          ruleSetVersion: input.ruleSetVersion,
          riskTier: input.riskTier,
          inputHash: input.inputHash,
          idempotencyKey: input.idempotencyKey,
          requestHash: input.requestHash,
          resultContentStatus: input.decision.contentStatus,
          resultModerationStatus: input.decision.moderationStatus,
          resultListingVersion: input.decision.resultVersion,
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
      const changed = await transaction.listing.updateMany({
        where: {
          id: input.listingId,
          version: input.expectedVersion,
          status: ContentStatus.DRAFT,
          moderationStatus: ModerationStatus.NOT_REVIEWED,
          deletedAt: null,
        },
        data: {
          status: input.decision.contentStatus,
          moderationStatus: input.decision.moderationStatus,
          publishedAt: input.decision.publishedAt,
          expiresAt: input.decision.expiresAt,
          updatedAt: input.occurredAt,
          version: input.decision.resultVersion,
        },
      });
      if (changed.count !== 1) {
        throw new Error("Locked Listing changed during submission");
      }

      const moderationCase =
        input.riskTier === ModerationRiskTier.LOW
          ? null
          : await transaction.moderationCase.create({
              data: {
                evaluationId: evaluation.id,
                targetType: "LISTING",
                targetId: input.listingId,
                queue: "listing-submission",
                priority: input.riskTier === ModerationRiskTier.HIGH ? 80 : 50,
                createdAt: input.occurredAt,
                updatedAt: input.occurredAt,
              },
              select: { id: true },
            });

      await transaction.auditLog.create({
        data: {
          actorId: input.actorUserId,
          actorType: "USER",
          action: "listing.submission.evaluated",
          targetType: "LISTING",
          targetId: input.listingId,
          requestId: input.requestId,
          metadata: {
            evaluationId: evaluation.id,
            ruleSetKey: input.ruleSetKey,
            ruleSetVersion: input.ruleSetVersion,
            riskTier: input.riskTier,
            ruleCodes: input.hits.map((hit) => hit.ruleCode),
            resultVersion: input.decision.resultVersion,
            caseId: moderationCase?.id ?? null,
          },
        },
      });
      for (const transition of input.decision.transitions) {
        await transaction.outboxEvent.create({
          data: {
            aggregateType: "LISTING",
            aggregateId: input.listingId,
            eventType: transition.eventType,
            payload: {
              schemaVersion: 1,
              aggregateVersion: transition.aggregateVersion,
              listingId: input.listingId,
              type: current.type,
              previousStatus: transition.previousStatus,
              currentStatus: transition.currentStatus,
              previousModerationStatus: transition.previousModerationStatus,
              currentModerationStatus: transition.currentModerationStatus,
              reasonCode: transition.reasonCode,
              evaluationId: evaluation.id,
              ruleSetKey: input.ruleSetKey,
              ruleSetVersion: input.ruleSetVersion,
              riskTier: input.riskTier,
              caseId: moderationCase?.id ?? null,
            },
          },
        });
      }
      return {
        kind: "submitted",
        submission: {
          resourceId: input.listingId,
          previousStatus: ContentStatus.DRAFT,
          currentStatus: input.decision.contentStatus,
          previousModerationStatus: ModerationStatus.NOT_REVIEWED,
          currentModerationStatus: input.decision.moderationStatus,
          riskTier: input.riskTier,
          ruleSetVersion: input.ruleSetVersion,
          caseId: moderationCase?.id ?? null,
          occurredAt: input.occurredAt,
          version: input.decision.resultVersion,
        },
      };
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
