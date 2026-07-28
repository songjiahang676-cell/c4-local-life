import { SetMetadata, type CustomDecorator } from "@nestjs/common";
import { assertPolicyAction, type PolicyAction } from "./policy";

export const POLICY_ACTION_METADATA = "socal.policy.action";

export function RequirePolicy(action: PolicyAction): CustomDecorator<string> {
  assertPolicyAction(action);
  return SetMetadata(POLICY_ACTION_METADATA, action);
}
