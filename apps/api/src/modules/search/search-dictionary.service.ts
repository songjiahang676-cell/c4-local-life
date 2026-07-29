import { createHash } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import {
  searchDictionaryDefinitionSchema,
  type SearchDictionaryDefinition,
} from "@socal/contracts";
import {
  SEARCH_DISCOVERY_STORE,
  type SearchDictionaryLifecycle,
  type SearchDictionaryMutationResult,
  type SearchDiscoveryStore,
} from "./search-discovery.store";

function contentHash(definition: SearchDictionaryDefinition): string {
  return createHash("sha256").update(JSON.stringify(definition)).digest("hex");
}

@Injectable()
export class SearchDictionaryService {
  constructor(@Inject(SEARCH_DISCOVERY_STORE) private readonly store: SearchDiscoveryStore) {}

  getLifecycle(): Promise<SearchDictionaryLifecycle> {
    return this.store.getDictionaryLifecycle();
  }

  saveDraft(input: {
    expectedCurrentVersion: number;
    expectedDraftRevision?: number;
    definition: unknown;
    actorId: string;
  }): Promise<SearchDictionaryMutationResult> {
    const definition = searchDictionaryDefinitionSchema.parse(input.definition);
    return this.store.saveDictionaryDraft({
      expectedCurrentVersion: input.expectedCurrentVersion,
      ...(input.expectedDraftRevision === undefined
        ? {}
        : { expectedDraftRevision: input.expectedDraftRevision }),
      definition,
      contentHash: contentHash(definition),
      actorId: input.actorId,
    });
  }

  publishDraft(input: {
    expectedCurrentVersion: number;
    expectedDraftRevision: number;
    reviewerId: string;
    publishedAt?: Date;
  }): Promise<SearchDictionaryMutationResult> {
    return this.store.publishDictionaryDraft(input);
  }

  rollback(input: {
    expectedCurrentVersion: number;
    targetVersion: number;
    actorId: string;
  }): Promise<SearchDictionaryMutationResult> {
    return this.store.rollbackDictionary(input);
  }
}
