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
  HttpException,
  HttpStatus,
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
  appealModerationActionRequestSchema,
  createModerationAppealRequestSchema,
  createReportRequestSchema,
  idempotencyKeySchema,
  listAppealModerationCasesQuerySchema,
  listReportModerationCasesQuerySchema,
  reportModerationActionRequestSchema,
  type AppealModerationActionRequest,
  type AppealModerationCaseCollection,
  type AppealModerationCaseDetailResponse,
  type CreateModerationAppealRequest,
  type CreateReportRequest,
  type ListAppealModerationCasesQuery,
  type ListReportModerationCasesQuery,
  type ModerationAppealReceiptResponse,
  type ReportModerationActionRequest,
  type ReportModerationCaseCollection,
  type ReportModerationCaseDetailResponse,
  type ReportReceiptResponse,
  type TrustSafetyActionResponse,
} from "@socal/contracts";
import type { FastifyReply, FastifyRequest } from "fastify";
import { activeUserPolicyActions, adminPolicyActions } from "../../common/authorization/policy";
import { RequestContextAccessor } from "../../common/authorization/request-context";
import { RequirePolicy } from "../../common/authorization/require-policy.decorator";
import { SchemaValidationPipe } from "../../common/schema-validation.pipe";
import {
  trustSafetyCaseEtag,
  trustSafetyCaseVersionFromEtag,
  TrustSafetyAccessDeniedError,
  TrustSafetyCursorError,
  TrustSafetyIdempotencyConflictError,
  TrustSafetyNotFoundError,
  TrustSafetyRateLimitError,
  TrustSafetyService,
  TrustSafetyStateConflictError,
  TrustSafetyValidationError,
} from "./trust-safety.service";

function rethrowTrustSafety(error: unknown, reply?: FastifyReply): never {
  if (error instanceof TrustSafetyCursorError) {
    throw new BadRequestException("Cursor is invalid");
  }
  if (error instanceof TrustSafetyAccessDeniedError) {
    throw new ForbiddenException("Access denied");
  }
  if (error instanceof TrustSafetyNotFoundError) {
    throw new NotFoundException("Resource not found");
  }
  if (error instanceof TrustSafetyRateLimitError) {
    throw new HttpException("Too many reports", HttpStatus.TOO_MANY_REQUESTS);
  }
  if (error instanceof TrustSafetyIdempotencyConflictError) {
    throw new ConflictException("Idempotency-Key was already used with different input");
  }
  if (error instanceof TrustSafetyStateConflictError) {
    if (error.currentVersion) {
      void reply?.header("ETag", trustSafetyCaseEtag(error.currentVersion));
    }
    throw new ConflictException("Resource state changed; reload before retrying");
  }
  if (error instanceof TrustSafetyValidationError) {
    throw new UnprocessableEntityException("Action is invalid for the current state");
  }
  throw error;
}

function requiredCaseVersion(rawIfMatch: string | undefined): number {
  const version = trustSafetyCaseVersionFromEtag(rawIfMatch);
  if (!version) {
    throw new BadRequestException("A valid If-Match trust-safety case ETag is required");
  }
  return version;
}

function requiredIdempotencyKey(value: string | undefined): string {
  return new SchemaValidationPipe(idempotencyKeySchema).transform(value);
}

@Controller()
export class PublicTrustSafetyController {
  constructor(
    private readonly trustSafety: TrustSafetyService,
    private readonly contexts: RequestContextAccessor,
  ) {}

  @Post("reports")
  @HttpCode(202)
  @RequirePolicy(activeUserPolicyActions.reportCreate)
  @Header("Cache-Control", "no-store")
  async createReport(
    @Req() request: FastifyRequest,
    @Headers("idempotency-key") rawIdempotencyKey: string | undefined,
    @Body(new SchemaValidationPipe(createReportRequestSchema))
    input: CreateReportRequest,
  ): Promise<ReportReceiptResponse> {
    try {
      return await this.trustSafety.createReport(
        this.contexts.require(request),
        requiredIdempotencyKey(rawIdempotencyKey),
        input,
      );
    } catch (error) {
      rethrowTrustSafety(error);
    }
  }

  @Post("appeals")
  @HttpCode(202)
  @RequirePolicy(activeUserPolicyActions.moderationAppealCreate)
  @Header("Cache-Control", "no-store")
  async createAppeal(
    @Req() request: FastifyRequest,
    @Headers("idempotency-key") rawIdempotencyKey: string | undefined,
    @Body(new SchemaValidationPipe(createModerationAppealRequestSchema))
    input: CreateModerationAppealRequest,
  ): Promise<ModerationAppealReceiptResponse> {
    try {
      return await this.trustSafety.createAppeal(
        this.contexts.require(request),
        requiredIdempotencyKey(rawIdempotencyKey),
        input,
      );
    } catch (error) {
      rethrowTrustSafety(error);
    }
  }
}

@Controller("admin/moderation/reports")
export class ReportModerationController {
  constructor(
    private readonly trustSafety: TrustSafetyService,
    private readonly contexts: RequestContextAccessor,
  ) {}

  @Get()
  @RequirePolicy(adminPolicyActions.moderationRead)
  @Header("Cache-Control", "no-store")
  async list(
    @Req() request: FastifyRequest,
    @Query(new SchemaValidationPipe(listReportModerationCasesQuerySchema))
    query: ListReportModerationCasesQuery,
  ): Promise<ReportModerationCaseCollection> {
    try {
      return await this.trustSafety.listReports(this.contexts.require(request), query);
    } catch (error) {
      rethrowTrustSafety(error);
    }
  }

  @Get(":reportId")
  @RequirePolicy(adminPolicyActions.moderationRead)
  @Header("Cache-Control", "no-store")
  async get(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Param("reportId", new ParseUUIDPipe({ version: "4" })) reportId: string,
  ): Promise<ReportModerationCaseDetailResponse> {
    try {
      const response = await this.trustSafety.getReport(this.contexts.require(request), reportId);
      void reply.header("ETag", trustSafetyCaseEtag(response.data.case.caseVersion));
      return response;
    } catch (error) {
      rethrowTrustSafety(error, reply);
    }
  }

  @Post(":reportId/actions")
  @HttpCode(200)
  @RequirePolicy(adminPolicyActions.moderationAct)
  @Header("Cache-Control", "no-store")
  async act(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Param("reportId", new ParseUUIDPipe({ version: "4" })) reportId: string,
    @Headers("if-match") rawIfMatch: string | undefined,
    @Headers("idempotency-key") rawIdempotencyKey: string | undefined,
    @Body(new SchemaValidationPipe(reportModerationActionRequestSchema))
    input: ReportModerationActionRequest,
  ): Promise<TrustSafetyActionResponse> {
    try {
      const response = await this.trustSafety.actOnReport(
        this.contexts.require(request),
        reportId,
        requiredCaseVersion(rawIfMatch),
        requiredIdempotencyKey(rawIdempotencyKey),
        input,
      );
      void reply.header("ETag", trustSafetyCaseEtag(response.data.caseVersion));
      return response;
    } catch (error) {
      rethrowTrustSafety(error, reply);
    }
  }
}

@Controller("admin/moderation/appeals")
export class AppealModerationController {
  constructor(
    private readonly trustSafety: TrustSafetyService,
    private readonly contexts: RequestContextAccessor,
  ) {}

  @Get()
  @RequirePolicy(adminPolicyActions.moderationRead)
  @Header("Cache-Control", "no-store")
  async list(
    @Req() request: FastifyRequest,
    @Query(new SchemaValidationPipe(listAppealModerationCasesQuerySchema))
    query: ListAppealModerationCasesQuery,
  ): Promise<AppealModerationCaseCollection> {
    try {
      return await this.trustSafety.listAppeals(this.contexts.require(request), query);
    } catch (error) {
      rethrowTrustSafety(error);
    }
  }

  @Get(":appealId")
  @RequirePolicy(adminPolicyActions.moderationRead)
  @Header("Cache-Control", "no-store")
  async get(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Param("appealId", new ParseUUIDPipe({ version: "4" })) appealId: string,
  ): Promise<AppealModerationCaseDetailResponse> {
    try {
      const response = await this.trustSafety.getAppeal(this.contexts.require(request), appealId);
      void reply.header("ETag", trustSafetyCaseEtag(response.data.case.caseVersion));
      return response;
    } catch (error) {
      rethrowTrustSafety(error, reply);
    }
  }

  @Post(":appealId/actions")
  @HttpCode(200)
  @RequirePolicy(adminPolicyActions.moderationAct)
  @Header("Cache-Control", "no-store")
  async act(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Param("appealId", new ParseUUIDPipe({ version: "4" })) appealId: string,
    @Headers("if-match") rawIfMatch: string | undefined,
    @Headers("idempotency-key") rawIdempotencyKey: string | undefined,
    @Body(new SchemaValidationPipe(appealModerationActionRequestSchema))
    input: AppealModerationActionRequest,
  ): Promise<TrustSafetyActionResponse> {
    try {
      const response = await this.trustSafety.actOnAppeal(
        this.contexts.require(request),
        appealId,
        requiredCaseVersion(rawIfMatch),
        requiredIdempotencyKey(rawIdempotencyKey),
        input,
      );
      void reply.header("ETag", trustSafetyCaseEtag(response.data.caseVersion));
      return response;
    } catch (error) {
      rethrowTrustSafety(error, reply);
    }
  }
}
