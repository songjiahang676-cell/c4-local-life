import {
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Header,
  Headers,
  HttpCode,
  HttpException,
  HttpStatus,
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
  MediaService,
  MediaStorageUnavailableError,
  MediaUploadQuotaExceededError,
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
}
