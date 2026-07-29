import { describe, expect, it } from "vitest";
import { parseApiEnvironment } from "@socal/config";
import type { CreateListingInput } from "@socal/contracts";
import {
  activeUserPermissions,
  type PolicyRequestContext,
} from "../src/common/authorization/policy";
import { createPolicyService } from "../src/common/authorization/authorization.module";
import {
  ListingCursorError,
  ListingIdempotencyConflictError,
  ListingsService,
} from "../src/modules/listings/listings.service";
import { TaxonomyService } from "../src/modules/taxonomy/taxonomy.service";
import {
  createMemoryListingTaxonomyStore,
  MemoryListingStore,
  memoryJobCategoryId,
  memoryListingCategoryId,
  memoryListingRegionCode,
  memorySecondhandCategoryId,
  memoryServiceCategoryId,
  memoryTransferCategoryId,
} from "./support/memory-listing.store";

const ownerId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const environment = parseApiEnvironment({
  NODE_ENV: "test",
  APP_ENV: "test",
  APP_NAME: "socal-api-listing-service-test",
  PUBLIC_WEB_URL: "http://web.example.invalid",
  PUBLIC_ADMIN_URL: "http://admin.example.invalid",
  DATABASE_URL: "postgresql://example.invalid/socal",
  REDIS_URL: "redis://localhost:6379/0",
  OPENSEARCH_NODE: "http://localhost:9200",
  SESSION_SECRET: "listing-service-session-secret-with-more-than-32-bytes",
  OTP_SECRET: "listing-service-otp-secret-with-more-than-32-bytes",
  MFA_SECRET: "listing-service-mfa-secret-with-more-than-32-bytes",
  PASSWORD_PEPPER: "listing-service-password-pepper-with-more-than-32-bytes",
  CSRF_SECRET: "listing-service-csrf-secret-with-more-than-32-bytes",
});

function ownerContext(method = "POST"): PolicyRequestContext {
  return {
    requestId: "req-listing-service",
    method,
    route: "/v1/listings",
    actor: {
      kind: "authenticated",
      userId: ownerId,
      sessionId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      accountStatus: "ACTIVE",
      verificationBadges: [],
      permissions: [...activeUserPermissions],
      platformRoles: [],
      authenticationStrength: "PRIMARY",
      mfaVerifiedAt: null,
      recentMfa: false,
      organizations: [],
    },
  };
}

function createInput(title = "Irvine two-bedroom rental"): CreateListingInput {
  return {
    type: "RENTAL" as const,
    categoryId: memoryListingCategoryId,
    locale: "zh-Hans" as const,
    title,
    body: "A deliberately fictional listing body for a foundation test.",
    regionCode: memoryListingRegionCode,
    attributes: {},
    mediaIds: [],
    contactMode: "IN_APP" as const,
  };
}

const validJobAttributes = {
  employerName: "Synthetic Employer",
  employmentType: "full-time",
  experienceLevel: "entry",
  remoteType: "onsite",
  wageMax: "31.50",
  schedule: "Weekday test schedule",
  employmentPolicyAcknowledged: true,
} as const;

function createJobInput(overrides: Partial<CreateListingInput> = {}): CreateListingInput {
  return {
    type: "JOB",
    categoryId: memoryJobCategoryId,
    locale: "zh-Hans",
    title: "Synthetic Irvine kitchen position",
    body: "A deliberately fictional Job listing used only for deterministic tests.",
    regionCode: memoryListingRegionCode,
    price: { amount: "24.00", currency: "USD", unit: "HOURLY" },
    attributes: { ...validJobAttributes },
    mediaIds: [],
    contactMode: "IN_APP",
    ...overrides,
  };
}

function createRemainingVerticalInput(
  type: "TRANSFER" | "SECONDHAND" | "SERVICE",
): CreateListingInput {
  if (type === "TRANSFER") {
    return {
      type,
      categoryId: memoryTransferCategoryId,
      locale: "zh-Hans",
      title: "Synthetic Irvine retail transfer",
      body: "A deliberately fictional transfer used only for deterministic policy tests.",
      regionCode: memoryListingRegionCode,
      price: { amount: "125000.00", currency: "USD", unit: "FIXED" },
      attributes: {
        businessType: "retail",
        monthlyRent: "2500.00",
        leaseRemainingMonths: 24,
        reasonForTransfer: "Synthetic owner relocation",
        financialDisclaimerAcknowledged: true,
      },
      mediaIds: [],
      contactMode: "IN_APP",
    };
  }
  if (type === "SECONDHAND") {
    return {
      type,
      categoryId: memorySecondhandCategoryId,
      locale: "zh-Hans",
      title: "Synthetic Irvine wooden table",
      body: "A deliberately fictional secondhand item used only for deterministic policy tests.",
      regionCode: memoryListingRegionCode,
      price: { amount: null, currency: "USD", unit: "NEGOTIABLE" },
      attributes: {
        condition: "good",
        deliveryOptions: ["pickup"],
        marketplacePolicyAcknowledged: true,
      },
      mediaIds: [],
      contactMode: "IN_APP",
    };
  }
  return {
    type,
    categoryId: memoryServiceCategoryId,
    locale: "zh-Hans",
    title: "Synthetic Irvine home cleaning",
    body: "A deliberately fictional local service used only for deterministic policy tests.",
    regionCode: memoryListingRegionCode,
    price: { amount: "95.00", currency: "USD", unit: "HOURLY" },
    attributes: {
      serviceRadiusMiles: 20,
      availability: ["weekdays"],
      servicePolicyAcknowledged: true,
    },
    mediaIds: [],
    contactMode: "IN_APP",
  };
}

function createService(): { service: ListingsService; store: MemoryListingStore } {
  const store = new MemoryListingStore();
  const service = new ListingsService(
    environment,
    store,
    new TaxonomyService(createMemoryListingTaxonomyStore()),
    createPolicyService(),
  );
  return { service, store };
}

describe("ListingsService", () => {
  it("creates exactly one draft for an exact idempotent retry", async () => {
    const { service, store } = createService();
    const first = await service.create(ownerContext(), "create-draft-0001", createInput());
    const retry = await service.create(ownerContext(), "create-draft-0001", createInput());

    expect(first.data.id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(first.data.status).toBe("DRAFT");
    expect(retry).toEqual(first);
    expect(store.auditActions).toEqual(["listing.draft.created"]);
    expect(store.outboxEvents).toEqual(["listing.draft.created"]);
    await expect(
      service.create(ownerContext(), "create-draft-0001", createInput("Changed title")),
    ).rejects.toBeInstanceOf(ListingIdempotencyConflictError);
  });

  it("increments a draft version and rejects a stale conditional update", async () => {
    const { service, store } = createService();
    const created = await service.create(ownerContext(), "create-draft-0002", createInput());
    const updated = await service.update(ownerContext("PATCH"), created.data.id, 1, {
      title: "Updated rental title",
    });

    expect(updated.data).toMatchObject({
      id: created.data.id,
      title: "Updated rental title",
      version: 2,
    });
    expect(store.auditActions).toEqual(["listing.draft.created", "listing.draft.updated"]);
    await expect(
      service.update(ownerContext("PATCH"), created.data.id, 1, { title: "Stale title" }),
    ).rejects.toMatchObject({ currentVersion: 2 });
  });

  it("auto-publishes a low-risk submission exactly once", async () => {
    const { service, store } = createService();
    const created = await service.create(ownerContext(), "create-draft-0003", createInput());
    const submitted = await service.submit(
      ownerContext(),
      created.data.id,
      1,
      "submit-listing-0001",
    );
    const retried = await service.submit(ownerContext(), created.data.id, 1, "submit-listing-0001");

    expect(submitted).toMatchObject({
      data: {
        resourceId: created.data.id,
        previousStatus: "DRAFT",
        currentStatus: "PUBLISHED",
        previousModerationStatus: "NOT_REVIEWED",
        currentModerationStatus: "AUTO_APPROVED",
        riskTier: "LOW",
        ruleSetVersion: 3,
        caseId: null,
        version: 3,
      },
    });
    expect(retried).toEqual(submitted);
    expect(store.auditActions).toEqual(["listing.draft.created", "listing.submission.evaluated"]);
    expect(store.outboxEvents).toEqual([
      "listing.draft.created",
      "listing.submitted",
      "listing.published",
    ]);
    await expect(
      service.submit(ownerContext(), created.data.id, 3, "submit-listing-0001"),
    ).rejects.toBeInstanceOf(ListingIdempotencyConflictError);
  });

  it("routes a sensitive attribute-only published edit to review without retaining its value", async () => {
    const { service } = createService();
    const created = await service.create(
      ownerContext(),
      "create-draft-sensitive-edit",
      createInput(),
    );
    await service.submit(ownerContext(), created.data.id, 1, "submit-sensitive-edit");

    const revised = await service.update(
      ownerContext("PATCH"),
      created.data.id,
      3,
      { attributes: { contactEmail: "private-owner@example.invalid" } },
      "published-sensitive-edit",
    );

    expect(revised.data).toMatchObject({
      status: "SUBMITTED",
      moderationStatus: "PENDING_REVIEW",
      version: 4,
      latestRevision: {
        classification: "MAJOR_EDIT",
        reasonCodes: ["ATTRIBUTES_CHANGED"],
        reviewState: "PENDING",
        riskTier: "MEDIUM",
        diff: [
          {
            field: "attributes",
            kind: "CHANGED",
            before: { changedKeys: ["contactEmail"] },
            after: { changedKeys: ["contactEmail"] },
          },
        ],
      },
    });
    expect(JSON.stringify(revised.data.latestRevision)).not.toContain(
      "private-owner@example.invalid",
    );
  });

  it("escalates a high-risk submission into a moderation case", async () => {
    const { service } = createService();
    const created = await service.create(
      ownerContext(),
      "create-draft-0004",
      createInput("Gift card required before viewing"),
    );
    const submitted = await service.submit(
      ownerContext(),
      created.data.id,
      1,
      "submit-listing-0002",
    );

    expect(submitted).toMatchObject({
      data: {
        currentStatus: "SUBMITTED",
        currentModerationStatus: "ESCALATED",
        riskTier: "HIGH",
        caseId: "77777777-7777-4777-8777-777777777777",
        version: 3,
      },
    });
  });

  it("runs the complete Job draft, publication, and public-list path", async () => {
    const { service } = createService();
    await expect(
      service.create(
        ownerContext(),
        "create-job-invalid-0001",
        createJobInput({
          attributes: {
            ...validJobAttributes,
            employmentPolicyAcknowledged: false,
          },
        }),
      ),
    ).rejects.toMatchObject({
      errors: { employmentPolicyAcknowledged: ["must be acknowledged"] },
    });
    await expect(
      service.create(
        ownerContext(),
        "create-job-invalid-0002",
        createJobInput({
          attributes: { ...validJobAttributes, wageMax: "20.00" },
        }),
      ),
    ).rejects.toMatchObject({
      errors: { wageMax: ["must be greater than or equal to wage minimum"] },
    });

    const created = await service.create(ownerContext(), "create-job-valid-0001", createJobInput());
    expect(created.data).toMatchObject({
      type: "JOB",
      status: "DRAFT",
      price: { amount: "24.00", unit: "HOURLY" },
      attributes: {
        employerName: "Synthetic Employer",
        wageMax: "31.50",
        employmentPolicyAcknowledged: true,
      },
    });

    const submitted = await service.submit(
      ownerContext(),
      created.data.id,
      1,
      "submit-job-valid-0001",
    );
    expect(submitted.data).toMatchObject({
      currentStatus: "PUBLISHED",
      currentModerationStatus: "AUTO_APPROVED",
      riskTier: "LOW",
      ruleSetVersion: 3,
    });

    const publicPage = await service.list({ type: "JOB", limit: 20 });
    expect(publicPage.data).toHaveLength(1);
    expect(publicPage.data[0]).toMatchObject({
      id: created.data.id,
      type: "JOB",
      status: "PUBLISHED",
      title: "Synthetic Irvine kitchen position",
    });
  });

  it("validates and submits Transfer, Secondhand, and Service through their policies", async () => {
    const { service } = createService();
    await expect(
      service.create(ownerContext(), "create-transfer-invalid-0001", {
        ...createRemainingVerticalInput("TRANSFER"),
        attributes: {
          ...createRemainingVerticalInput("TRANSFER").attributes,
          financialDisclaimerAcknowledged: false,
        },
      }),
    ).rejects.toMatchObject({
      errors: { financialDisclaimerAcknowledged: ["must be acknowledged"] },
    });

    const transfer = await service.create(
      ownerContext(),
      "create-transfer-valid-0001",
      createRemainingVerticalInput("TRANSFER"),
    );
    const transferSubmission = await service.submit(
      ownerContext(),
      transfer.data.id,
      1,
      "submit-transfer-valid-0001",
    );
    expect(transferSubmission.data).toMatchObject({
      currentStatus: "SUBMITTED",
      currentModerationStatus: "PENDING_REVIEW",
      riskTier: "MEDIUM",
      ruleSetVersion: 3,
    });

    for (const type of ["SECONDHAND", "SERVICE"] as const) {
      const created = await service.create(
        ownerContext(),
        `create-${type.toLowerCase()}-valid-0001`,
        createRemainingVerticalInput(type),
      );
      const submitted = await service.submit(
        ownerContext(),
        created.data.id,
        1,
        `submit-${type.toLowerCase()}-valid-0001`,
      );
      expect(submitted.data).toMatchObject({
        currentStatus: "PUBLISHED",
        currentModerationStatus: "AUTO_APPROVED",
        riskTier: "LOW",
        ruleSetVersion: 3,
      });
      const publicPage = await service.list({ type, limit: 20 });
      expect(publicPage.data).toEqual([
        expect.objectContaining({
          id: created.data.id,
          type,
          status: "PUBLISHED",
        }),
      ]);
    }
  });

  it("lists account buckets with bound cursors and applies a capped action per strong version", async () => {
    const { service, store } = createService();
    const firstDraft = await service.create(
      ownerContext(),
      "create-account-listing-0001",
      createInput("Account center draft alpha"),
    );
    const secondDraft = await service.create(
      ownerContext(),
      "create-account-listing-0002",
      createInput("Account center draft beta"),
    );
    const firstPage = await service.listMine(
      ownerContext("GET"),
      { bucket: "DRAFT", limit: 1 },
      new Date("2026-07-29T15:00:00.000Z"),
    );

    expect(firstPage.data).toHaveLength(1);
    expect(firstPage.counts).toEqual({
      draft: 2,
      pending: 0,
      published: 0,
      archived: 0,
    });
    expect(firstPage.page).toMatchObject({ hasMore: true });
    expect(firstPage.data[0]?.availableActions).toEqual(["EDIT", "SUBMIT", "DELETE"]);
    await expect(
      service.listMine(ownerContext("GET"), {
        bucket: "DRAFT",
        limit: 1,
        cursor: `${firstPage.page.nextCursor ?? ""}x`,
      }),
    ).rejects.toBeInstanceOf(ListingCursorError);

    await service.submit(
      ownerContext(),
      firstDraft.data.id,
      firstDraft.data.version,
      "submit-account-listing-0001",
    );
    const published = await service.listMine(ownerContext("GET"), {
      bucket: "PUBLISHED",
      limit: 20,
    });
    expect(published.data).toEqual([
      expect.objectContaining({
        id: firstDraft.data.id,
        bucket: "PUBLISHED",
        availableActions: ["ARCHIVE", "VIEW_REVISIONS"],
      }),
    ]);

    const batch = await service.batchManage(ownerContext(), {
      action: "ARCHIVE",
      items: [
        { listingId: firstDraft.data.id, version: 3 },
        { listingId: secondDraft.data.id, version: 1 },
      ],
    });
    expect(batch).toMatchObject({
      appliedCount: 1,
      data: [
        {
          listingId: firstDraft.data.id,
          outcome: "APPLIED",
          currentVersion: 4,
          currentBucket: "ARCHIVED",
        },
        {
          listingId: secondDraft.data.id,
          outcome: "STATE_CONFLICT",
          currentVersion: null,
          currentBucket: null,
        },
      ],
    });

    const deleted = await service.batchManage(ownerContext(), {
      action: "DELETE",
      items: [{ listingId: secondDraft.data.id, version: 1 }],
    });
    const exactRetry = await service.batchManage(ownerContext(), {
      action: "DELETE",
      items: [{ listingId: secondDraft.data.id, version: 1 }],
    });
    expect(deleted.appliedCount).toBe(1);
    expect(exactRetry.appliedCount).toBe(1);
    expect(store.auditActions.filter((action) => action === "listing.deleted")).toHaveLength(1);
  });
});
