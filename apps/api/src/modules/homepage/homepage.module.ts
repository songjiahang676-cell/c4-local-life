import { type DynamicModule, Module, type Provider } from "@nestjs/common";
import type { ApiEnvironment } from "@socal/config";
import type { MetricsRegistry } from "@socal/observability";
import { API_ENVIRONMENT } from "../../common/api-environment.token";
import { API_METRICS } from "../../common/api-metrics.token";
import { HomepageLayoutModule } from "../homepage-layout/homepage-layout.module";
import type { HomepageLayoutStore } from "../homepage-layout/homepage-layout.store";
import { DatabaseHomepageDataSource } from "./database-homepage-data.source";
import { HOMEPAGE_DATA_SOURCE, type HomepageDataSource } from "./homepage-data.source";
import { HomepageController } from "./homepage.controller";
import { HOMEPAGE_CACHE, type HomepageCache } from "./homepage-cache";
import { HomepageService } from "./homepage.service";

@Module({})
export class HomepageModule {
  static register(
    environment: ApiEnvironment,
    layoutStore?: HomepageLayoutStore,
    dataSource?: HomepageDataSource,
    metrics?: MetricsRegistry,
    cache?: HomepageCache,
  ): DynamicModule {
    const dataSourceProviders: Provider[] = dataSource
      ? [{ provide: HOMEPAGE_DATA_SOURCE, useValue: dataSource }]
      : [
          DatabaseHomepageDataSource,
          { provide: HOMEPAGE_DATA_SOURCE, useExisting: DatabaseHomepageDataSource },
        ];
    return {
      module: HomepageModule,
      imports: [HomepageLayoutModule.register(environment, layoutStore)],
      controllers: [HomepageController],
      providers: [
        { provide: API_ENVIRONMENT, useValue: environment },
        ...(metrics ? [{ provide: API_METRICS, useValue: metrics }] : []),
        ...(cache ? [{ provide: HOMEPAGE_CACHE, useValue: cache }] : []),
        ...dataSourceProviders,
        HomepageService,
      ],
    };
  }
}
