import { Inject, Injectable, type OnModuleDestroy } from "@nestjs/common";
import type { ApiEnvironment } from "@socal/config";
import {
  OrganizationRepository,
  type AcceptOrganizationInvitationInput,
  type AcceptOrganizationInvitationResult,
  type ChangeOrganizationMemberRoleInput,
  type ChangeOrganizationMemberRoleResult,
  type CreateOrganizationInvitationInput,
  type CreateOrganizationInvitationResult,
  type CreateOwnedOrganizationInput,
  type CreateOwnedOrganizationResult,
  type ListOrganizationMembersInput,
  type MemberOrganizationProjection,
  type OrganizationMemberPage,
  type RemoveOrganizationMemberInput,
  type RemoveOrganizationMemberResult,
  type RevokeOrganizationInvitationInput,
  type RevokeOrganizationInvitationResult,
  type TransferOrganizationOwnershipInput,
  type TransferOrganizationOwnershipResult,
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

  createInvitation(
    input: CreateOrganizationInvitationInput,
  ): Promise<CreateOrganizationInvitationResult> {
    return this.#repository.createInvitation(input);
  }

  acceptInvitation(
    input: AcceptOrganizationInvitationInput,
  ): Promise<AcceptOrganizationInvitationResult> {
    return this.#repository.acceptInvitation(input);
  }

  revokeInvitation(
    input: RevokeOrganizationInvitationInput,
  ): Promise<RevokeOrganizationInvitationResult> {
    return this.#repository.revokeInvitation(input);
  }

  changeMemberRole(
    input: ChangeOrganizationMemberRoleInput,
  ): Promise<ChangeOrganizationMemberRoleResult> {
    return this.#repository.changeMemberRole(input);
  }

  removeMember(input: RemoveOrganizationMemberInput): Promise<RemoveOrganizationMemberResult> {
    return this.#repository.removeMember(input);
  }

  transferOwnership(
    input: TransferOrganizationOwnershipInput,
  ): Promise<TransferOrganizationOwnershipResult> {
    return this.#repository.transferOwnership(input);
  }

  onModuleDestroy(): Promise<void> {
    return this.#repository.close();
  }
}
