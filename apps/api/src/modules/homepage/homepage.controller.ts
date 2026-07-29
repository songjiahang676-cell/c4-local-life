import { Controller, Get, Header, Query, ServiceUnavailableException } from "@nestjs/common";
import {
  homepageQuerySchema,
  type HomepageResponse,
  type ValidatedHomepageQuery,
} from "@socal/contracts";
import { SchemaValidationPipe } from "../../common/schema-validation.pipe";
import { HomepageLayoutNotFoundError } from "../homepage-layout/homepage-layout.service";
import { HomepageService } from "./homepage.service";

@Controller("homepage")
export class HomepageController {
  constructor(private readonly homepage: HomepageService) {}

  @Get()
  @Header("Cache-Control", "no-store")
  async get(
    @Query(new SchemaValidationPipe(homepageQuerySchema)) query: ValidatedHomepageQuery,
  ): Promise<HomepageResponse> {
    try {
      return await this.homepage.get(query);
    } catch (error: unknown) {
      if (error instanceof HomepageLayoutNotFoundError) {
        throw new ServiceUnavailableException("Published homepage layout is unavailable");
      }
      throw error;
    }
  }
}
