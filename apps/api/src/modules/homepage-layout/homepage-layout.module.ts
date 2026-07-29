import { type DynamicModule, Module, type Provider } from "@nestjs/common";
import type { ApiEnvironment } from "@socal/config";
import { API_ENVIRONMENT } from "../../common/api-environment.token";
import { DatabaseHomepageLayoutStore } from "./database-homepage-layout.store";
import { HOMEPAGE_LAYOUT_STORE, type HomepageLayoutStore } from "./homepage-layout.store";
import { HomepageLayoutService } from "./homepage-layout.service";

@Module({})
export class HomepageLayoutModule {
  static register(environment: ApiEnvironment, store?: HomepageLayoutStore): DynamicModule {
    const storeProviders: Provider[] = store
      ? [{ provide: HOMEPAGE_LAYOUT_STORE, useValue: store }]
      : [
          DatabaseHomepageLayoutStore,
          {
            provide: HOMEPAGE_LAYOUT_STORE,
            useExisting: DatabaseHomepageLayoutStore,
          },
        ];
    return {
      module: HomepageLayoutModule,
      providers: [
        { provide: API_ENVIRONMENT, useValue: environment },
        ...storeProviders,
        HomepageLayoutService,
      ],
      exports: [HomepageLayoutService],
    };
  }
}
