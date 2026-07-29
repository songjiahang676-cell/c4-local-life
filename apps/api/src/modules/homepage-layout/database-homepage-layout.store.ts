import { Inject, Injectable, type OnModuleDestroy } from "@nestjs/common";
import type { ApiEnvironment } from "@socal/config";
import {
  HomepageLayoutRepository,
  type HomepageLayoutLifecycle,
  type HomepageLayoutMutationResult as RepositoryMutationResult,
  type HomepageLayoutRecord,
} from "@socal/database/homepage-layout";
import { homepageLayoutDefinitionSchema } from "@socal/contracts";
import { API_ENVIRONMENT } from "../../common/api-environment.token";
import type {
  HomepageLayoutLifecycleRecord,
  HomepageLayoutMutationResult,
  HomepageLayoutStore,
  HomepageLayoutVersionRecord,
  PublishHomepageLayoutDraftInput,
  RollbackHomepageLayoutInput,
  SaveHomepageLayoutDraftInput,
} from "./homepage-layout.store";

function parseRecord(record: HomepageLayoutRecord): HomepageLayoutVersionRecord {
  return {
    ...record,
    definition: homepageLayoutDefinitionSchema.parse(record.definition),
  };
}

function parseLifecycle(lifecycle: HomepageLayoutLifecycle): HomepageLayoutLifecycleRecord {
  return {
    id: lifecycle.id,
    locale: lifecycle.locale,
    regionCode: lifecycle.regionCode,
    currentVersion: lifecycle.currentVersion,
    draft: lifecycle.draft ? parseRecord(lifecycle.draft) : null,
    published: lifecycle.published.map(parseRecord),
  };
}

function parseMutation(result: RepositoryMutationResult): HomepageLayoutMutationResult {
  return result.kind === "ok"
    ? {
        kind: "ok",
        scope: result.scope,
        layout: parseRecord(result.layout),
      }
    : result;
}

@Injectable()
export class DatabaseHomepageLayoutStore implements HomepageLayoutStore, OnModuleDestroy {
  readonly #repository: HomepageLayoutRepository;

  constructor(@Inject(API_ENVIRONMENT) environment: ApiEnvironment) {
    this.#repository = new HomepageLayoutRepository({
      connectionString: environment.DATABASE_URL,
      poolMaximum: environment.DATABASE_POOL_MAX,
    });
  }

  async getPublished(input: {
    locale: "zh-Hans" | "en-US";
    regionCode: string;
    version?: number;
  }): Promise<HomepageLayoutVersionRecord | null> {
    const record = await this.#repository.getPublished(input);
    return record ? parseRecord(record) : null;
  }

  async getLifecycle(input: {
    locale: "zh-Hans" | "en-US";
    regionCode: string;
  }): Promise<HomepageLayoutLifecycleRecord | null> {
    const lifecycle = await this.#repository.getLifecycle(input);
    return lifecycle ? parseLifecycle(lifecycle) : null;
  }

  async saveDraft(input: SaveHomepageLayoutDraftInput): Promise<HomepageLayoutMutationResult> {
    return parseMutation(await this.#repository.saveDraft(input));
  }

  async publishDraft(
    input: PublishHomepageLayoutDraftInput,
  ): Promise<HomepageLayoutMutationResult> {
    return parseMutation(await this.#repository.publishDraft(input));
  }

  async rollback(input: RollbackHomepageLayoutInput): Promise<HomepageLayoutMutationResult> {
    return parseMutation(await this.#repository.rollback(input));
  }

  onModuleDestroy(): Promise<void> {
    return this.#repository.close();
  }
}
