import {
  BadRequestException,
  Controller,
  Get,
  GoneException,
  GatewayTimeoutException,
  Header,
  Query,
  Req,
  ServiceUnavailableException,
} from "@nestjs/common";
import {
  listingSearchSchema,
  searchSuggestionsQuerySchema,
  searchTrendingQuerySchema,
  type ListingSearchInput,
  type SearchResponse,
  type SearchSuggestionResponse,
  type SearchTrendingResponse,
  type ValidatedSearchSuggestionsQuery,
  type ValidatedSearchTrendingQuery,
} from "@socal/contracts";
import type { FastifyRequest } from "fastify";
import { SchemaValidationPipe } from "../../common/schema-validation.pipe";
import { SearchCursorExpiredError, SearchCursorInvalidError } from "./search-cursor";
import { SearchDiscoveryService } from "./search-discovery.service";
import { SearchDiscoveryUnavailableError } from "./search-discovery.store";
import { SearchService } from "./search.service";
import {
  SearchSnapshotExpiredError,
  SearchTimeoutError,
  SearchUnavailableError,
} from "./search.store";

@Controller("search")
export class SearchController {
  constructor(
    private readonly searchService: SearchService,
    private readonly searchDiscoveryService: SearchDiscoveryService,
  ) {}

  @Get()
  @Header("Cache-Control", "no-store")
  async search(
    @Query(new SchemaValidationPipe(listingSearchSchema)) query: ListingSearchInput,
    @Req() request: FastifyRequest,
  ): Promise<SearchResponse> {
    try {
      const acceptLanguage = request.headers["accept-language"] ?? "";
      return await this.searchService.search(query, new Date(), {
        ip: request.ip,
        userAgent: request.headers["user-agent"],
        locale: acceptLanguage.toLocaleLowerCase("en-US").startsWith("en") ? "en-US" : "zh-Hans",
      });
    } catch (error: unknown) {
      if (error instanceof SearchCursorInvalidError) {
        throw new BadRequestException(error.message);
      }
      if (
        error instanceof SearchCursorExpiredError ||
        error instanceof SearchSnapshotExpiredError
      ) {
        throw new GoneException("The search cursor has expired");
      }
      if (error instanceof SearchTimeoutError) {
        throw new GatewayTimeoutException(error.message);
      }
      if (error instanceof SearchUnavailableError) {
        throw new ServiceUnavailableException("Search is temporarily unavailable");
      }
      if (error instanceof SearchDiscoveryUnavailableError) {
        throw new ServiceUnavailableException("Search discovery is temporarily unavailable");
      }
      throw error;
    }
  }

  @Get("suggestions")
  @Header("Cache-Control", "private, no-store")
  async suggestions(
    @Query(new SchemaValidationPipe(searchSuggestionsQuerySchema))
    query: ValidatedSearchSuggestionsQuery,
  ): Promise<SearchSuggestionResponse> {
    try {
      return await this.searchDiscoveryService.suggestions(query);
    } catch (error: unknown) {
      if (error instanceof SearchDiscoveryUnavailableError) {
        throw new ServiceUnavailableException("Search discovery is temporarily unavailable");
      }
      throw error;
    }
  }

  @Get("trending")
  @Header("Cache-Control", "public, max-age=300")
  async trending(
    @Query(new SchemaValidationPipe(searchTrendingQuerySchema))
    query: ValidatedSearchTrendingQuery,
  ): Promise<SearchTrendingResponse> {
    try {
      return await this.searchDiscoveryService.trending(query);
    } catch (error: unknown) {
      if (error instanceof SearchDiscoveryUnavailableError) {
        throw new ServiceUnavailableException("Search discovery is temporarily unavailable");
      }
      throw error;
    }
  }
}
