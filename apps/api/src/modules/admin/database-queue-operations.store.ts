import { Inject, Injectable, type OnModuleDestroy } from "@nestjs/common";
import type { ApiEnvironment } from "@socal/config";
import {
  QueueOperationsRepository,
  type CreateQueueAdminJobResult,
  type CreateQueueReconciliationJobInput,
  type CreateQueueReplayJobInput,
  type ListQueueDeadLettersInput,
  type ListQueueDeadLettersResult,
  type QueueAdminJobProjection,
} from "@socal/database/queue-operations";
import { API_ENVIRONMENT } from "../../common/api-environment.token";
import type { QueueOperationsStore } from "./queue-operations.store";

@Injectable()
export class DatabaseQueueOperationsStore implements QueueOperationsStore, OnModuleDestroy {
  readonly #repository: QueueOperationsRepository;

  constructor(@Inject(API_ENVIRONMENT) environment: ApiEnvironment) {
    this.#repository = new QueueOperationsRepository({
      connectionString: environment.DATABASE_URL,
      poolMaximum: environment.DATABASE_POOL_MAX,
    });
  }

  listDeadLetters(input: ListQueueDeadLettersInput): Promise<ListQueueDeadLettersResult> {
    return this.#repository.listDeadLetters(input);
  }

  createReplayJob(input: CreateQueueReplayJobInput): Promise<CreateQueueAdminJobResult> {
    return this.#repository.createReplayJob(input);
  }

  createReconciliationJob(
    input: CreateQueueReconciliationJobInput,
  ): Promise<CreateQueueAdminJobResult> {
    return this.#repository.createReconciliationJob(input);
  }

  getJob(jobId: string): Promise<QueueAdminJobProjection | null> {
    return this.#repository.getJob(jobId);
  }

  onModuleDestroy(): Promise<void> {
    return this.#repository.close();
  }
}
