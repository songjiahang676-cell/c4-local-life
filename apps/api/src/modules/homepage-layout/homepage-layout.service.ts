import { createHash } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { homepageLayoutDefinitionSchema, type HomepageLayoutDefinition } from "@socal/contracts";
import {
  HOMEPAGE_LAYOUT_STORE,
  type HomepageLayoutLifecycleRecord,
  type HomepageLayoutMutationResult,
  type HomepageLayoutStore,
  type HomepageLayoutVersionRecord,
} from "./homepage-layout.store";

export class HomepageLayoutNotFoundError extends Error {
  constructor() {
    super("Homepage layout not found");
    this.name = "HomepageLayoutNotFoundError";
  }
}

export class HomepageLayoutConflictError extends Error {
  constructor(
    readonly reason: string,
    readonly currentVersion?: number,
    readonly currentDraftRevision?: number,
  ) {
    super("Homepage layout changed concurrently");
    this.name = "HomepageLayoutConflictError";
  }
}

export type HomepageLayoutDraftInput = {
  locale: "zh-Hans" | "en-US";
  regionCode: string;
  expectedCurrentVersion: number;
  expectedDraftRevision?: number;
  slots: unknown;
  actorId: string;
};

export type HomepageLayoutPreview = {
  definition: HomepageLayoutDefinition;
  revision: number;
  contentHash: string;
};

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

function contentHash(definition: HomepageLayoutDefinition): string {
  return createHash("sha256").update(canonicalJson(definition), "utf8").digest("hex");
}

function cloneDefinitionForVersion(
  definition: HomepageLayoutDefinition,
  version: number,
): HomepageLayoutDefinition {
  return homepageLayoutDefinitionSchema.parse({
    ...definition,
    version,
  });
}

@Injectable()
export class HomepageLayoutService {
  constructor(
    @Inject(HOMEPAGE_LAYOUT_STORE)
    private readonly store: HomepageLayoutStore,
  ) {}

  async getPublished(input: {
    locale: "zh-Hans" | "en-US";
    regionCode: string;
    version?: number;
  }): Promise<HomepageLayoutPreview> {
    const layout = await this.store.getPublished(input);
    if (!layout) throw new HomepageLayoutNotFoundError();
    return this.#preview(layout);
  }

  async getLifecycle(input: {
    locale: "zh-Hans" | "en-US";
    regionCode: string;
  }): Promise<HomepageLayoutLifecycleRecord> {
    const lifecycle = await this.store.getLifecycle(input);
    if (!lifecycle) throw new HomepageLayoutNotFoundError();
    return lifecycle;
  }

  async saveDraft(input: HomepageLayoutDraftInput): Promise<HomepageLayoutPreview> {
    const definition = homepageLayoutDefinitionSchema.parse({
      version: input.expectedCurrentVersion + 1,
      locale: input.locale,
      regionCode: input.regionCode,
      slots: input.slots,
    });
    const result = await this.store.saveDraft({
      locale: definition.locale,
      regionCode: definition.regionCode,
      expectedCurrentVersion: input.expectedCurrentVersion,
      ...(input.expectedDraftRevision === undefined
        ? {}
        : { expectedDraftRevision: input.expectedDraftRevision }),
      definition,
      contentHash: contentHash(definition),
      actorId: input.actorId,
    });
    return this.#unwrapMutation(result);
  }

  async previewDraft(input: {
    locale: "zh-Hans" | "en-US";
    regionCode: string;
  }): Promise<HomepageLayoutPreview> {
    const lifecycle = await this.store.getLifecycle(input);
    if (!lifecycle?.draft) throw new HomepageLayoutNotFoundError();
    return this.#preview(lifecycle.draft);
  }

  async publishDraft(input: {
    locale: "zh-Hans" | "en-US";
    regionCode: string;
    expectedCurrentVersion: number;
    expectedDraftRevision: number;
    actorId: string;
  }): Promise<HomepageLayoutPreview> {
    const result = await this.store.publishDraft(input);
    return this.#unwrapMutation(result);
  }

  async rollback(input: {
    locale: "zh-Hans" | "en-US";
    regionCode: string;
    targetVersion: number;
    expectedCurrentVersion: number;
    actorId: string;
  }): Promise<HomepageLayoutPreview> {
    const lifecycle = await this.store.getLifecycle(input);
    if (!lifecycle) throw new HomepageLayoutNotFoundError();
    if (lifecycle.currentVersion !== input.expectedCurrentVersion) {
      throw new HomepageLayoutConflictError("current_version_conflict", lifecycle.currentVersion);
    }
    if (lifecycle.draft) {
      throw new HomepageLayoutConflictError(
        "draft_revision_conflict",
        lifecycle.currentVersion,
        lifecycle.draft.revision,
      );
    }
    const target = lifecycle.published.find((version) => version.version === input.targetVersion);
    if (!target) throw new HomepageLayoutNotFoundError();
    const definition = cloneDefinitionForVersion(target.definition, lifecycle.currentVersion + 1);
    const result = await this.store.rollback({
      ...input,
      definition,
      contentHash: contentHash(definition),
    });
    return this.#unwrapMutation(result);
  }

  #unwrapMutation(result: HomepageLayoutMutationResult): HomepageLayoutPreview {
    if (result.kind !== "ok") {
      if (result.kind === "scope_not_found" || result.kind === "target_missing") {
        throw new HomepageLayoutNotFoundError();
      }
      throw new HomepageLayoutConflictError(
        result.kind,
        result.currentVersion,
        result.currentDraftRevision,
      );
    }
    return this.#preview(result.layout);
  }

  #preview(layout: HomepageLayoutVersionRecord): HomepageLayoutPreview {
    return {
      definition: layout.definition,
      revision: layout.revision,
      contentHash: layout.contentHash,
    };
  }
}
