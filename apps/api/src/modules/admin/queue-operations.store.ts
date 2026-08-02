import type {
  CreateQueueAdminJobResult,
  CreateQueueReconciliationJobInput,
  CreateQueueReplayJobInput,
  ListQueueDeadLettersInput,
  ListQueueDeadLettersResult,
  QueueAdminJobProjection,
} from "@socal/database/queue-operations";

export const QUEUE_OPERATIONS_STORE = Symbol("QUEUE_OPERATIONS_STORE");

export type QueueOperationsStore = {
  listDeadLetters(input: ListQueueDeadLettersInput): Promise<ListQueueDeadLettersResult>;
  createReplayJob(input: CreateQueueReplayJobInput): Promise<CreateQueueAdminJobResult>;
  createReconciliationJob(
    input: CreateQueueReconciliationJobInput,
  ): Promise<CreateQueueAdminJobResult>;
  getJob(jobId: string): Promise<QueueAdminJobProjection | null>;
};

export type {
  CreateQueueAdminJobResult,
  CreateQueueReconciliationJobInput,
  CreateQueueReplayJobInput,
  ListQueueDeadLettersInput,
  ListQueueDeadLettersResult,
  QueueAdminJobProjection,
};
