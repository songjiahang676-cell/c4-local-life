import { Controller, Get, Header, Query } from "@nestjs/common";
import {
  listCategoriesQuerySchema,
  listRegionsQuerySchema,
  type CategoryCollectionResponse,
  type ListCategoriesQuery,
  type ListRegionsQuery,
  type RegionCollectionResponse,
} from "@socal/contracts";
import { SchemaValidationPipe } from "../../common/schema-validation.pipe";
import { TaxonomyService } from "./taxonomy.service";

const taxonomyCacheControl = "public, max-age=300, stale-while-revalidate=3600";

@Controller()
export class TaxonomyController {
  constructor(private readonly taxonomy: TaxonomyService) {}

  @Get("regions")
  @Header("Cache-Control", taxonomyCacheControl)
  listRegions(
    @Query(new SchemaValidationPipe(listRegionsQuerySchema)) query: ListRegionsQuery,
  ): Promise<RegionCollectionResponse> {
    return this.taxonomy.listRegions(query);
  }

  @Get("categories")
  @Header("Cache-Control", taxonomyCacheControl)
  listCategories(
    @Query(new SchemaValidationPipe(listCategoriesQuerySchema)) query: ListCategoriesQuery,
  ): Promise<CategoryCollectionResponse> {
    return this.taxonomy.listCategories(query);
  }
}
