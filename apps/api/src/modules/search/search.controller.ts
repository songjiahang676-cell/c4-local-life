import {
  BadRequestException,
  Controller,
  Get,
  GoneException,
  GatewayTimeoutException,
  Header,
  Query,
  ServiceUnavailableException,
} from "@nestjs/common";
import {
  listingSearchSchema,
  type ListingSearchInput,
  type SearchResponse,
} from "@socal/contracts";
import { SchemaValidationPipe } from "../../common/schema-validation.pipe";
import { SearchCursorExpiredError, SearchCursorInvalidError } from "./search-cursor";
import { SearchService } from "./search.service";
import {
  SearchSnapshotExpiredError,
  SearchTimeoutError,
  SearchUnavailableError,
} from "./search.store";

@Controller("search")
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  @Get()
  @Header("Cache-Control", "no-store")
  async search(
    @Query(new SchemaValidationPipe(listingSearchSchema)) query: ListingSearchInput,
  ): Promise<SearchResponse> {
    try {
      return await this.searchService.search(query);
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
      throw error;
    }
  }
}
