import { Inject, Injectable, type OnModuleDestroy } from "@nestjs/common";
import type { ApiEnvironment } from "@socal/config";
import {
  ModerationCaseRepository,
  type CommitModerationActionInput,
  type CommitModerationActionResult,
  type GetModerationCaseInput,
  type GetModerationCaseResult,
  type ListModerationCasesInput,
  type ListModerationCasesResult,
} from "@socal/database/moderation-case";
import { API_ENVIRONMENT } from "../../common/api-environment.token";
import type { ModerationStore } from "./moderation.store";

@Injectable()
export class DatabaseModerationStore implements ModerationStore, OnModuleDestroy {
  readonly #repository: ModerationCaseRepository;

  constructor(@Inject(API_ENVIRONMENT) environment: ApiEnvironment) {
    this.#repository = new ModerationCaseRepository({
      connectionString: environment.DATABASE_URL,
      poolMaximum: environment.DATABASE_POOL_MAX,
    });
  }

  list(input: ListModerationCasesInput): Promise<ListModerationCasesResult> {
    return this.#repository.list(input);
  }

  get(input: GetModerationCaseInput): Promise<GetModerationCaseResult> {
    return this.#repository.get(input);
  }

  commit(input: CommitModerationActionInput): Promise<CommitModerationActionResult> {
    return this.#repository.commit(input);
  }

  onModuleDestroy(): Promise<void> {
    return this.#repository.close();
  }
}
