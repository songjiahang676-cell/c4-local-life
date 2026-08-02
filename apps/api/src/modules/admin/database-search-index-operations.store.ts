import { Inject, Injectable, type OnModuleDestroy } from "@nestjs/common";
import type { ApiEnvironment } from "@socal/config";
import {
  SearchIndexOperationRepository,
  type CreateSearchIndexOperationResult,
  type CreateSearchIndexRebuildInput,
  type CreateSearchIndexRollbackInput,
  type SearchIndexOperationProjection,
} from "@socal/database/search-index-operations";
import { API_ENVIRONMENT } from "../../common/api-environment.token";
import type { SearchIndexOperationsStore } from "./search-index-operations.store";

@Injectable()
export class DatabaseSearchIndexOperationsStore
  implements SearchIndexOperationsStore, OnModuleDestroy
{
  readonly #repository: SearchIndexOperationRepository;

  constructor(@Inject(API_ENVIRONMENT) environment: ApiEnvironment) {
    this.#repository = new SearchIndexOperationRepository({
      connectionString: environment.DATABASE_URL,
      poolMaximum: environment.DATABASE_POOL_MAX,
    });
  }

  createRebuild(input: CreateSearchIndexRebuildInput): Promise<CreateSearchIndexOperationResult> {
    return this.#repository.createRebuild(input);
  }

  createRollback(input: CreateSearchIndexRollbackInput): Promise<CreateSearchIndexOperationResult> {
    return this.#repository.createRollback(input);
  }

  getOperation(operationId: string): Promise<SearchIndexOperationProjection | null> {
    return this.#repository.getOperation(operationId);
  }

  onModuleDestroy(): Promise<void> {
    return this.#repository.close();
  }
}
