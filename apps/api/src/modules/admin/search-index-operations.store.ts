import type {
  CreateSearchIndexOperationResult,
  CreateSearchIndexRebuildInput,
  CreateSearchIndexRollbackInput,
  SearchIndexOperationProjection,
} from "@socal/database/search-index-operations";

export const SEARCH_INDEX_OPERATIONS_STORE = Symbol("SEARCH_INDEX_OPERATIONS_STORE");

export type SearchIndexOperationsStore = {
  createRebuild(input: CreateSearchIndexRebuildInput): Promise<CreateSearchIndexOperationResult>;
  createRollback(input: CreateSearchIndexRollbackInput): Promise<CreateSearchIndexOperationResult>;
  getOperation(operationId: string): Promise<SearchIndexOperationProjection | null>;
};

export type {
  CreateSearchIndexOperationResult,
  CreateSearchIndexRebuildInput,
  CreateSearchIndexRollbackInput,
  SearchIndexOperationProjection,
};
