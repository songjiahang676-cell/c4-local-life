import { type DynamicModule, Module, type Provider } from "@nestjs/common";
import type { ApiEnvironment } from "@socal/config";
import { API_ENVIRONMENT } from "../../common/api-environment.token";
import { DatabaseTaxonomyStore } from "./database-taxonomy.store";
import { TAXONOMY_STORE, type TaxonomyStore } from "./taxonomy.store";
import { TaxonomyController } from "./taxonomy.controller";
import { TaxonomyService } from "./taxonomy.service";

@Module({})
export class TaxonomyModule {
  static register(environment: ApiEnvironment, store?: TaxonomyStore): DynamicModule {
    const storeProviders: Provider[] = store
      ? [{ provide: TAXONOMY_STORE, useValue: store }]
      : [DatabaseTaxonomyStore, { provide: TAXONOMY_STORE, useExisting: DatabaseTaxonomyStore }];
    return {
      module: TaxonomyModule,
      controllers: [TaxonomyController],
      providers: [
        { provide: API_ENVIRONMENT, useValue: environment },
        ...storeProviders,
        TaxonomyService,
      ],
      exports: [TaxonomyService],
    };
  }
}
