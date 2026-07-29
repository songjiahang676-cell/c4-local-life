import { type DynamicModule, Module, type Provider } from "@nestjs/common";
import type { ApiEnvironment } from "@socal/config";
import { API_ENVIRONMENT } from "../../common/api-environment.token";
import { DatabaseOrganizationStore } from "./database-organization.store";
import { ORGANIZATION_STORE, type OrganizationStore } from "./organization.store";
import {
  OrganizationInvitationsController,
  OrganizationsController,
} from "./organizations.controller";
import { OrganizationsService } from "./organizations.service";

@Module({})
export class OrganizationsModule {
  static register(environment: ApiEnvironment, store?: OrganizationStore): DynamicModule {
    const storeProviders: Provider[] = store
      ? [{ provide: ORGANIZATION_STORE, useValue: store }]
      : [
          DatabaseOrganizationStore,
          { provide: ORGANIZATION_STORE, useExisting: DatabaseOrganizationStore },
        ];
    return {
      module: OrganizationsModule,
      controllers: [OrganizationsController, OrganizationInvitationsController],
      providers: [
        { provide: API_ENVIRONMENT, useValue: environment },
        ...storeProviders,
        OrganizationsService,
      ],
      exports: [OrganizationsService],
    };
  }
}
