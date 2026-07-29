import { describe, expect, it } from "vitest";
import { isAllowedWebApiPath } from "../src/app/v1/[...path]/route";

describe("public Web API proxy allowlist", () => {
  const id = "11111111-1111-4111-8111-111111111111";

  it("allows only the form, draft, session, taxonomy and media lifecycle routes", () => {
    expect(isAllowedWebApiPath("GET", "auth/session")).toBe(true);
    expect(isAllowedWebApiPath("GET", "categories")).toBe(true);
    expect(isAllowedWebApiPath("GET", `categories/${id}/form-schema`)).toBe(true);
    expect(isAllowedWebApiPath("POST", "listings")).toBe(true);
    expect(isAllowedWebApiPath("PATCH", `listings/${id}`)).toBe(true);
    expect(isAllowedWebApiPath("GET", `media/${id}`)).toBe(true);
    expect(isAllowedWebApiPath("POST", `media/${id}/complete`)).toBe(true);
  });

  it("fails closed for over-broad, malformed and method-confused routes", () => {
    expect(isAllowedWebApiPath("GET", "admin/session")).toBe(false);
    expect(isAllowedWebApiPath("DELETE", `listings/${id}`)).toBe(false);
    expect(isAllowedWebApiPath("POST", `listings/${id}`)).toBe(false);
    expect(isAllowedWebApiPath("GET", "media/not-a-uuid")).toBe(false);
    expect(isAllowedWebApiPath("GET", "categories/../../admin/session")).toBe(false);
    expect(isAllowedWebApiPath("PUT", "media/uploads")).toBe(false);
  });
});
