import { Global, Module } from "@nestjs/common";
import {
  accountSelfServicePermissions,
  activeUserPolicyActions,
  PolicyService,
  requireActiveActorPermissionPolicy,
  requireActorPermissionPolicy,
} from "./policy";
import { RequestContextAccessor } from "./request-context";

function createPolicyService(): PolicyService {
  const policies = new PolicyService();
  for (const action of accountSelfServicePermissions) {
    policies.register(action, requireActorPermissionPolicy);
  }
  policies.register(activeUserPolicyActions.listingDraftCreate, requireActiveActorPermissionPolicy);
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
