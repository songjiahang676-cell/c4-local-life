import { Global, Module } from "@nestjs/common";
import {
  accountSelfServicePermissions,
  activeUserPolicyActions,
  adminPolicyActions,
  listingObjectPolicyActions,
  organizationPolicyActions,
  organizationOwnerTransferPolicy,
  ownerOrOrganizationPolicy,
  PolicyService,
  requireActiveActorPermissionPolicy,
  requireActorPermissionPolicy,
  requireMfaActorPermissionPolicy,
  requireModeratorMfaPolicy,
  requireModeratorRecentMfaPolicy,
  requireQueueOperationsActPolicy,
  requireQueueOperationsReadPolicy,
  requireRecentMfaActorPermissionPolicy,
} from "./policy";
import { RequestContextAccessor } from "./request-context";

export function createPolicyService(): PolicyService {
  const policies = new PolicyService();
  for (const action of accountSelfServicePermissions) {
    policies.register(action, requireActorPermissionPolicy);
  }
  policies.register(activeUserPolicyActions.listingDraftCreate, requireActiveActorPermissionPolicy);
  policies.register(activeUserPolicyActions.listingDraftUpdate, requireActiveActorPermissionPolicy);
  policies.register(activeUserPolicyActions.listingArchive, requireActiveActorPermissionPolicy);
  policies.register(activeUserPolicyActions.listingBatchManage, requireActiveActorPermissionPolicy);
  policies.register(activeUserPolicyActions.listingDelete, requireActiveActorPermissionPolicy);
  policies.register(activeUserPolicyActions.listingSubmit, requireActiveActorPermissionPolicy);
  policies.register(
    listingObjectPolicyActions.draftRead,
    ownerOrOrganizationPolicy({
      allowOwner: true,
      allowLimitedAccount: true,
      organizationRoles: ["OWNER", "ADMIN", "EDITOR", "BILLING", "ANALYST"],
    }),
  );
  policies.register(
    listingObjectPolicyActions.draftWrite,
    ownerOrOrganizationPolicy({
      allowOwner: true,
      organizationRoles: ["OWNER", "ADMIN", "EDITOR"],
    }),
  );
  policies.register(
    listingObjectPolicyActions.lifecycleWrite,
    ownerOrOrganizationPolicy({
      allowOwner: true,
      organizationRoles: ["OWNER", "ADMIN", "EDITOR"],
    }),
  );
  policies.register(
    listingObjectPolicyActions.submit,
    ownerOrOrganizationPolicy({
      allowOwner: true,
      organizationRoles: ["OWNER", "ADMIN", "EDITOR"],
    }),
  );
  policies.register(
    activeUserPolicyActions.mediaUploadComplete,
    requireActiveActorPermissionPolicy,
  );
  policies.register(activeUserPolicyActions.mediaUploadCreate, requireActiveActorPermissionPolicy);
  policies.register(
    activeUserPolicyActions.moderationAppealCreate,
    requireActiveActorPermissionPolicy,
  );
  policies.register(activeUserPolicyActions.mfaManage, requireActiveActorPermissionPolicy);
  policies.register(activeUserPolicyActions.organizationCreate, requireActiveActorPermissionPolicy);
  policies.register(
    activeUserPolicyActions.organizationInvitationAccept,
    requireActiveActorPermissionPolicy,
  );
  policies.register(activeUserPolicyActions.reportCreate, requireActiveActorPermissionPolicy);
  policies.register(adminPolicyActions.consoleAccess, requireActiveActorPermissionPolicy);
  policies.register(adminPolicyActions.privilegedAccess, requireMfaActorPermissionPolicy);
  policies.register(adminPolicyActions.sensitiveAccess, requireRecentMfaActorPermissionPolicy);
  policies.register(adminPolicyActions.moderationRead, requireModeratorMfaPolicy);
  policies.register(adminPolicyActions.moderationAct, requireModeratorRecentMfaPolicy);
  policies.register(adminPolicyActions.queueOperationsRead, requireQueueOperationsReadPolicy);
  policies.register(adminPolicyActions.queueOperationsAct, requireQueueOperationsActPolicy);
  policies.register(adminPolicyActions.searchOperationsRead, requireQueueOperationsReadPolicy);
  policies.register(adminPolicyActions.searchOperationsAct, requireQueueOperationsActPolicy);
  policies.register(
    organizationPolicyActions.profileRead,
    ownerOrOrganizationPolicy({
      organizationRoles: ["OWNER", "ADMIN", "EDITOR", "BILLING", "ANALYST"],
    }),
  );
  policies.register(
    organizationPolicyActions.profileEditContent,
    ownerOrOrganizationPolicy({
      organizationRoles: ["OWNER", "ADMIN", "EDITOR"],
    }),
  );
  policies.register(
    organizationPolicyActions.profileManage,
    ownerOrOrganizationPolicy({
      organizationRoles: ["OWNER", "ADMIN"],
    }),
  );
  policies.register(
    organizationPolicyActions.listingsWrite,
    ownerOrOrganizationPolicy({
      organizationRoles: ["OWNER", "ADMIN", "EDITOR"],
    }),
  );
  policies.register(
    organizationPolicyActions.membersRead,
    ownerOrOrganizationPolicy({
      organizationRoles: ["OWNER", "ADMIN"],
    }),
  );
  policies.register(
    organizationPolicyActions.membersManage,
    ownerOrOrganizationPolicy({
      organizationRoles: ["OWNER", "ADMIN"],
    }),
  );
  policies.register(organizationPolicyActions.ownerTransfer, organizationOwnerTransferPolicy);
  policies.register(
    organizationPolicyActions.billingManage,
    ownerOrOrganizationPolicy({
      organizationRoles: ["OWNER", "BILLING"],
    }),
  );
  policies.register(
    organizationPolicyActions.analyticsRead,
    ownerOrOrganizationPolicy({
      organizationRoles: ["OWNER", "ADMIN", "BILLING", "ANALYST"],
    }),
  );
  return policies;
}

@Global()
@Module({
  providers: [
    RequestContextAccessor,
    {
      provide: PolicyService,
      useFactory: createPolicyService,
    },
  ],
  exports: [PolicyService, RequestContextAccessor],
})
export class AuthorizationModule {}
