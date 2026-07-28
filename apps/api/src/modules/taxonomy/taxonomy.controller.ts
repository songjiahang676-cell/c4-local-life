import {
  Controller,
  Get,
  Header,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Query,
  Res,
} from "@nestjs/common";
import {
  getCategoryFormSchemaQuerySchema,
  listCategoriesQuerySchema,
  listRegionsQuerySchema,
  type CategoryCollectionResponse,
  type CategoryFormSchema,
  type GetCategoryFormSchemaQuery,
  type ListCategoriesQuery,
  type ListRegionsQuery,
  type RegionCollectionResponse,
} from "@socal/contracts";
import type { FastifyReply } from "fastify";
import { SchemaValidationPipe } from "../../common/schema-validation.pipe";
import { CategoryFormSchemaNotFoundError, TaxonomyService } from "./taxonomy.service";

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

  @Get("categories/:categoryId/form-schema")
  async getCategoryFormSchema(
    @Param("categoryId", new ParseUUIDPipe({ version: "4" })) categoryId: string,
    @Query(new SchemaValidationPipe(getCategoryFormSchemaQuerySchema))
    query: GetCategoryFormSchemaQuery,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<CategoryFormSchema> {
    try {
      const result = await this.taxonomy.getPublishedFormSchema(categoryId, query);
      void reply
        .header("etag", `"${result.contentHash}"`)
        .header(
          "cache-control",
          query.version === undefined
            ? taxonomyCacheControl
            : "public, max-age=31536000, immutable",
        );
      return result.definition;
    } catch (error) {
      if (error instanceof CategoryFormSchemaNotFoundError) {
        throw new NotFoundException("Category form schema not found");
      }
      throw error;
    }
  }
}
