import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Header,
  Headers,
  HttpCode,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res,
  UnprocessableEntityException,
} from "@nestjs/common";
import {
  createListingSchema,
  idempotencyKeySchema,
  listListingsQuerySchema,
  updateListingSchema,
  type CreateListingInput,
  type ListListingsQuery,
  type ListingOwnerResponse,
  type ListingResponse,
  type ListingSubmissionResponse,
  type UpdateListingInput,
} from "@socal/contracts";
import type { FastifyReply, FastifyRequest } from "fastify";
import { activeUserPolicyActions } from "../../common/authorization/policy";
import { RequestContextAccessor } from "../../common/authorization/request-context";
import { RequirePolicy } from "../../common/authorization/require-policy.decorator";
import { SchemaValidationPipe } from "../../common/schema-validation.pipe";
import {
  ListingAccessDeniedError,
  ListingCursorError,
  ListingIdempotencyConflictError,
  listingEtag,
  ListingNotFoundError,
  ListingsService,
  ListingStateConflictError,
  ListingValidationError,
  ListingVersionConflictError,
  listingVersionFromEtag,
} from "./listings.service";

@Controller("listings")
export class ListingsController {
  constructor(
    private readonly listings: ListingsService,
    private readonly contexts: RequestContextAccessor,
  ) {}

  @Get()
  @Header("Cache-Control", "public, max-age=30")
  async list(
    @Query(new SchemaValidationPipe(listListingsQuerySchema)) query: ListListingsQuery,
  ): ReturnType<ListingsService["list"]> {
    try {
      return await this.listings.list(query);
    } catch (error) {
      if (error instanceof ListingCursorError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }

  @Post()
  @HttpCode(201)
  @RequirePolicy(activeUserPolicyActions.listingDraftCreate)
  @Header("Cache-Control", "no-store")
  async create(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Headers("idempotency-key") rawIdempotencyKey: string | undefined,
    @Body(new SchemaValidationPipe(createListingSchema)) input: CreateListingInput,
  ): Promise<ListingOwnerResponse> {
    const idempotencyKey = new SchemaValidationPipe(idempotencyKeySchema).transform(
      rawIdempotencyKey,
    );
    try {
      const response = await this.listings.create(
        this.contexts.require(request),
        idempotencyKey,
        input,
      );
      void reply
        .header("ETag", listingEtag(response.data.version))
        .header("Location", `/v1/listings/${response.data.id}`);
      return response;
    } catch (error) {
      this.#rethrow(error, reply);
    }
  }

  @Post(":listingId/submit")
  @HttpCode(202)
  @RequirePolicy(activeUserPolicyActions.listingSubmit)
  @Header("Cache-Control", "no-store")
  async submit(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Param("listingId", new ParseUUIDPipe({ version: "4" })) listingId: string,
    @Headers("if-match") rawIfMatch: string | undefined,
    @Headers("idempotency-key") rawIdempotencyKey: string | undefined,
  ): Promise<ListingSubmissionResponse> {
    const expectedVersion = listingVersionFromEtag(rawIfMatch);
    if (!expectedVersion) {
      throw new BadRequestException("A valid If-Match Listing ETag is required");
    }
    const idempotencyKey = new SchemaValidationPipe(idempotencyKeySchema).transform(
      rawIdempotencyKey,
    );
    try {
      const response = await this.listings.submit(
        this.contexts.require(request),
        listingId,
        expectedVersion,
        idempotencyKey,
      );
      void reply.header("ETag", listingEtag(response.data.version));
      return response;
    } catch (error) {
      this.#rethrow(error, reply);
    }
  }

  @Get(":listingId")
  async get(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Param("listingId", new ParseUUIDPipe({ version: "4" })) listingId: string,
  ): Promise<ListingResponse> {
    try {
      const result = await this.listings.get(this.contexts.require(request), listingId);
      void reply
        .header("ETag", listingEtag(result.version))
        .header("Cache-Control", result.privateView ? "no-store" : "public, max-age=60")
        .header("Vary", "Cookie");
      return result.response;
    } catch (error) {
      this.#rethrow(error, reply);
    }
  }

  @Patch(":listingId")
  @RequirePolicy(activeUserPolicyActions.listingDraftUpdate)
  @Header("Cache-Control", "no-store")
  async update(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Param("listingId", new ParseUUIDPipe({ version: "4" })) listingId: string,
    @Headers("if-match") rawIfMatch: string | undefined,
    @Body(new SchemaValidationPipe(updateListingSchema)) input: UpdateListingInput,
  ): Promise<ListingOwnerResponse> {
    const expectedVersion = listingVersionFromEtag(rawIfMatch);
    if (!expectedVersion) {
      throw new BadRequestException("A valid If-Match Listing ETag is required");
    }
    try {
      const response = await this.listings.update(
        this.contexts.require(request),
        listingId,
        expectedVersion,
        input,
      );
      void reply.header("ETag", listingEtag(response.data.version));
      return response;
    } catch (error) {
      this.#rethrow(error, reply);
    }
  }

  @Put(":listingId/archive")
  @RequirePolicy(activeUserPolicyActions.listingArchive)
  @Header("Cache-Control", "no-store")
  async archive(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Param("listingId", new ParseUUIDPipe({ version: "4" })) listingId: string,
    @Headers("if-match") rawIfMatch: string | undefined,
  ): Promise<ListingOwnerResponse> {
    const expectedVersion = listingVersionFromEtag(rawIfMatch);
    if (!expectedVersion) {
      throw new BadRequestException("A valid If-Match Listing ETag is required");
    }
    try {
      const response = await this.listings.archive(
        this.contexts.require(request),
        listingId,
        expectedVersion,
      );
      void reply.header("ETag", listingEtag(response.data.version));
      return response;
    } catch (error) {
      this.#rethrow(error, reply);
    }
  }

  @Delete(":listingId")
  @HttpCode(204)
  @RequirePolicy(activeUserPolicyActions.listingDelete)
  @Header("Cache-Control", "no-store")
  async delete(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Param("listingId", new ParseUUIDPipe({ version: "4" })) listingId: string,
    @Headers("if-match") rawIfMatch: string | undefined,
  ): Promise<void> {
    const expectedVersion = listingVersionFromEtag(rawIfMatch);
    if (!expectedVersion) {
      throw new BadRequestException("A valid If-Match Listing ETag is required");
    }
    try {
      await this.listings.delete(this.contexts.require(request), listingId, expectedVersion);
    } catch (error) {
      this.#rethrow(error, reply);
    }
  }

  #rethrow(error: unknown, reply: FastifyReply): never {
    if (error instanceof ListingNotFoundError) {
      throw new NotFoundException("Listing not found");
    }
    if (error instanceof ListingAccessDeniedError) {
      throw new ForbiddenException("Access denied");
    }
    if (error instanceof ListingCursorError) {
      throw new BadRequestException(error.message);
    }
    if (error instanceof ListingIdempotencyConflictError) {
      throw new ConflictException(error.message);
    }
    if (error instanceof ListingVersionConflictError) {
      if (error.currentVersion) {
        void reply.header("ETag", listingEtag(error.currentVersion));
      }
      throw new ConflictException("Listing version conflict");
    }
    if (error instanceof ListingStateConflictError) {
      throw new ConflictException(error.message);
    }
    if (error instanceof ListingValidationError) {
      throw new UnprocessableEntityException({
        message: error.message,
        ...(error.errors ? { errors: error.errors } : {}),
      });
    }
    throw error;
  }
}
