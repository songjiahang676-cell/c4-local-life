import { expect } from "vitest";
import type {
  PolicyDecision,
  PolicyEvaluationInput,
  PolicyService,
} from "../../src/common/authorization/policy";

export type PolicyMatrixCase = {
  name: string;
  context: PolicyEvaluationInput["context"];
  resource?: PolicyEvaluationInput["resource"];
  expected: PolicyDecision;
};

export async function expectPolicyMatrix(
  policies: PolicyService,
  action: string,
  cases: readonly PolicyMatrixCase[],
): Promise<void> {
  for (const candidate of cases) {
    const decision = await policies.evaluate({
      action,
      context: candidate.context,
      ...(candidate.resource ? { resource: candidate.resource } : {}),
    });
    expect(decision, candidate.name).toEqual(candidate.expected);
  }
}
