import { Inject, Injectable, type OnModuleDestroy } from "@nestjs/common";
import type { ApiEnvironment } from "@socal/config";
import {
  OrganizationRepository,
  type CreateOwnedOrganizationInput,
  type CreateOwnedOrganizationResult,
  type ListOrganizationMembersInput,
  type MemberOrganizationProjection,
  type OrganizationMemberPage,
} from "@socal/database/organization";
import { API_ENVIRONMENT } from "../../common/api-environment.token";
import type { OrganizationStore } from "./organization.store";

@Injectable()
export class DatabaseOrganizationStore implements OrganizationStore, OnModuleDestroy {
  readonly #repository: OrganizationRepository;

  constructor(@Inject(API_ENVIRONMENT) environment: ApiEnvironment) {
    this.#repository = new OrganizationRepository({
      connectionString: environment.DATABASE_URL,
      poolMaximum: environment.DATABASE_POOL_MAX,
    });
  }

  createOwned(input: CreateOwnedOrganizationInput): Promise<CreateOwnedOrganizationResult> {
    return this.#repository.createOwned(input);
  }

  findByIdForMember(
    actorUserId: string,
    organizationId: string,
  ): Promise<MemberOrganizationProjection | null> {
    return this.#repository.findByIdForMember(actorUserId, organizationId);
  }

  listMembers(input: ListOrganizationMembersInput): Promise<OrganizationMemberPage> {
    return this.#repository.listMembers(input);
  }

  onModuleDestroy(): Promise<void> {
    return this.#repository.close();
  }
}
