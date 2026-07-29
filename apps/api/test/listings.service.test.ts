import { describe, expect, it } from "vitest";
import type { CreateListingInput } from "@socal/contracts";
import {
  activeUserPermissions,
  type PolicyRequestContext,
} from "../src/common/authorization/policy";
import { createPolicyService } from "../src/common/authorization/authorization.module";
import {
  ListingIdempotencyConflictError,
  ListingsService,
} from "../src/modules/listings/listings.service";
import { TaxonomyService } from "../src/modules/taxonomy/taxonomy.service";
import {
  createMemoryListingTaxonomyStore,
  MemoryListingStore,
  memoryListingCategoryId,
  memoryListingRegionCode,
} from "./support/memory-listing.store";

const ownerId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

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

function createService(): { service: ListingsService; store: MemoryListingStore } {
  const store = new MemoryListingStore();
  const service = new ListingsService(
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
});
