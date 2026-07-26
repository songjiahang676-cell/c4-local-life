import { Body, Controller, Get, Post, Query } from "@nestjs/common";
import {
  createListingSchema,
  listListingsQuerySchema,
  type CreateListingInput,
  type ListListingsQuery,
} from "@socal/contracts";
import { SchemaValidationPipe } from "../../common/schema-validation.pipe";
import { ListingsService, type ListingSummary } from "./listings.service";

@Controller("listings")
export class ListingsController {
  constructor(private readonly listings: ListingsService) {}

  @Get()
  list(@Query(new SchemaValidationPipe(listListingsQuerySchema)) query: ListListingsQuery): {
    data: ListingSummary[];
    meta: { count: number };
  } {
    const data = this.listings.list(query.type, query.limit);
    return { data, meta: { count: data.length } };
  }

  @Post()
  create(@Body(new SchemaValidationPipe(createListingSchema)) input: CreateListingInput): {
    data: ListingSummary;
  } {
    return { data: this.listings.create(input) };
  }
}
