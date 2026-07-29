import { randomUUID } from "node:crypto";
import type { HomepageLayoutDefinition } from "@socal/contracts";
import { describe, expect, it } from "vitest";
import {
  HomepageLayoutConflictError,
  HomepageLayoutService,
} from "../src/modules/homepage-layout/homepage-layout.service";
import type {
  HomepageLayoutLifecycleRecord,
  HomepageLayoutMutationResult,
  HomepageLayoutStore,
  HomepageLayoutVersionRecord,
  PublishHomepageLayoutDraftInput,
  RollbackHomepageLayoutInput,
  SaveHomepageLayoutDraftInput,
} from "../src/modules/homepage-layout/homepage-layout.store";

const actorId = "74000000-0000-4000-8000-000000000001";
const locale = "zh-Hans" as const;
const regionCode = "US-CA-SOCAL";
const initialDefinition: HomepageLayoutDefinition = {
  version: 1,
  locale,
  regionCode,
  slots: [
    {
      key: "hero",
      kind: "HERO",
      enabled: true,
      source: { contentKey: "homepage.hero" },
      limit: 1,
      sponsoredDisclosure: false,
      cacheTtlSeconds: 300,
    },
  ],
};

function record(
  definition: HomepageLayoutDefinition,
  input: {
    revision?: number;
    published?: boolean;
    basedOnVersion?: number;
  } = {},
): HomepageLayoutVersionRecord {
  const timestamp = new Date("2026-01-01T00:00:00.000Z");
  const published = input.published ?? true;
  return {
    id: randomUUID(),
    layoutId: "74000000-0000-4000-8000-000000000002",
    version: definition.version,
    revision: input.revision ?? 1,
    definition: structuredClone(definition),
    contentHash: String(definition.version).repeat(64),
    basedOnVersion: input.basedOnVersion ?? null,
    createdById: actorId,
    updatedById: actorId,
    publishedById: published ? actorId : null,
    createdAt: timestamp,
    updatedAt: timestamp,
    publishedAt: published ? timestamp : null,
  };
}

class MemoryHomepageLayoutStore implements HomepageLayoutStore {
  readonly scope = {
    id: "74000000-0000-4000-8000-000000000002",
    locale,
    regionCode,
    currentVersion: 1,
  };
  readonly versions = [record(initialDefinition)];

  getPublished(input: {
    locale: "zh-Hans" | "en-US";
    regionCode: string;
    version?: number;
  }): Promise<HomepageLayoutVersionRecord | null> {
    const result = this.versions.find(
      (candidate) =>
        input.locale === this.scope.locale &&
        input.regionCode === this.scope.regionCode &&
        candidate.version === (input.version ?? this.scope.currentVersion) &&
        candidate.publishedAt !== null,
    );
    return Promise.resolve(result ? structuredClone(result) : null);
  }

  getLifecycle(input: {
    locale: "zh-Hans" | "en-US";
    regionCode: string;
  }): Promise<HomepageLayoutLifecycleRecord | null> {
    if (input.locale !== this.scope.locale || input.regionCode !== this.scope.regionCode) {
      return Promise.resolve(null);
    }
    return Promise.resolve({
      ...this.scope,
      draft: structuredClone(
        this.versions.find((candidate) => candidate.publishedAt === null) ?? null,
      ),
      published: structuredClone(
        this.versions.filter((candidate) => candidate.publishedAt !== null),
      ),
    });
  }

  saveDraft(input: SaveHomepageLayoutDraftInput): Promise<HomepageLayoutMutationResult> {
    if (input.expectedCurrentVersion !== this.scope.currentVersion) {
      return Promise.resolve({
        kind: "current_version_conflict",
        currentVersion: this.scope.currentVersion,
      });
    }
    const existing = this.versions.find((candidate) => candidate.publishedAt === null);
    const timestamp = new Date();
    if (existing) {
      if (
        input.expectedDraftRevision === undefined ||
        input.expectedDraftRevision !== existing.revision
      ) {
        return Promise.resolve({
          kind: "draft_revision_conflict",
          currentDraftRevision: existing.revision,
        });
      }
      existing.definition = structuredClone(input.definition);
      existing.contentHash = input.contentHash;
      existing.revision += 1;
      existing.updatedById = input.actorId;
      existing.updatedAt = timestamp;
      return Promise.resolve({
        kind: "ok",
        scope: { ...this.scope },
        layout: structuredClone(existing),
      });
    }
    if (input.expectedDraftRevision !== undefined) {
      return Promise.resolve({ kind: "draft_revision_conflict" });
    }
    const created = record(input.definition, { published: false });
    created.contentHash = input.contentHash;
    created.createdAt = timestamp;
    created.updatedAt = timestamp;
    this.versions.push(created);
    return Promise.resolve({
      kind: "ok",
      scope: { ...this.scope },
      layout: structuredClone(created),
    });
  }

  publishDraft(input: PublishHomepageLayoutDraftInput): Promise<HomepageLayoutMutationResult> {
    if (input.expectedCurrentVersion !== this.scope.currentVersion) {
      return Promise.resolve({
        kind: "current_version_conflict",
        currentVersion: this.scope.currentVersion,
      });
    }
    const draft = this.versions.find((candidate) => candidate.publishedAt === null);
    if (!draft) return Promise.resolve({ kind: "draft_missing" });
    if (draft.revision !== input.expectedDraftRevision) {
      return Promise.resolve({
        kind: "draft_revision_conflict",
        currentDraftRevision: draft.revision,
      });
    }
    draft.publishedAt = new Date();
    draft.publishedById = input.actorId;
    this.scope.currentVersion = draft.version;
    return Promise.resolve({
      kind: "ok",
      scope: { ...this.scope },
      layout: structuredClone(draft),
    });
  }

  rollback(input: RollbackHomepageLayoutInput): Promise<HomepageLayoutMutationResult> {
    if (input.expectedCurrentVersion !== this.scope.currentVersion) {
      return Promise.resolve({
        kind: "current_version_conflict",
        currentVersion: this.scope.currentVersion,
      });
    }
    if (this.versions.some((candidate) => candidate.publishedAt === null)) {
      return Promise.resolve({ kind: "draft_revision_conflict" });
    }
    const target = this.versions.find(
      (candidate) => candidate.version === input.targetVersion && candidate.publishedAt !== null,
    );
    if (!target) return Promise.resolve({ kind: "target_missing" });
    const created = record(input.definition, {
      basedOnVersion: input.targetVersion,
    });
    created.contentHash = input.contentHash;
    this.versions.push(created);
    this.scope.currentVersion = created.version;
    return Promise.resolve({
      kind: "ok",
      scope: { ...this.scope },
      layout: structuredClone(created),
    });
  }
}

function createService(): {
  service: HomepageLayoutService;
  store: MemoryHomepageLayoutStore;
} {
  const store = new MemoryHomepageLayoutStore();
  return { service: new HomepageLayoutService(store), store };
}

describe("homepage layout lifecycle", () => {
  it("drafts, previews and publishes a strict optimistic version", async () => {
    const { service } = createService();
    const slots = [
      ...initialDefinition.slots,
      {
        key: "jobs-latest",
        kind: "LISTING_FEED",
        enabled: true,
        source: { listingType: "JOB", sort: "NEWEST" },
        limit: 5,
        cacheTtlSeconds: 60,
      },
    ];
    const created = await service.saveDraft({
      locale,
      regionCode,
      expectedCurrentVersion: 1,
      slots,
      actorId,
    });
    expect(created).toMatchObject({
      definition: { version: 2, locale, regionCode },
      revision: 1,
    });
    expect(created.contentHash).toMatch(/^[0-9a-f]{64}$/);

    const updated = await service.saveDraft({
      locale,
      regionCode,
      expectedCurrentVersion: 1,
      expectedDraftRevision: 1,
      slots: [...slots].reverse(),
      actorId,
    });
    expect(updated.revision).toBe(2);
    await expect(service.previewDraft({ locale, regionCode })).resolves.toEqual(updated);
    await expect(
      service.publishDraft({
        locale,
        regionCode,
        expectedCurrentVersion: 1,
        expectedDraftRevision: 2,
        actorId,
      }),
    ).resolves.toMatchObject({ definition: { version: 2 } });
    await expect(service.getPublished({ locale, regionCode })).resolves.toMatchObject({
      definition: { version: 2 },
    });
  });

  it("rejects arbitrary HTML/source fields before persistence and detects stale revisions", async () => {
    const { service, store } = createService();
    await expect(
      service.saveDraft({
        locale,
        regionCode,
        expectedCurrentVersion: 1,
        slots: [
          {
            ...initialDefinition.slots[0],
            source: { contentKey: "homepage.hero", html: "<script>bad()</script>" },
          },
        ],
        actorId,
      }),
    ).rejects.toThrow();
    expect(store.versions).toHaveLength(1);

    await service.saveDraft({
      locale,
      regionCode,
      expectedCurrentVersion: 1,
      slots: initialDefinition.slots,
      actorId,
    });
    await expect(
      service.saveDraft({
        locale,
        regionCode,
        expectedCurrentVersion: 1,
        expectedDraftRevision: 99,
        slots: initialDefinition.slots,
        actorId,
      }),
    ).rejects.toBeInstanceOf(HomepageLayoutConflictError);
  });

  it("rolls back by appending a new published version with provenance", async () => {
    const { service, store } = createService();
    await service.saveDraft({
      locale,
      regionCode,
      expectedCurrentVersion: 1,
      slots: [
        {
          key: "cities",
          kind: "CITY_CHIPS",
          enabled: true,
          source: { regionType: "CITY" },
          limit: 8,
        },
      ],
      actorId,
    });
    await service.publishDraft({
      locale,
      regionCode,
      expectedCurrentVersion: 1,
      expectedDraftRevision: 1,
      actorId,
    });
    const rollback = await service.rollback({
      locale,
      regionCode,
      targetVersion: 1,
      expectedCurrentVersion: 2,
      actorId,
    });

    expect(rollback.definition).toEqual({ ...initialDefinition, version: 3 });
    expect(store.scope.currentVersion).toBe(3);
    const rollbackRecord = store.versions.find((candidate) => candidate.version === 3);
    expect(rollbackRecord?.basedOnVersion).toBe(1);
    expect(rollbackRecord?.publishedAt).toBeInstanceOf(Date);
    expect(store.versions.find((candidate) => candidate.version === 1)?.definition).toEqual(
      initialDefinition,
    );
  });
});
