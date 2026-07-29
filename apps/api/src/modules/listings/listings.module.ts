import { type DynamicModule, Module, type Provider } from "@nestjs/common";
import type { ApiEnvironment } from "@socal/config";
import { API_ENVIRONMENT } from "../../common/api-environment.token";
import { TaxonomyModule } from "../taxonomy/taxonomy.module";
import type { TaxonomyStore } from "../taxonomy/taxonomy.store";
import { AccountListingsController } from "./account-listings.controller";
import { DatabaseListingStore } from "./database-listing.store";
import { LISTING_STORE, type ListingStore } from "./listing.store";
import { ListingsController } from "./listings.controller";
import { ListingsService } from "./listings.service";

@Module({})
export class ListingsModule {
  static register(
    environment: ApiEnvironment,
    store?: ListingStore,
    taxonomyStore?: TaxonomyStore,
  ): DynamicModule {
    const storeProviders: Provider[] = store
      ? [{ provide: LISTING_STORE, useValue: store }]
      : [DatabaseListingStore, { provide: LISTING_STORE, useExisting: DatabaseListingStore }];
    return {
      module: ListingsModule,
      imports: [TaxonomyModule.register(environment, taxonomyStore)],
      controllers: [ListingsController, AccountListingsController],
      providers: [
        { provide: API_ENVIRONMENT, useValue: environment },
        ...storeProviders,
        ListingsService,
      ],
      exports: [ListingsService],
    };
  }
}
