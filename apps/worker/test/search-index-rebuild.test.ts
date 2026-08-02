import type { Client } from "@opensearch-project/opensearch";
import type { ClaimedSearchIndexOperation } from "@socal/database/search-index-operations";
import type { ListingSearchRepository } from "@socal/database/listing-search";
import { createObservabilityRuntime } from "@socal/observability";
import { describe, expect, it, vi } from "vitest";
import { RebuildAwareListingIndex, type ListingIndexWriter } from "../src/search/listing-index";
import type { OpenSearchListingIndexCatalog } from "../src/search/listing-index";
import type { ListingIndexManager } from "../src/search/listing-index-manager";
import {
  SearchIndexRebuildDispatcher,
  type SearchIndexRebuildRepositoryPort,
} from "../src/search/search-index-rebuild-dispatcher";

const operationId = "42000000-0000-4000-8000-000000000101";
const jobId = "42000000-0000-4000-8000-000000000102";
const listingId = "42000000-0000-4000-8000-000000000103";
const now = new Date("2026-08-01T12:00:00.000Z");

function runtime() {
  return createObservabilityRuntime({
    serviceName: "search-index-rebuild-test",
    serviceVersion: "test",
    environment: "test",
    minimumLogLevel: "fatal",
  });
}

function operation(
  overrides: Partial<ClaimedSearchIndexOperation> = {},
): ClaimedSearchIndexOperation {
  return {
    id: operationId,
    jobId,
    parentOperationId: null,
    type: "SEARCH_INDEX_REBUILD",
    jobStatus: "RUNNING",
    phase: "PENDING",
    schemaVersion: 1,
    sourceIndex: null,
    targetIndex: null,
    scanCursor: null,
    rollbackWindowHours: 24,
    canonicalCount: null,
    targetCount: null,
    canonicalDigest: null,
    targetDigest: null,
    aliasSwitchedAt: null,
    rollbackUntil: null,
    rolledBackAt: null,
    failureCode: null,
    createdAt: now,
    startedAt: now,
    completedAt: null,
    actorUserId: "42000000-0000-4000-8000-000000000104",
    reasonCode: "INDEX_DRIFT_RECOVERY",
    ticketRef: null,
    leaseExpiresAt: new Date(now.getTime() + 300_000),
    ...overrides,
  };
}

function repository(claimed: ClaimedSearchIndexOperation | null) {
  return {
    claimOperation: vi.fn(() => Promise.resolve(claimed)),
    prepareRebuild: vi.fn(() => Promise.resolve(true)),
    advanceScan: vi.fn(() => Promise.resolve(true)),
    advancePhase: vi.fn(() => Promise.resolve(true)),
    completeRebuild: vi.fn(() => Promise.resolve(true)),
    completeRollback: vi.fn(() => Promise.resolve(true)),
    failOperation: vi.fn(() => Promise.resolve(true)),
    closeExpiredObservationWindows: vi.fn(() => Promise.resolve(0)),
  } satisfies SearchIndexRebuildRepositoryPort;
}

function manager(overrides: Record<string, unknown> = {}): ListingIndexManager {
  return {
    resolveAliasTarget: vi.fn(() => Promise.resolve("socal_test_listings_v1")),
    createRebuildIndex: vi.fn(() => Promise.resolve("created")),
    switchAliases: vi.fn(() => Promise.resolve()),
    ...overrides,
  } as unknown as ListingIndexManager;
}

function catalog(overrides: Record<string, unknown> = {}): OpenSearchListingIndexCatalog {
  return {
    writer: vi.fn(() => ({
      version: vi.fn(() => Promise.resolve(null)),
      upsert: vi.fn(() => Promise.resolve("applied")),
      remove: vi.fn(() => Promise.resolve("missing")),
    })),
    refresh: vi.fn(() => Promise.resolve()),
    listVersions: vi.fn(() => Promise.resolve({ items: [], nextCursor: null })),
    ...overrides,
  } as unknown as OpenSearchListingIndexCatalog;
}

function dispatcher(input: {
  operation: ClaimedSearchIndexOperation;
  repository?: ReturnType<typeof repository>;
  listings?: {
    findById: Pick<ListingSearchRepository, "findById">["findById"];
    listStates: Pick<ListingSearchRepository, "listStates">["listStates"];
  };
  manager?: ListingIndexManager;
  catalog?: OpenSearchListingIndexCatalog;
}) {
  const store = input.repository ?? repository(input.operation);
  const listings =
    input.listings ??
    ({
      findById: vi.fn(() => Promise.resolve(null)),
      listStates: vi.fn(() => Promise.resolve({ items: [], nextCursor: null })),
    } as const);
  const indexManager = input.manager ?? manager();
  const indexCatalog = input.catalog ?? catalog();
  return {
    store,
    listings,
    indexManager,
    indexCatalog,
    value: new SearchIndexRebuildDispatcher({
      repository: store,
      listings,
      manager: indexManager,
      catalog: indexCatalog,
      observability: runtime(),
      indexPrefix: "socal_test",
      batchSize: 250,
      leaseSeconds: 300,
      pollIntervalMilliseconds: 5_000,
    }),
  };
}

describe("Search index rebuild dispatcher", () => {
  it("creates a deterministic alias-free candidate before durable backfill", async () => {
    const createRebuildIndex = vi.fn(() => Promise.resolve("created" as const));
    const context = dispatcher({
      operation: operation(),
      manager: manager({ createRebuildIndex }),
    });
    await expect(context.value.dispatchOnce(now)).resolves.toMatchObject({
      claimed: 1,
      phase: "PENDING",
      outcome: "completed",
    });
    expect(createRebuildIndex).toHaveBeenCalledWith("socal_test_listings_v1_r4200000000004000");
    expect(context.store.prepareRebuild).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceIndex: "socal_test_listings_v1",
        targetIndex: "socal_test_listings_v1_r4200000000004000",
      }),
    );
  });

  it("backfills a stable UUID page and persists the catch-up transition", async () => {
    const claimed = operation({
      phase: "BACKFILLING",
      sourceIndex: "socal_test_listings_v1",
      targetIndex: "socal_test_listings_v1_r4200000000004000",
    });
    const remove = vi.fn(() => Promise.resolve("missing" as const));
    const target: ListingIndexWriter = {
      version: vi.fn(() => Promise.resolve(null)),
      upsert: vi.fn(() => Promise.resolve("applied" as const)),
      remove,
    };
    const context = dispatcher({
      operation: claimed,
      listings: {
        findById: vi.fn(() => Promise.resolve(null)),
        listStates: vi.fn(() =>
          Promise.resolve({
            items: [{ id: listingId, version: 4, shouldIndex: false }],
            nextCursor: null,
          }),
        ),
      },
      catalog: catalog({ writer: vi.fn(() => target) }),
    });
    await expect(context.value.dispatchOnce(now)).resolves.toMatchObject({ outcome: "completed" });
    expect(remove).toHaveBeenCalledWith(listingId, 4);
    expect(context.store.advanceScan).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedPhase: "BACKFILLING",
        nextPhase: "CATCHING_UP",
        scanCursor: null,
      }),
    );
  });

  it("fails closed before alias switch when canonical and candidate versions differ", async () => {
    const claimed = operation({
      phase: "VALIDATING",
      sourceIndex: "socal_test_listings_v1",
      targetIndex: "socal_test_listings_v1_r4200000000004000",
    });
    const switchAliases = vi.fn(() => Promise.resolve());
    const context = dispatcher({
      operation: claimed,
      listings: {
        findById: vi.fn(() => Promise.resolve(null)),
        listStates: vi.fn(() =>
          Promise.resolve({
            items: [{ id: listingId, version: 5, shouldIndex: true }],
            nextCursor: null,
          }),
        ),
      },
      manager: manager({ switchAliases }),
      catalog: catalog({
        listVersions: vi.fn(() =>
          Promise.resolve({ items: [{ id: listingId, version: 4 }], nextCursor: null }),
        ),
      }),
    });
    await expect(context.value.dispatchOnce(now)).resolves.toMatchObject({ outcome: "failed" });
    expect(context.store.failOperation).toHaveBeenCalledWith(
      expect.objectContaining({ failureCode: "SEARCH_INDEX_VALIDATION_MISMATCH" }),
    );
    expect(switchAliases).not.toHaveBeenCalled();
  });

  it("switches aliases idempotently and records a bounded rollback window", async () => {
    const claimed = operation({
      phase: "SWITCHING",
      sourceIndex: "socal_test_listings_v1",
      targetIndex: "socal_test_listings_v1_r4200000000004000",
      canonicalCount: 500,
      targetCount: 500,
    });
    const switchAliases = vi.fn(() => Promise.resolve());
    const context = dispatcher({ operation: claimed, manager: manager({ switchAliases }) });
    await expect(context.value.dispatchOnce(now)).resolves.toMatchObject({ outcome: "completed" });
    expect(switchAliases).toHaveBeenCalledWith(
      "socal_test_listings_v1",
      "socal_test_listings_v1_r4200000000004000",
    );
    expect(context.store.completeRebuild).toHaveBeenCalledWith(
      expect.objectContaining({
        canonicalCount: 500,
        rollbackUntil: new Date("2026-08-02T12:00:00.000Z"),
      }),
    );
  });

  it("keeps transient provider failures leased for a safe retry without a false success", async () => {
    const createRebuildIndex = vi.fn(() => Promise.reject(new Error("synthetic outage")));
    const context = dispatcher({
      operation: operation(),
      manager: manager({ createRebuildIndex }),
    });
    await expect(context.value.dispatchOnce(now)).resolves.toMatchObject({ outcome: "retry" });
    expect(context.store.prepareRebuild).not.toHaveBeenCalled();
    expect(context.store.failOperation).not.toHaveBeenCalled();
  });
});

describe("Rebuild-aware Listing writes", () => {
  it("writes every mutation to the alias plus all distinct rollback/candidate targets", async () => {
    const index = vi.fn(() => Promise.resolve({ body: { result: "created" } }));
    const removeFromIndex = vi.fn(() => Promise.resolve({ body: { result: "deleted" } }));
    const client = {
      index,
      delete: removeFromIndex,
    } as unknown as Client;
    const removePrimary = vi.fn(() => Promise.resolve("applied" as const));
    const primary: ListingIndexWriter = {
      version: vi.fn(() => Promise.resolve(3)),
      upsert: vi.fn(() => Promise.resolve("applied" as const)),
      remove: removePrimary,
    };
    const writer = new RebuildAwareListingIndex(client, primary, () =>
      Promise.resolve(["candidate_index", "rollback_index"]),
    );
    await writer.remove(listingId, 6);
    expect(removePrimary).toHaveBeenCalledWith(listingId, 6);
    expect(removeFromIndex).toHaveBeenCalledTimes(2);
    expect(removeFromIndex).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ index: "candidate_index", id: listingId, version: 6 }),
    );
    expect(removeFromIndex).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ index: "rollback_index", id: listingId, version: 6 }),
    );
  });
});
