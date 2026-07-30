import { Controller, Get, Query, Res, ServiceUnavailableException } from "@nestjs/common";
import {
  homepageQuerySchema,
  type HomepageResponse,
  type ValidatedHomepageQuery,
} from "@socal/contracts";
import { SchemaValidationPipe } from "../../common/schema-validation.pipe";
import type { FastifyReply } from "fastify";
import { HomepageLayoutNotFoundError } from "../homepage-layout/homepage-layout.service";
import { HomepageService } from "./homepage.service";

@Controller("homepage")
export class HomepageController {
  constructor(private readonly homepage: HomepageService) {}

  @Get()
  async get(
    @Query(new SchemaValidationPipe(homepageQuerySchema)) query: ValidatedHomepageQuery,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<HomepageResponse> {
    try {
      const response = await this.homepage.get(query);
      void reply.header(
        "Cache-Control",
        response.partial || response.modules.length === 0
          ? "no-store"
          : "public, max-age=0, s-maxage=30, stale-while-revalidate=30",
      );
      return response;
    } catch (error: unknown) {
      if (error instanceof HomepageLayoutNotFoundError) {
        throw new ServiceUnavailableException("Published homepage layout is unavailable");
      }
      throw error;
    }
  }
}
