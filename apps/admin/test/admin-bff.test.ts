import { describe, expect, it } from "vitest";
import { isAllowedAdminApiPath } from "../src/app/v1/[...path]/route";

describe("Admin API proxy allowlist", () => {
  const id = "11111111-1111-4111-8111-111111111111";

  it("allows only the declared session, MFA, and moderation operations", () => {
    expect(isAllowedAdminApiPath("GET", "admin/session")).toBe(true);
    expect(isAllowedAdminApiPath("POST", "admin/mfa/verify")).toBe(true);
    expect(isAllowedAdminApiPath("GET", "admin/moderation/cases")).toBe(true);
    expect(isAllowedAdminApiPath("GET", `admin/moderation/cases/${id}`)).toBe(true);
    expect(isAllowedAdminApiPath("POST", `admin/moderation/cases/${id}/actions`)).toBe(true);
  });

  it("fails closed for malformed UUIDs, method confusion, and unrelated Admin paths", () => {
    expect(isAllowedAdminApiPath("POST", "admin/moderation/cases")).toBe(false);
    expect(isAllowedAdminApiPath("DELETE", `admin/moderation/cases/${id}`)).toBe(false);
    expect(isAllowedAdminApiPath("GET", "admin/moderation/cases/not-a-uuid")).toBe(false);
    expect(isAllowedAdminApiPath("GET", `admin/moderation/cases/${id}/actions`)).toBe(false);
    expect(isAllowedAdminApiPath("GET", "admin/users")).toBe(false);
    expect(isAllowedAdminApiPath("GET", "admin/../../auth/session")).toBe(false);
  });
});
