import type {
  AcceptOrganizationInvitationInput,
  AcceptOrganizationInvitationResult,
  ChangeOrganizationMemberRoleInput,
  ChangeOrganizationMemberRoleResult,
  CreateOrganizationInvitationInput,
  CreateOrganizationInvitationResult,
  CreateOwnedOrganizationInput,
  CreateOwnedOrganizationResult,
  ListOrganizationMembersInput,
  MemberOrganizationProjection,
  OrganizationInvitationProjection,
  OrganizationMemberPage,
  RemoveOrganizationMemberInput,
  RemoveOrganizationMemberResult,
  RevokeOrganizationInvitationInput,
  RevokeOrganizationInvitationResult,
  TransferOrganizationOwnershipInput,
  TransferOrganizationOwnershipResult,
} from "@socal/database/organization";

export const ORGANIZATION_STORE = Symbol("ORGANIZATION_STORE");

export type OrganizationStore = {
  createOwned(input: CreateOwnedOrganizationInput): Promise<CreateOwnedOrganizationResult>;
  findByIdForMember(
    actorUserId: string,
    organizationId: string,
  ): Promise<MemberOrganizationProjection | null>;
  listMembers(input: ListOrganizationMembersInput): Promise<OrganizationMemberPage>;
  createInvitation(
    input: CreateOrganizationInvitationInput,
  ): Promise<CreateOrganizationInvitationResult>;
  acceptInvitation(
    input: AcceptOrganizationInvitationInput,
  ): Promise<AcceptOrganizationInvitationResult>;
  revokeInvitation(
    input: RevokeOrganizationInvitationInput,
  ): Promise<RevokeOrganizationInvitationResult>;
  changeMemberRole(
    input: ChangeOrganizationMemberRoleInput,
  ): Promise<ChangeOrganizationMemberRoleResult>;
  removeMember(input: RemoveOrganizationMemberInput): Promise<RemoveOrganizationMemberResult>;
  transferOwnership(
    input: TransferOrganizationOwnershipInput,
  ): Promise<TransferOrganizationOwnershipResult>;
};

export type {
  AcceptOrganizationInvitationInput,
  AcceptOrganizationInvitationResult,
  ChangeOrganizationMemberRoleInput,
  ChangeOrganizationMemberRoleResult,
  CreateOrganizationInvitationInput,
  CreateOrganizationInvitationResult,
  CreateOwnedOrganizationInput,
  CreateOwnedOrganizationResult,
  ListOrganizationMembersInput,
  MemberOrganizationProjection,
  OrganizationInvitationProjection,
  OrganizationMemberPage,
  RemoveOrganizationMemberInput,
  RemoveOrganizationMemberResult,
  RevokeOrganizationInvitationInput,
  RevokeOrganizationInvitationResult,
  TransferOrganizationOwnershipInput,
  TransferOrganizationOwnershipResult,
};
