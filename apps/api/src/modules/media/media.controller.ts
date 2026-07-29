import {
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
  PayloadTooLargeException,
  Post,
  Req,
  Res,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from "@nestjs/common";
import {
  createUploadRequestSchema,
  idempotencyKeySchema,
  type CreateUploadRequest,
  type CreateUploadResponse,
  type MediaProcessingResponse,
  type MediaStatusResponse,
} from "@socal/contracts";
import type { FastifyReply, FastifyRequest } from "fastify";
import { activeUserPolicyActions } from "../../common/authorization/policy";
import { RequestContextAccessor } from "../../common/authorization/request-context";
import { RequirePolicy } from "../../common/authorization/require-policy.decorator";
import { SchemaValidationPipe } from "../../common/schema-validation.pipe";
import {
  MediaDeclarationUnsupportedError,
  MediaFileTooLargeError,
  MediaIdempotencyConflictError,
  MediaObjectInvalidError,
  MediaService,
  MediaStorageUnavailableError,
  MediaUploadNotFoundError,
  MediaUploadQuotaExceededError,
  MediaUploadStateConflictError,
} from "./media.service";

@Controller("media")
export class MediaController {
  constructor(
    private readonly media: MediaService,
    private readonly contexts: RequestContextAccessor,
  ) {}

  @Post("uploads")
  @HttpCode(201)
  @RequirePolicy(activeUserPolicyActions.mediaUploadCreate)
  @Header("Cache-Control", "no-store")
  async createUpload(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Headers("idempotency-key") rawIdempotencyKey: string | undefined,
    @Body(new SchemaValidationPipe(createUploadRequestSchema)) input: CreateUploadRequest,
  ): Promise<CreateUploadResponse> {
    const idempotencyKey = new SchemaValidationPipe(idempotencyKeySchema).transform(
      rawIdempotencyKey,
    );
    try {
      return await this.media.createUploadIntent(
        this.contexts.require(request),
        idempotencyKey,
        input,
      );
    } catch (error) {
      if (error instanceof MediaIdempotencyConflictError) {
        throw new ConflictException(error.message);
      }
      if (error instanceof MediaFileTooLargeError) {
        throw new PayloadTooLargeException(error.message);
      }
      if (error instanceof MediaDeclarationUnsupportedError) {
        throw new UnprocessableEntityException(error.message);
      }
      if (error instanceof MediaUploadQuotaExceededError) {
        const retryAfterSeconds = Math.max(
          1,
          Math.ceil((error.retryAfter.getTime() - Date.now()) / 1_000),
        );
        void reply.header("Retry-After", retryAfterSeconds);
        throw new HttpException(error.message, HttpStatus.TOO_MANY_REQUESTS);
      }
      if (error instanceof MediaStorageUnavailableError) {
        throw new ServiceUnavailableException(error.message);
      }
      if (error instanceof ForbiddenException) throw error;
      throw error;
    }
  }

  @Get(":mediaId")
  @RequirePolicy(activeUserPolicyActions.mediaUploadComplete)
  @Header("Cache-Control", "no-store")
  async getStatus(
    @Req() request: FastifyRequest,
    @Param("mediaId", new ParseUUIDPipe({ version: "4" })) mediaId: string,
  ): Promise<MediaStatusResponse> {
    try {
      return await this.media.getStatus(this.contexts.require(request), mediaId);
    } catch (error) {
      if (error instanceof MediaUploadNotFoundError) {
        throw new NotFoundException(error.message);
      }
      throw error;
    }
  }

  @Post(":mediaId/complete")
  @HttpCode(202)
  @RequirePolicy(activeUserPolicyActions.mediaUploadComplete)
  @Header("Cache-Control", "no-store")
  async completeUpload(
    @Req() request: FastifyRequest,
    @Param("mediaId", new ParseUUIDPipe({ version: "4" })) mediaId: string,
  ): Promise<MediaProcessingResponse> {
    try {
      return await this.media.completeUpload(this.contexts.require(request), mediaId);
    } catch (error) {
      if (error instanceof MediaUploadNotFoundError) {
        throw new NotFoundException(error.message);
      }
      if (error instanceof MediaUploadStateConflictError) {
        throw new ConflictException(error.message);
      }
      if (error instanceof MediaObjectInvalidError) {
        throw new UnprocessableEntityException(error.message);
      }
      if (error instanceof MediaStorageUnavailableError) {
        throw new ServiceUnavailableException(error.message);
      }
      throw error;
    }
  }
}
