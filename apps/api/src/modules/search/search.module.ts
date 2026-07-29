import { type DynamicModule, Module, type Provider } from "@nestjs/common";
import type { ApiEnvironment } from "@socal/config";
import type { MetricsRegistry } from "@socal/observability";
import { API_ENVIRONMENT } from "../../common/api-environment.token";
import { API_METRICS } from "../../common/api-metrics.token";
import { OpenSearchSearchStore } from "./opensearch-search.store";
import { SearchController } from "./search.controller";
import { SearchService } from "./search.service";
import { SEARCH_STORE, type SearchStore } from "./search.store";

@Module({})
export class SearchModule {
  static register(
    environment: ApiEnvironment,
    store?: SearchStore,
    metrics?: MetricsRegistry,
  ): DynamicModule {
    const storeProvider: Provider = store
      ? { provide: SEARCH_STORE, useValue: store }
      : {
          provide: SEARCH_STORE,
          useFactory: () => new OpenSearchSearchStore(environment),
        };
    return {
      module: SearchModule,
      controllers: [SearchController],
      providers: [
        { provide: API_ENVIRONMENT, useValue: environment },
        ...(metrics ? [{ provide: API_METRICS, useValue: metrics }] : []),
        storeProvider,
        SearchService,
      ],
    };
  }
}
