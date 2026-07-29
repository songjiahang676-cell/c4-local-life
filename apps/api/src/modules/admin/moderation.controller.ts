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
  Res,
  UnprocessableEntityException,
} from "@nestjs/common";
import {
  idempotencyKeySchema,
  listModerationCasesQuerySchema,
  moderationActionRequestSchema,
  type ListModerationCasesQuery,
  type ModerationActionRequest,
  type ModerationActionResponse,
  type ModerationCaseCollection,
  type ModerationCaseDetailResponse,
} from "@socal/contracts";
import type { FastifyReply, FastifyRequest } from "fastify";
import { adminPolicyActions } from "../../common/authorization/policy";
import { RequestContextAccessor } from "../../common/authorization/request-context";
import { RequirePolicy } from "../../common/authorization/require-policy.decorator";
import { SchemaValidationPipe } from "../../common/schema-validation.pipe";
import {
  moderationCaseEtag,
  moderationCaseVersionFromEtag,
  ModerationAccessDeniedError,
  ModerationCaseNotFoundError,
  ModerationCursorError,
  ModerationIdempotencyConflictError,
  ModerationService,
  ModerationStateConflictError,
  ModerationValidationError,
} from "./moderation.service";

@Controller("admin/moderation/cases")
export class ModerationController {
  constructor(
    private readonly moderation: ModerationService,
    private readonly contexts: RequestContextAccessor,
  ) {}

  @Get()
  @RequirePolicy(adminPolicyActions.moderationRead)
  @Header("Cache-Control", "no-store")
  async list(
    @Req() request: FastifyRequest,
    @Query(new SchemaValidationPipe(listModerationCasesQuerySchema))
    query: ListModerationCasesQuery,
  ): Promise<ModerationCaseCollection> {
    try {
      return await this.moderation.list(this.contexts.require(request), query);
    } catch (error) {
      this.#rethrow(error);
    }
  }

  @Get(":caseId")
  @RequirePolicy(adminPolicyActions.moderationRead)
  @Header("Cache-Control", "no-store")
  async get(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Param("caseId", new ParseUUIDPipe({ version: "4" })) caseId: string,
  ): Promise<ModerationCaseDetailResponse> {
    try {
      const response = await this.moderation.get(this.contexts.require(request), caseId);
      void reply.header("ETag", moderationCaseEtag(response.data.case.version));
      return response;
    } catch (error) {
      this.#rethrow(error, reply);
    }
  }

  @Post(":caseId/actions")
  @HttpCode(200)
  @RequirePolicy(adminPolicyActions.moderationAct)
  @Header("Cache-Control", "no-store")
  async act(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Param("caseId", new ParseUUIDPipe({ version: "4" })) caseId: string,
    @Headers("if-match") rawIfMatch: string | undefined,
    @Headers("idempotency-key") rawIdempotencyKey: string | undefined,
    @Body(new SchemaValidationPipe(moderationActionRequestSchema)) input: ModerationActionRequest,
  ): Promise<ModerationActionResponse> {
    const expectedCaseVersion = moderationCaseVersionFromEtag(rawIfMatch);
    if (!expectedCaseVersion) {
      throw new BadRequestException("A valid If-Match moderation case ETag is required");
    }
    const idempotencyKey = new SchemaValidationPipe(idempotencyKeySchema).transform(
      rawIdempotencyKey,
    );
    try {
      const response = await this.moderation.act(
        this.contexts.require(request),
        caseId,
        expectedCaseVersion,
        idempotencyKey,
        input,
      );
      void reply.header("ETag", moderationCaseEtag(response.data.caseVersion));
      return response;
    } catch (error) {
      this.#rethrow(error, reply);
    }
  }

  #rethrow(error: unknown, reply?: FastifyReply): never {
    if (error instanceof ModerationCursorError) {
      throw new BadRequestException("Moderation cursor is invalid");
    }
    if (error instanceof ModerationAccessDeniedError) {
      throw new ForbiddenException("Access denied");
    }
    if (error instanceof ModerationCaseNotFoundError) {
      throw new NotFoundException("Moderation case not found");
    }
    if (error instanceof ModerationIdempotencyConflictError) {
      throw new ConflictException("Idempotency-Key was already used with different input");
    }
    if (error instanceof ModerationStateConflictError) {
      if (error.currentVersion) {
        void reply?.header("ETag", moderationCaseEtag(error.currentVersion));
      }
      throw new ConflictException("Moderation case changed; reload before retrying");
    }
    if (error instanceof ModerationValidationError) {
      throw new UnprocessableEntityException("Moderation action is invalid for the current state");
    }
    throw error;
  }
}
