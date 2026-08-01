import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Header,
  Headers,
  HttpCode,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UnprocessableEntityException,
} from "@nestjs/common";
import {
  createQueueReconciliationRunRequestSchema,
  createQueueReplayBatchRequestSchema,
  idempotencyKeySchema,
  listQueueDeadLettersQuerySchema,
  type AdminJobResponse,
  type CreateQueueReconciliationRunRequest,
  type CreateQueueReplayBatchRequest,
  type ListQueueDeadLettersQuery,
  type QueueDeadLetterCollection,
} from "@socal/contracts";
import type { FastifyRequest } from "fastify";
import { adminPolicyActions } from "../../common/authorization/policy";
import { RequestContextAccessor } from "../../common/authorization/request-context";
import { RequirePolicy } from "../../common/authorization/require-policy.decorator";
import { SchemaValidationPipe } from "../../common/schema-validation.pipe";
import {
  QueueOperationsAccessDeniedError,
  QueueOperationsCursorError,
  QueueOperationsIdempotencyConflictError,
  QueueOperationsInvalidTargetError,
  QueueOperationsJobNotFoundError,
  QueueOperationsService,
} from "./queue-operations.service";

@Controller("admin/system")
export class QueueOperationsController {
  constructor(
    private readonly operations: QueueOperationsService,
    private readonly contexts: RequestContextAccessor,
  ) {}

  @Get("queue/dead-letters")
  @RequirePolicy(adminPolicyActions.queueOperationsRead)
  @Header("Cache-Control", "no-store")
  async list(
    @Req() request: FastifyRequest,
    @Query(new SchemaValidationPipe(listQueueDeadLettersQuerySchema))
    query: ListQueueDeadLettersQuery,
  ): Promise<QueueDeadLetterCollection> {
    try {
      return await this.operations.listDeadLetters(this.contexts.require(request), query);
    } catch (error) {
      this.#rethrow(error);
    }
  }

  @Post("queue/replay-batches")
  @HttpCode(202)
  @RequirePolicy(adminPolicyActions.queueOperationsAct)
  @Header("Cache-Control", "no-store")
  async replay(
    @Req() request: FastifyRequest,
    @Headers("idempotency-key") rawIdempotencyKey: string | undefined,
    @Body(new SchemaValidationPipe(createQueueReplayBatchRequestSchema))
    input: CreateQueueReplayBatchRequest,
  ): Promise<AdminJobResponse> {
    const idempotencyKey = new SchemaValidationPipe(idempotencyKeySchema).transform(
      rawIdempotencyKey,
    );
    try {
      return await this.operations.createReplayBatch(
        this.contexts.require(request),
        idempotencyKey,
        input,
      );
    } catch (error) {
      this.#rethrow(error);
    }
  }

  @Post("queue/reconciliation-runs")
  @HttpCode(202)
  @RequirePolicy(adminPolicyActions.queueOperationsAct)
  @Header("Cache-Control", "no-store")
  async reconcile(
    @Req() request: FastifyRequest,
    @Headers("idempotency-key") rawIdempotencyKey: string | undefined,
    @Body(new SchemaValidationPipe(createQueueReconciliationRunRequestSchema))
    input: CreateQueueReconciliationRunRequest,
  ): Promise<AdminJobResponse> {
    const idempotencyKey = new SchemaValidationPipe(idempotencyKeySchema).transform(
      rawIdempotencyKey,
    );
    try {
      return await this.operations.createReconciliationRun(
        this.contexts.require(request),
        idempotencyKey,
        input,
      );
    } catch (error) {
      this.#rethrow(error);
    }
  }

  @Get("jobs/:jobId")
  @RequirePolicy(adminPolicyActions.queueOperationsRead)
  @Header("Cache-Control", "no-store")
  async getJob(
    @Req() request: FastifyRequest,
    @Param("jobId", new ParseUUIDPipe({ version: "4" })) jobId: string,
  ): Promise<AdminJobResponse> {
    try {
      return await this.operations.getJob(this.contexts.require(request), jobId);
    } catch (error) {
      this.#rethrow(error);
    }
  }

  #rethrow(error: unknown): never {
    if (error instanceof QueueOperationsCursorError) {
      throw new BadRequestException("Queue cursor is invalid");
    }
    if (error instanceof QueueOperationsAccessDeniedError) {
      throw new ForbiddenException("Access denied");
    }
    if (error instanceof QueueOperationsIdempotencyConflictError) {
      throw new ConflictException("Idempotency-Key was already used with different input");
    }
    if (error instanceof QueueOperationsInvalidTargetError) {
      throw new UnprocessableEntityException("One or more replay targets are unavailable");
    }
    if (error instanceof QueueOperationsJobNotFoundError) {
      throw new NotFoundException("Admin job not found");
    }
    throw error;
  }
}
