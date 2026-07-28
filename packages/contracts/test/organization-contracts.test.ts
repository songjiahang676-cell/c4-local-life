import { describe, expect, it } from "vitest";
import { createOrganizationSchema, listOrganizationMembersQuerySchema } from "../src/index";

describe("organization contracts", () => {
  it("normalizes the bounded creatable organization projection", () => {
    expect(
      createOrganizationSchema.parse({
        type: "SERVICE_PROVIDER",
        displayName: "  南加维修团队  ",
        legalName: "  Synthetic Repair LLC  ",
        slug: "socal-repair-team",
      }),
    ).toEqual({
      type: "SERVICE_PROVIDER",
      displayName: "南加维修团队",
      legalName: "Synthetic Repair LLC",
      slug: "socal-repair-team",
    });
  });

  it("rejects internal organizations, unknown fields, bidi controls, and unsafe slugs", () => {
    for (const input of [
      { type: "INTERNAL", displayName: "Internal", slug: "internal-team" },
      { type: "MERCHANT", displayName: "Merchant", slug: "merchant-team", status: "VERIFIED" },
      { type: "MERCHANT", displayName: "unsafe\u202Ename", slug: "merchant-team" },
      { type: "MERCHANT", displayName: "Merchant", slug: "Upper_Case" },
    ]) {
      expect(createOrganizationSchema.safeParse(input).success).toBe(false);
    }
  });

  it("coerces bounded member pagination and rejects offset pagination", () => {
    expect(listOrganizationMembersQuerySchema.parse({ limit: "25" })).toEqual({ limit: 25 });
    expect(listOrganizationMembersQuerySchema.safeParse({ limit: "101" }).success).toBe(false);
    expect(listOrganizationMembersQuerySchema.safeParse({ offset: "0" }).success).toBe(false);
  });
});
