import type { HomepageLayoutDefinition } from "@socal/contracts";

export const HOMEPAGE_LAYOUT_STORE = Symbol("HOMEPAGE_LAYOUT_STORE");

export type HomepageLayoutVersionRecord = {
  id: string;
  layoutId: string;
  version: number;
  revision: number;
  definition: HomepageLayoutDefinition;
  contentHash: string;
  basedOnVersion: number | null;
  createdById: string;
  updatedById: string;
  publishedById: string | null;
  createdAt: Date;
  updatedAt: Date;
  publishedAt: Date | null;
};

export type HomepageLayoutScopeRecord = {
  id: string;
  locale: "zh-Hans" | "en-US";
  regionCode: string;
  currentVersion: number;
};

export type HomepageLayoutLifecycleRecord = HomepageLayoutScopeRecord & {
  draft: HomepageLayoutVersionRecord | null;
  published: HomepageLayoutVersionRecord[];
};

export type HomepageLayoutMutationResult =
  | {
      kind: "ok";
      scope: HomepageLayoutScopeRecord;
      layout: HomepageLayoutVersionRecord;
    }
  | {
      kind:
        | "scope_not_found"
        | "current_version_conflict"
        | "draft_missing"
        | "draft_revision_conflict"
        | "target_missing";
      currentVersion?: number;
      currentDraftRevision?: number;
    };

export type SaveHomepageLayoutDraftInput = {
  locale: "zh-Hans" | "en-US";
  regionCode: string;
  expectedCurrentVersion: number;
  expectedDraftRevision?: number;
  definition: HomepageLayoutDefinition;
  contentHash: string;
  actorId: string;
};

export type PublishHomepageLayoutDraftInput = {
  locale: "zh-Hans" | "en-US";
  regionCode: string;
  expectedCurrentVersion: number;
  expectedDraftRevision: number;
  actorId: string;
};

export type RollbackHomepageLayoutInput = {
  locale: "zh-Hans" | "en-US";
  regionCode: string;
  targetVersion: number;
  expectedCurrentVersion: number;
  definition: HomepageLayoutDefinition;
  contentHash: string;
  actorId: string;
};

export type HomepageLayoutStore = {
  getPublished(input: {
    locale: "zh-Hans" | "en-US";
    regionCode: string;
    version?: number;
  }): Promise<HomepageLayoutVersionRecord | null>;
  getLifecycle(input: {
    locale: "zh-Hans" | "en-US";
    regionCode: string;
  }): Promise<HomepageLayoutLifecycleRecord | null>;
  saveDraft(input: SaveHomepageLayoutDraftInput): Promise<HomepageLayoutMutationResult>;
  publishDraft(input: PublishHomepageLayoutDraftInput): Promise<HomepageLayoutMutationResult>;
  rollback(input: RollbackHomepageLayoutInput): Promise<HomepageLayoutMutationResult>;
};
