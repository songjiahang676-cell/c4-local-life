import type {
  CreateOwnedOrganizationInput,
  CreateOwnedOrganizationResult,
  ListOrganizationMembersInput,
  MemberOrganizationProjection,
  OrganizationMemberPage,
} from "@socal/database/organization";

export const ORGANIZATION_STORE = Symbol("ORGANIZATION_STORE");

export type OrganizationStore = {
  createOwned(input: CreateOwnedOrganizationInput): Promise<CreateOwnedOrganizationResult>;
  findByIdForMember(
    actorUserId: string,
    organizationId: string,
  ): Promise<MemberOrganizationProjection | null>;
  listMembers(input: ListOrganizationMembersInput): Promise<OrganizationMemberPage>;
};

export type {
  CreateOwnedOrganizationInput,
  CreateOwnedOrganizationResult,
  ListOrganizationMembersInput,
  MemberOrganizationProjection,
  OrganizationMemberPage,
};
