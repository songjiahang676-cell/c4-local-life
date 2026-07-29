import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import {
  batchListingActionSchema,
  listMyListingsQuerySchema,
  type BatchListingActionRequest,
  type BatchListingActionResponse,
  type ListMyListingsQuery,
  type MyListingCollection,
} from "@socal/contracts";
import type { FastifyRequest } from "fastify";
import {
  activeUserPolicyActions,
  selfServicePolicyActions,
} from "../../common/authorization/policy";
import { RequestContextAccessor } from "../../common/authorization/request-context";
import { RequirePolicy } from "../../common/authorization/require-policy.decorator";
import { SchemaValidationPipe } from "../../common/schema-validation.pipe";
import { ListingCursorError, ListingsService } from "./listings.service";

@Controller("me/listings")
export class AccountListingsController {
  constructor(
    private readonly listings: ListingsService,
    private readonly contexts: RequestContextAccessor,
  ) {}

  @Get()
  @Header("Cache-Control", "no-store")
  @Header("Pragma", "no-cache")
  @Header("Vary", "Cookie")
  @RequirePolicy(selfServicePolicyActions.listingsRead)
  async list(
    @Req() request: FastifyRequest,
    @Query(new SchemaValidationPipe(listMyListingsQuerySchema)) query: ListMyListingsQuery,
  ): Promise<MyListingCollection> {
    try {
      return await this.listings.listMine(this.contexts.require(request), query);
    } catch (error) {
      if (error instanceof ListingCursorError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }

  @Post("actions")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  @Header("Pragma", "no-cache")
  @Header("Vary", "Cookie")
  @RequirePolicy(activeUserPolicyActions.listingBatchManage)
  batchManage(
    @Req() request: FastifyRequest,
    @Body(new SchemaValidationPipe(batchListingActionSchema)) input: BatchListingActionRequest,
  ): Promise<BatchListingActionResponse> {
    return this.listings.batchManage(this.contexts.require(request), input);
  }
}
