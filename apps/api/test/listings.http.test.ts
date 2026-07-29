import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { parseApiEnvironment } from "@socal/config";
import type {
  BatchListingActionResponse,
  CreateListingInput,
  ListingCollection,
  ListingOwnerResponse,
  ListingRevisionCollection,
  ListingSubmissionResponse,
  MyListingCollection,
  ProblemDetails,
} from "@socal/contracts";
import { createObservabilityRuntime } from "@socal/observability";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApiApplication } from "../src/create-api-application";
import { AuthSessionService } from "../src/modules/auth/auth-session.service";
import { buildActiveSubject, MemoryAuthSessionStore } from "./support/memory-auth-session.store";
import {
  createMemoryListingTaxonomyStore,
  MemoryListingStore,
  memoryListingCategoryId,
  memoryListingRegionCode,
} from "./support/memory-listing.store";

const environment = parseApiEnvironment({
  NODE_ENV: "test",
  APP_ENV: "test",
  APP_NAME: "socal-api-listing-test",
  PUBLIC_WEB_URL: "http://web.example.invalid",
  PUBLIC_ADMIN_URL: "http://admin.example.invalid",
  DATABASE_URL: "postgresql://example.invalid/socal",
  REDIS_URL: "redis://localhost:6379/0",
  OPENSEARCH_NODE: "http://localhost:9200",
  SESSION_SECRET: "listing-session-secret-with-more-than-32-bytes",
  OTP_SECRET: "listing-otp-secret-with-more-than-32-bytes",
  MFA_SECRET: "listing-mfa-secret-with-more-than-32-bytes",
  PASSWORD_PEPPER: "listing-password-pepper-with-more-than-32-bytes",
  CSRF_SECRET: "listing-csrf-secret-with-more-than-32-bytes",
});

const ownerId = "10000000-0000-4000-8000-000000000001";
const outsiderId = "10000000-0000-4000-8000-000000000002";
const editorId = "10000000-0000-4000-8000-000000000003";
const billingId = "10000000-0000-4000-8000-000000000004";
const limitedId = "10000000-0000-4000-8000-000000000005";
const organizationId = "40000000-0000-4000-8000-000000000001";
const readyMediaId = "50000000-0000-4000-8000-000000000002";

function draftPayload(title = "Fictional Irvine rental"): CreateListingInput {
  return {
    type: "RENTAL",
    locale: "zh-Hans",
    categoryId: memoryListingCategoryId,
    regionCode: memoryListingRegionCode,
    title,
    summary: "Synthetic summary",
    body: "A deliberately fictional listing body used only for boundary tests.",
    price: { amount: "2450.00", currency: "USD", unit: "MONTHLY" },
    location: {
      precision: "APPROXIMATE",
      point: { latitude: 33.6846, longitude: -117.8265 },
    },
    attributes: {},
    mediaIds: [],
    contactMode: "IN_APP",
  };
}

describe("listing draft HTTP boundary", () => {
  let app: NestFastifyApplication;
  let server: FastifyInstance;
  let listingStore: MemoryListingStore;
  const cookies = new Map<string, string>();

  beforeAll(async () => {
    const authStore = new MemoryAuthSessionStore();
    listingStore = new MemoryListingStore();
    for (const [userId, status] of [
      [ownerId, "ACTIVE"],
      [outsiderId, "ACTIVE"],
      [editorId, "ACTIVE"],
      [billingId, "ACTIVE"],
      [limitedId, "LIMITED"],
    ] as const) {
      authStore.registerSubject(
        buildActiveSubject({
          id: userId,
          displayName: `Synthetic ${userId.slice(-1)}`,
          status,
        }),
      );
    }
    for (const [userId, role] of [
      [editorId, "EDITOR"],
      [billingId, "BILLING"],
    ] as const) {
      authStore.registerOrganization(userId, {
        id: organizationId,
        type: "MERCHANT",
        displayName: "Synthetic Listing Organization",
        slug: "synthetic-listing-organization",
        role,
      });
    }
    listingStore.registerOrganization(organizationId, {
      readers: [editorId, billingId],
      writers: [editorId],
    });
    listingStore.registerReadyMedia(readyMediaId);

    app = await createApiApplication(environment, {
      logger: false,
      authSessionStore: authStore,
      listingStore,
      taxonomyStore: createMemoryListingTaxonomyStore(),
      observability: createObservabilityRuntime({
        serviceName: "socal-api-listing-test",
        serviceVersion: "0.1.0",
        environment: "test",
        logSink: () => undefined,
      }),
    });
    await app.init();
    server = app.getHttpAdapter().getInstance();
    await server.ready();
    const sessions = app.get(AuthSessionService);
    for (const userId of [ownerId, outsiderId, editorId, billingId, limitedId]) {
      const session = await sessions.issueSession(userId, {});
      cookies.set(userId, `${environment.SESSION_COOKIE_NAME}=${session.token}`);
    }
  });

  afterAll(async () => {
    await app.close();
  });

  function mutationHeaders(
    userId: string,
    idempotencyKey?: string,
  ): {
    cookie: string | undefined;
    origin: string;
    "idempotency-key"?: string;
  } {
    return {
      cookie: cookies.get(userId),
      origin: environment.PUBLIC_WEB_URL,
      ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
    };
  }

  it("creates one safe owner draft and returns the exact idempotent retry", async () => {
    const headers = mutationHeaders(ownerId, "listing-create-personal-0001");
    const created = await server.inject({
      method: "POST",
      url: "/v1/listings",
      headers,
      payload: draftPayload(),
    });
    const retried = await server.inject({
      method: "POST",
      url: "/v1/listings",
      headers,
      payload: draftPayload(),
    });
    const response = created.json<ListingOwnerResponse>();

    expect(created.statusCode).toBe(201);
    expect(created.headers.etag).toBe('"listing-v1"');
    expect(created.headers.location).toBe(`/v1/listings/${response.data.id}`);
    expect(created.headers["cache-control"]).toBe("no-store");
    expect(retried.statusCode).toBe(201);
    expect(retried.json()).toEqual(response);
    expect(response.data).toMatchObject({
      type: "RENTAL",
      status: "DRAFT",
      moderationStatus: "NOT_REVIEWED",
      title: "Fictional Irvine rental",
      version: 1,
      owner: { id: ownerId },
      organization: null,
      contactMode: "IN_APP",
    });
    expect(JSON.stringify(response)).not.toMatch(
      /idempotency|requestHash|createRequestHash|email|phone/i,
    );
    expect(listingStore.auditActions).toEqual(["listing.draft.created"]);
    expect(listingStore.outboxEvents).toEqual(["listing.draft.created"]);

    const conflict = await server.inject({
      method: "POST",
      url: "/v1/listings",
      headers,
      payload: draftPayload("Changed request under the same key"),
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json<ProblemDetails>()).toMatchObject({
      title: "Conflict",
      status: 409,
    });
    expect(listingStore.auditActions).toHaveLength(1);
  });

  it("keeps an unpublished personal draft owner-only", async () => {
    const created = await server.inject({
      method: "POST",
      url: "/v1/listings",
      headers: mutationHeaders(ownerId, "listing-create-personal-0002"),
      payload: draftPayload("Owner-only draft"),
    });
    const listingId = created.json<ListingOwnerResponse>().data.id;
    const ownerRead = await server.inject({
      method: "GET",
      url: `/v1/listings/${listingId}`,
      headers: { cookie: cookies.get(ownerId) },
    });
    const outsiderRead = await server.inject({
      method: "GET",
      url: `/v1/listings/${listingId}`,
      headers: { cookie: cookies.get(outsiderId) },
    });
    const guestRead = await server.inject({
      method: "GET",
      url: `/v1/listings/${listingId}`,
    });

    expect(ownerRead.statusCode).toBe(200);
    expect(ownerRead.headers.etag).toBe('"listing-v1"');
    expect(ownerRead.headers["cache-control"]).toBe("no-store");
    expect(ownerRead.json()).toMatchObject({
      data: { id: listingId, status: "DRAFT", contactMode: "IN_APP" },
    });
    expect(outsiderRead.statusCode).toBe(404);
    expect(guestRead.statusCode).toBe(404);
  });

  it("requires a strong current ETag and increments the version atomically", async () => {
    const created = await server.inject({
      method: "POST",
      url: "/v1/listings",
      headers: mutationHeaders(ownerId, "listing-create-personal-0003"),
      payload: draftPayload("Draft before update"),
    });
    const listingId = created.json<ListingOwnerResponse>().data.id;
    const missingPrecondition = await server.inject({
      method: "PATCH",
      url: `/v1/listings/${listingId}`,
      headers: mutationHeaders(ownerId),
      payload: { title: "No precondition" },
    });
    const updated = await server.inject({
      method: "PATCH",
      url: `/v1/listings/${listingId}`,
      headers: { ...mutationHeaders(ownerId), "if-match": '"listing-v1"' },
      payload: { title: "Conditionally updated draft", summary: null },
    });
    const stale = await server.inject({
      method: "PATCH",
      url: `/v1/listings/${listingId}`,
      headers: { ...mutationHeaders(ownerId), "if-match": '"listing-v1"' },
      payload: { title: "Stale update" },
    });

    expect(missingPrecondition.statusCode).toBe(400);
    expect(updated.statusCode).toBe(200);
    expect(updated.headers.etag).toBe('"listing-v2"');
    expect(updated.json()).toMatchObject({
      data: { id: listingId, title: "Conditionally updated draft", summary: null, version: 2 },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.headers.etag).toBe('"listing-v2"');
  });

  it("submits a low-risk draft with owner authorization and exact retry safety", async () => {
    const created = await server.inject({
      method: "POST",
      url: "/v1/listings",
      headers: mutationHeaders(ownerId, "listing-create-submit-0001"),
      payload: draftPayload("Low-risk submission boundary"),
    });
    const listingId = created.json<ListingOwnerResponse>().data.id;
    const missingPrecondition = await server.inject({
      method: "POST",
      url: `/v1/listings/${listingId}/submit`,
      headers: mutationHeaders(ownerId, "listing-submit-boundary-0001"),
    });
    const outsider = await server.inject({
      method: "POST",
      url: `/v1/listings/${listingId}/submit`,
      headers: {
        ...mutationHeaders(outsiderId, "listing-submit-boundary-0002"),
        "if-match": '"listing-v1"',
      },
    });
    const guest = await server.inject({
      method: "POST",
      url: `/v1/listings/${listingId}/submit`,
      headers: {
        origin: environment.PUBLIC_WEB_URL,
        "idempotency-key": "listing-submit-boundary-0003",
        "if-match": '"listing-v1"',
      },
    });
    const restricted = await server.inject({
      method: "POST",
      url: `/v1/listings/${listingId}/submit`,
      headers: {
        ...mutationHeaders(limitedId, "listing-submit-boundary-0004"),
        "if-match": '"listing-v1"',
      },
    });
    const headers = {
      ...mutationHeaders(ownerId, "listing-submit-boundary-0001"),
      "if-match": '"listing-v1"',
    };
    const submitted = await server.inject({
      method: "POST",
      url: `/v1/listings/${listingId}/submit`,
      headers,
    });
    const retried = await server.inject({
      method: "POST",
      url: `/v1/listings/${listingId}/submit`,
      headers,
    });
    const response = submitted.json<ListingSubmissionResponse>();
    const changedRetry = await server.inject({
      method: "POST",
      url: `/v1/listings/${listingId}/submit`,
      headers: { ...headers, "if-match": '"listing-v3"' },
    });

    expect(missingPrecondition.statusCode).toBe(400);
    expect(outsider.statusCode).toBe(404);
    expect(guest.statusCode).toBe(401);
    expect(restricted.statusCode).toBe(403);
    expect(submitted.statusCode).toBe(202);
    expect(submitted.headers.etag).toBe('"listing-v3"');
    expect(submitted.headers["cache-control"]).toBe("no-store");
    expect(response).toMatchObject({
      data: {
        resourceId: listingId,
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
    expect(JSON.stringify(response)).not.toMatch(/ruleCode|evidence|inputHash|requestHash/i);
    expect(retried.statusCode).toBe(202);
    expect(retried.json()).toEqual(response);
    expect(changedRetry.statusCode).toBe(409);
  });

  it("keeps minor published edits public and sends material edits through owner-visible review", async () => {
    const created = await server.inject({
      method: "POST",
      url: "/v1/listings",
      headers: mutationHeaders(ownerId, "listing-create-revision-0001"),
      payload: draftPayload("Published revision boundary"),
    });
    const listingId = created.json<ListingOwnerResponse>().data.id;
    const submitted = await server.inject({
      method: "POST",
      url: `/v1/listings/${listingId}/submit`,
      headers: {
        ...mutationHeaders(ownerId, "listing-submit-revision-0001"),
        "if-match": '"listing-v1"',
      },
    });
    expect(submitted.statusCode).toBe(202);

    const missingIdempotency = await server.inject({
      method: "PATCH",
      url: `/v1/listings/${listingId}`,
      headers: { ...mutationHeaders(ownerId), "if-match": '"listing-v3"' },
      payload: { title: "Published revision boundary!" },
    });
    expect(missingIdempotency.statusCode).toBe(422);

    const minorHeaders = {
      ...mutationHeaders(ownerId, "listing-edit-revision-minor-0001"),
      "if-match": '"listing-v3"',
    };
    const minor = await server.inject({
      method: "PATCH",
      url: `/v1/listings/${listingId}`,
      headers: minorHeaders,
      payload: { title: "Published revision boundary!" },
    });
    const minorRetry = await server.inject({
      method: "PATCH",
      url: `/v1/listings/${listingId}`,
      headers: minorHeaders,
      payload: { title: "Published revision boundary!" },
    });
    expect(minor.statusCode).toBe(200);
    expect(minor.headers.etag).toBe('"listing-v4"');
    expect(minor.json<ListingOwnerResponse>()).toMatchObject({
      data: {
        status: "PUBLISHED",
        moderationStatus: "AUTO_APPROVED",
        latestRevision: {
          classification: "MINOR_EDIT",
          reasonCodes: ["MINOR_TEXT_EDIT"],
          reviewState: "NOT_REQUIRED",
        },
      },
    });
    expect(minorRetry.statusCode).toBe(200);
    expect(minorRetry.json()).toEqual(minor.json());

    const history = await server.inject({
      method: "GET",
      url: `/v1/listings/${listingId}/revisions?limit=1`,
      headers: { cookie: cookies.get(ownerId) },
    });
    const historyPage = history.json<ListingRevisionCollection>();
    expect(history.statusCode).toBe(200);
    expect(history.headers["cache-control"]).toBe("no-store");
    expect(historyPage.data).toHaveLength(1);
    expect(historyPage.data[0]).toMatchObject({
      classification: "MINOR_EDIT",
      reasonCodes: ["MINOR_TEXT_EDIT"],
    });
    expect(historyPage.page.hasMore).toBe(true);
    expect(JSON.stringify(historyPage)).not.toMatch(/snapshotHash|diffHash|requestHash/i);

    const ownerOnly = await server.inject({
      method: "GET",
      url: `/v1/listings/${listingId}/revisions`,
      headers: { cookie: cookies.get(outsiderId) },
    });
    expect(ownerOnly.statusCode).toBe(404);

    const major = await server.inject({
      method: "PATCH",
      url: `/v1/listings/${listingId}`,
      headers: {
        ...mutationHeaders(ownerId, "listing-edit-revision-major-0001"),
        "if-match": '"listing-v4"',
      },
      payload: { price: { amount: "2650.00", currency: "USD", unit: "MONTHLY" } },
    });
    expect(major.statusCode).toBe(200);
    expect(major.headers.etag).toBe('"listing-v5"');
    expect(major.json<ListingOwnerResponse>()).toMatchObject({
      data: {
        status: "SUBMITTED",
        moderationStatus: "PENDING_REVIEW",
        publishedAt: null,
        expiresAt: null,
        latestRevision: {
          classification: "MAJOR_EDIT",
          reasonCodes: ["PRICE_CHANGED"],
          reviewState: "PENDING",
        },
      },
    });
    const publicRead = await server.inject({
      method: "GET",
      url: `/v1/listings/${listingId}`,
    });
    expect(publicRead.statusCode).toBe(404);
  });

  it("binds only registered READY media and supports ordered removal on autosave", async () => {
    const created = await server.inject({
      method: "POST",
      url: "/v1/listings",
      headers: mutationHeaders(ownerId, "listing-create-ready-media-0001"),
      payload: {
        ...draftPayload("Draft with scanned media"),
        mediaIds: [readyMediaId],
      },
    });
    const listing = created.json<ListingOwnerResponse>();

    expect(created.statusCode).toBe(201);
    expect(listing.data.mediaIds).toEqual([readyMediaId]);

    const removed = await server.inject({
      method: "PATCH",
      url: `/v1/listings/${listing.data.id}`,
      headers: { ...mutationHeaders(ownerId), "if-match": '"listing-v1"' },
      payload: { mediaIds: [] },
    });
    expect(removed.statusCode).toBe(200);
    expect(removed.json<ListingOwnerResponse>().data.mediaIds).toEqual([]);
  });

  it("allows organization Editors to write and Billing members only to read", async () => {
    const created = await server.inject({
      method: "POST",
      url: "/v1/listings",
      headers: mutationHeaders(editorId, "listing-create-org-0001"),
      payload: { ...draftPayload("Organization draft"), organizationId },
    });
    const listingId = created.json<ListingOwnerResponse>().data.id;
    const billingRead = await server.inject({
      method: "GET",
      url: `/v1/listings/${listingId}`,
      headers: { cookie: cookies.get(billingId) },
    });
    const billingWrite = await server.inject({
      method: "PATCH",
      url: `/v1/listings/${listingId}`,
      headers: { ...mutationHeaders(billingId), "if-match": '"listing-v1"' },
      payload: { title: "Billing must not edit" },
    });
    const billingBatchWrite = await server.inject({
      method: "POST",
      url: "/v1/me/listings/actions",
      headers: mutationHeaders(billingId),
      payload: {
        action: "DELETE",
        items: [{ listingId, version: 1 }],
      },
    });
    const editorWrite = await server.inject({
      method: "PATCH",
      url: `/v1/listings/${listingId}`,
      headers: { ...mutationHeaders(editorId), "if-match": '"listing-v1"' },
      payload: { title: "Editor updated organization draft" },
    });
    const editorSubmit = await server.inject({
      method: "POST",
      url: `/v1/listings/${listingId}/submit`,
      headers: {
        ...mutationHeaders(editorId, "listing-submit-org-0001"),
        "if-match": '"listing-v2"',
      },
    });
    const editorArchive = await server.inject({
      method: "PUT",
      url: `/v1/listings/${listingId}/archive`,
      headers: { ...mutationHeaders(editorId), "if-match": '"listing-v4"' },
    });
    const billingArchiveRetry = await server.inject({
      method: "PUT",
      url: `/v1/listings/${listingId}/archive`,
      headers: { ...mutationHeaders(billingId), "if-match": '"listing-v4"' },
    });

    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      data: { organization: { id: organizationId }, owner: { id: editorId } },
    });
    expect(billingRead.statusCode).toBe(200);
    expect(billingWrite.statusCode).toBe(403);
    expect(billingBatchWrite.statusCode).toBe(200);
    expect(billingBatchWrite.json<BatchListingActionResponse>()).toMatchObject({
      appliedCount: 0,
      data: [
        {
          listingId,
          outcome: "NOT_FOUND",
          currentVersion: null,
          currentBucket: null,
        },
      ],
    });
    expect(editorWrite.statusCode).toBe(200);
    expect(editorWrite.headers.etag).toBe('"listing-v2"');
    expect(editorSubmit.statusCode).toBe(202);
    expect(editorSubmit.headers.etag).toBe('"listing-v4"');
    expect(editorArchive.statusCode).toBe(200);
    expect(editorArchive.headers.etag).toBe('"listing-v5"');
    expect(billingArchiveRetry.statusCode).toBe(403);
  });

  it("serves safe public summaries for every vertical through filter-bound signed cursors", async () => {
    const publishedIds: string[] = [];
    for (const [index, title] of ["Public rental alpha", "Public rental beta"].entries()) {
      const created = await server.inject({
        method: "POST",
        url: "/v1/listings",
        headers: mutationHeaders(ownerId, `listing-create-public-page-${index + 1}`),
        payload: draftPayload(title),
      });
      const listingId = created.json<ListingOwnerResponse>().data.id;
      const submitted = await server.inject({
        method: "POST",
        url: `/v1/listings/${listingId}/submit`,
        headers: {
          ...mutationHeaders(ownerId, `listing-submit-public-page-${index + 1}`),
          "if-match": '"listing-v1"',
        },
      });
      expect(submitted.statusCode).toBe(202);
      publishedIds.push(listingId);
    }

    const first = await server.inject({
      method: "GET",
      url: "/v1/listings?type=RENTAL&limit=1",
    });
    const firstPage = first.json<ListingCollection>();
    expect(first.statusCode).toBe(200);
    expect(first.headers["cache-control"]).toBe("public, max-age=30");
    expect(firstPage.data).toHaveLength(1);
    expect(firstPage.page).toMatchObject({ hasMore: true });
    expect(firstPage.page.nextCursor).toEqual(expect.any(String));
    expect(publishedIds).toContain(firstPage.data[0]?.id);
    expect(firstPage.data[0]).toMatchObject({
      type: "RENTAL",
      status: "PUBLISHED",
      location: { precision: "APPROXIMATE" },
    });
    expect(firstPage.data[0]).not.toHaveProperty("body");
    expect(firstPage.data[0]).not.toHaveProperty("createdAt");
    expect(firstPage.data[0]).not.toHaveProperty("contactMode");
    expect(firstPage.data[0]).not.toHaveProperty("mediaIds");
    expect(firstPage.data[0]?.location).not.toHaveProperty("point");

    const second = await server.inject({
      method: "GET",
      url: `/v1/listings?type=RENTAL&limit=1&cursor=${encodeURIComponent(
        firstPage.page.nextCursor ?? "",
      )}`,
    });
    const secondPage = second.json<ListingCollection>();
    expect(second.statusCode).toBe(200);
    expect(secondPage.data).toHaveLength(1);
    expect(secondPage.data[0]?.id).not.toBe(firstPage.data[0]?.id);

    const tampered = await server.inject({
      method: "GET",
      url: `/v1/listings?limit=1&cursor=${encodeURIComponent(
        `${firstPage.page.nextCursor ?? ""}x`,
      )}`,
    });
    const rebound = await server.inject({
      method: "GET",
      url: `/v1/listings?categoryId=${memoryListingCategoryId}&limit=1&cursor=${encodeURIComponent(
        firstPage.page.nextCursor ?? "",
      )}`,
    });
    const emptyJobPage = await server.inject({
      method: "GET",
      url: "/v1/listings?type=JOB",
    });
    const emptyServicePage = await server.inject({
      method: "GET",
      url: "/v1/listings?type=SERVICE",
    });
    const unsupportedType = await server.inject({
      method: "GET",
      url: "/v1/listings?type=BUSINESS",
    });
    expect(emptyJobPage.statusCode).toBe(200);
    expect(emptyJobPage.json<ListingCollection>().data).toEqual([]);
    expect(emptyServicePage.statusCode).toBe(200);
    expect(emptyServicePage.json<ListingCollection>().data).toEqual([]);
    expect([tampered.statusCode, rebound.statusCode, unsupportedType.statusCode]).toEqual([
      400, 400, 400,
    ]);
  });

  it("archives and soft-deletes through owner policy, ETags, audit, and idempotent DELETE", async () => {
    const archiveAuditCount = listingStore.auditActions.filter(
      (action) => action === "listing.archived",
    ).length;
    const deleteAuditCount = listingStore.auditActions.filter(
      (action) => action === "listing.deleted",
    ).length;
    const archiveOutboxCount = listingStore.outboxEvents.filter(
      (event) => event === "listing.archived",
    ).length;
    const deleteOutboxCount = listingStore.outboxEvents.filter(
      (event) => event === "listing.deleted",
    ).length;
    const created = await server.inject({
      method: "POST",
      url: "/v1/listings",
      headers: mutationHeaders(ownerId, "listing-create-lifecycle-0001"),
      payload: draftPayload("Lifecycle boundary rental"),
    });
    const listingId = created.json<ListingOwnerResponse>().data.id;
    const submitted = await server.inject({
      method: "POST",
      url: `/v1/listings/${listingId}/submit`,
      headers: {
        ...mutationHeaders(ownerId, "listing-submit-lifecycle-0001"),
        "if-match": '"listing-v1"',
      },
    });
    expect(submitted.statusCode).toBe(202);

    const missingPrecondition = await server.inject({
      method: "PUT",
      url: `/v1/listings/${listingId}/archive`,
      headers: mutationHeaders(ownerId),
    });
    const outsiderArchive = await server.inject({
      method: "PUT",
      url: `/v1/listings/${listingId}/archive`,
      headers: { ...mutationHeaders(outsiderId), "if-match": '"listing-v3"' },
    });
    const archived = await server.inject({
      method: "PUT",
      url: `/v1/listings/${listingId}/archive`,
      headers: { ...mutationHeaders(ownerId), "if-match": '"listing-v3"' },
    });
    expect(missingPrecondition.statusCode).toBe(400);
    expect(outsiderArchive.statusCode).toBe(404);
    expect(archived.statusCode).toBe(200);
    expect(archived.headers.etag).toBe('"listing-v4"');
    expect(archived.headers["cache-control"]).toBe("no-store");
    expect(archived.json()).toMatchObject({
      data: { id: listingId, status: "ARCHIVED", version: 4 },
    });

    const publicAfterArchive = await server.inject({
      method: "GET",
      url: `/v1/listings/${listingId}`,
    });
    const repeatedArchive = await server.inject({
      method: "PUT",
      url: `/v1/listings/${listingId}/archive`,
      headers: { ...mutationHeaders(ownerId), "if-match": '"listing-v4"' },
    });
    expect(publicAfterArchive.statusCode).toBe(404);
    expect(repeatedArchive.statusCode).toBe(200);
    expect(repeatedArchive.headers.etag).toBe('"listing-v4"');
    expect(repeatedArchive.json()).toMatchObject({
      data: { id: listingId, status: "ARCHIVED", version: 4 },
    });

    const deleted = await server.inject({
      method: "DELETE",
      url: `/v1/listings/${listingId}`,
      headers: { ...mutationHeaders(ownerId), "if-match": '"listing-v4"' },
    });
    const exactDeleteRetry = await server.inject({
      method: "DELETE",
      url: `/v1/listings/${listingId}`,
      headers: { ...mutationHeaders(ownerId), "if-match": '"listing-v4"' },
    });
    const ownerAfterDelete = await server.inject({
      method: "GET",
      url: `/v1/listings/${listingId}`,
      headers: { cookie: cookies.get(ownerId) },
    });
    expect(deleted.statusCode).toBe(204);
    expect(deleted.headers["cache-control"]).toBe("no-store");
    expect(exactDeleteRetry.statusCode).toBe(204);
    expect(ownerAfterDelete.statusCode).toBe(404);
    expect(
      listingStore.auditActions.filter((action) => action === "listing.archived"),
    ).toHaveLength(archiveAuditCount + 1);
    expect(listingStore.auditActions.filter((action) => action === "listing.deleted")).toHaveLength(
      deleteAuditCount + 1,
    );
    expect(listingStore.outboxEvents.filter((event) => event === "listing.archived")).toHaveLength(
      archiveOutboxCount + 1,
    );
    expect(listingStore.outboxEvents.filter((event) => event === "listing.deleted")).toHaveLength(
      deleteOutboxCount + 1,
    );
  });

  it("serves isolated account buckets and bounds per-item batch lifecycle actions", async () => {
    const draft = await server.inject({
      method: "POST",
      url: "/v1/listings",
      headers: mutationHeaders(ownerId, "listing-create-account-center-0001"),
      payload: draftPayload("Account center draft"),
    });
    const publishedDraft = await server.inject({
      method: "POST",
      url: "/v1/listings",
      headers: mutationHeaders(ownerId, "listing-create-account-center-0002"),
      payload: draftPayload("Account center published item"),
    });
    const publishedId = publishedDraft.json<ListingOwnerResponse>().data.id;
    await server.inject({
      method: "POST",
      url: `/v1/listings/${publishedId}/submit`,
      headers: {
        ...mutationHeaders(ownerId, "listing-submit-account-center-0001"),
        "if-match": '"listing-v1"',
      },
    });

    const guest = await server.inject({
      method: "GET",
      url: "/v1/me/listings?bucket=DRAFT",
    });
    const ownerPage = await server.inject({
      method: "GET",
      url: "/v1/me/listings?bucket=DRAFT&limit=1",
      headers: { cookie: cookies.get(ownerId) },
    });
    const ownerBody = ownerPage.json<MyListingCollection>();
    const outsiderPage = await server.inject({
      method: "GET",
      url: "/v1/me/listings?bucket=DRAFT",
      headers: { cookie: cookies.get(outsiderId) },
    });
    const limitedPage = await server.inject({
      method: "GET",
      url: "/v1/me/listings?bucket=DRAFT",
      headers: { cookie: cookies.get(limitedId) },
    });
    expect(guest.statusCode).toBe(401);
    expect(ownerPage.statusCode).toBe(200);
    expect(ownerPage.headers["cache-control"]).toBe("no-store");
    expect(ownerPage.headers.pragma).toBe("no-cache");
    expect(ownerBody.data).toHaveLength(1);
    expect(ownerBody.counts.draft).toBeGreaterThanOrEqual(1);
    expect(ownerBody.data[0]).not.toHaveProperty("body");
    expect(ownerBody.data[0]).not.toHaveProperty("attributes");
    expect(ownerBody.data[0]).not.toHaveProperty("ownerId");
    expect(outsiderPage.statusCode).toBe(200);
    expect(outsiderPage.json<MyListingCollection>().data).toEqual([]);
    expect(limitedPage.statusCode).toBe(200);

    const tampered = await server.inject({
      method: "GET",
      url: `/v1/me/listings?bucket=DRAFT&limit=1&cursor=${encodeURIComponent(
        `${ownerBody.page.nextCursor ?? ""}x`,
      )}`,
      headers: { cookie: cookies.get(ownerId) },
    });
    expect(tampered.statusCode).toBe(400);

    const batch = await server.inject({
      method: "POST",
      url: "/v1/me/listings/actions",
      headers: mutationHeaders(ownerId),
      payload: {
        action: "ARCHIVE",
        items: [
          { listingId: publishedId, version: 3 },
          { listingId: "90000000-0000-4000-8000-000000000099", version: 1 },
        ],
      },
    });
    expect(batch.statusCode).toBe(200);
    expect(batch.headers["cache-control"]).toBe("no-store");
    expect(batch.json<BatchListingActionResponse>()).toMatchObject({
      appliedCount: 1,
      data: [
        {
          listingId: publishedId,
          outcome: "APPLIED",
          currentVersion: 4,
          currentBucket: "ARCHIVED",
        },
        {
          listingId: "90000000-0000-4000-8000-000000000099",
          outcome: "NOT_FOUND",
          currentVersion: null,
          currentBucket: null,
        },
      ],
    });

    const limitedBatch = await server.inject({
      method: "POST",
      url: "/v1/me/listings/actions",
      headers: mutationHeaders(limitedId),
      payload: {
        action: "DELETE",
        items: [{ listingId: draft.json<ListingOwnerResponse>().data.id, version: 1 }],
      },
    });
    const oversized = await server.inject({
      method: "POST",
      url: "/v1/me/listings/actions",
      headers: mutationHeaders(ownerId),
      payload: {
        action: "DELETE",
        items: Array.from({ length: 21 }, () => ({
          listingId: draft.json<ListingOwnerResponse>().data.id,
          version: 1,
        })),
      },
    });
    expect(limitedBatch.statusCode).toBe(403);
    expect(oversized.statusCode).toBe(400);
  });

  it("rejects unsafe, over-posted, unready-media, and restricted-account writes", async () => {
    const cases = await Promise.all([
      server.inject({
        method: "POST",
        url: "/v1/listings",
        headers: mutationHeaders(ownerId),
        payload: draftPayload("Missing idempotency key"),
      }),
      server.inject({
        method: "POST",
        url: "/v1/listings",
        headers: mutationHeaders(limitedId, "listing-create-limited-0001"),
        payload: draftPayload("Limited account"),
      }),
      server.inject({
        method: "POST",
        url: "/v1/listings",
        headers: mutationHeaders(ownerId, "listing-create-media-0001"),
        payload: {
          ...draftPayload("Media before binding support"),
          mediaIds: ["50000000-0000-4000-8000-000000000001"],
        },
      }),
      server.inject({
        method: "POST",
        url: "/v1/listings",
        headers: mutationHeaders(ownerId, "listing-create-attributes-0001"),
        payload: { ...draftPayload("Unknown attributes"), attributes: { secretField: "x" } },
      }),
      server.inject({
        method: "POST",
        url: "/v1/listings",
        headers: mutationHeaders(ownerId, "listing-create-overpost-0001"),
        payload: { ...draftPayload("Over-posted"), status: "PUBLISHED" },
      }),
    ]);

    expect(cases.map((response) => response.statusCode)).toEqual([400, 403, 422, 422, 400]);
    for (const response of cases) {
      expect(response.headers["content-type"]).toContain("application/problem+json");
    }
  });
});
