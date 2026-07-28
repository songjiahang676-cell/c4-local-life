import { Inject, Injectable, type OnModuleDestroy } from "@nestjs/common";
import type { ApiEnvironment } from "@socal/config";
import {
  TaxonomyRepository,
  type CategoryTaxonomyRecord,
  type ListCategoryTaxonomyInput,
  type ListRegionTaxonomyInput,
  type RegionTaxonomyRecord,
} from "@socal/database/taxonomy";
import { API_ENVIRONMENT } from "../../common/api-environment.token";
import type { TaxonomyStore } from "./taxonomy.store";

@Injectable()
export class DatabaseTaxonomyStore implements TaxonomyStore, OnModuleDestroy {
  readonly #repository: TaxonomyRepository;

  constructor(@Inject(API_ENVIRONMENT) environment: ApiEnvironment) {
    this.#repository = new TaxonomyRepository({
      connectionString: environment.DATABASE_URL,
      poolMaximum: environment.DATABASE_POOL_MAX,
    });
  }

  listRegions(input: ListRegionTaxonomyInput): Promise<RegionTaxonomyRecord[]> {
    return this.#repository.listRegions(input);
  }

  listCategories(input: ListCategoryTaxonomyInput): Promise<CategoryTaxonomyRecord[]> {
    return this.#repository.listCategories(input);
  }

  onModuleDestroy(): Promise<void> {
    return this.#repository.close();
  }
}
