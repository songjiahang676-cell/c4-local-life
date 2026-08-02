import {
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
  Req,
  UnprocessableEntityException,
} from "@nestjs/common";
import {
  createSearchIndexRebuildRequestSchema,
  createSearchIndexRollbackRequestSchema,
  idempotencyKeySchema,
  type CreateSearchIndexRebuildRequest,
  type CreateSearchIndexRollbackRequest,
  type SearchIndexOperationResponse,
} from "@socal/contracts";
import type { FastifyRequest } from "fastify";
import { adminPolicyActions } from "../../common/authorization/policy";
import { RequestContextAccessor } from "../../common/authorization/request-context";
import { RequirePolicy } from "../../common/authorization/require-policy.decorator";
import { SchemaValidationPipe } from "../../common/schema-validation.pipe";
import {
  SearchIndexOperationNotFoundError,
  SearchIndexOperationsAccessDeniedError,
  SearchIndexOperationsConflictError,
  SearchIndexOperationsIdempotencyConflictError,
  SearchIndexOperationsService,
  SearchIndexRollbackUnavailableError,
} from "./search-index-operations.service";

@Controller("admin/system/search/rebuilds")
export class SearchIndexOperationsController {
  constructor(
    private readonly operations: SearchIndexOperationsService,
    private readonly contexts: RequestContextAccessor,
  ) {}

  @Post()
  @HttpCode(202)
  @RequirePolicy(adminPolicyActions.searchOperationsAct)
  @Header("Cache-Control", "no-store")
  async rebuild(
    @Req() request: FastifyRequest,
    @Headers("idempotency-key") rawIdempotencyKey: string | undefined,
    @Body(new SchemaValidationPipe(createSearchIndexRebuildRequestSchema))
    input: CreateSearchIndexRebuildRequest,
  ): Promise<SearchIndexOperationResponse> {
    const idempotencyKey = new SchemaValidationPipe(idempotencyKeySchema).transform(
      rawIdempotencyKey,
    );
    try {
      return await this.operations.createRebuild(
        this.contexts.require(request),
        idempotencyKey,
        input,
      );
    } catch (error) {
      this.#rethrow(error);
    }
  }

  @Get(":operationId")
  @RequirePolicy(adminPolicyActions.searchOperationsRead)
  @Header("Cache-Control", "no-store")
  async getOperation(
    @Req() request: FastifyRequest,
    @Param("operationId", new ParseUUIDPipe({ version: "4" })) operationId: string,
  ): Promise<SearchIndexOperationResponse> {
    try {
      return await this.operations.getOperation(this.contexts.require(request), operationId);
    } catch (error) {
      this.#rethrow(error);
    }
  }

  @Post(":operationId/rollback")
  @HttpCode(202)
  @RequirePolicy(adminPolicyActions.searchOperationsAct)
  @Header("Cache-Control", "no-store")
  async rollback(
    @Req() request: FastifyRequest,
    @Param("operationId", new ParseUUIDPipe({ version: "4" })) operationId: string,
    @Headers("idempotency-key") rawIdempotencyKey: string | undefined,
    @Body(new SchemaValidationPipe(createSearchIndexRollbackRequestSchema))
    input: CreateSearchIndexRollbackRequest,
  ): Promise<SearchIndexOperationResponse> {
    const idempotencyKey = new SchemaValidationPipe(idempotencyKeySchema).transform(
      rawIdempotencyKey,
    );
    try {
      return await this.operations.createRollback(
        this.contexts.require(request),
        idempotencyKey,
        operationId,
        input,
      );
    } catch (error) {
      this.#rethrow(error);
    }
  }

  #rethrow(error: unknown): never {
    if (error instanceof SearchIndexOperationsAccessDeniedError) {
      throw new ForbiddenException("Access denied");
    }
    if (error instanceof SearchIndexOperationsIdempotencyConflictError) {
      throw new ConflictException("Idempotency-Key was already used with different input");
    }
    if (error instanceof SearchIndexOperationsConflictError) {
      throw new ConflictException("Another search index operation is active");
    }
    if (error instanceof SearchIndexRollbackUnavailableError) {
      throw new UnprocessableEntityException("Search index rollback is unavailable");
    }
    if (error instanceof SearchIndexOperationNotFoundError) {
      throw new NotFoundException("Search index operation not found");
    }
    throw error;
  }
}
