import { describe, expect, it } from "vitest";
import { listMySessionsQuerySchema, updateMyProfileSchema } from "../src/index";

describe("account-management contracts", () => {
  it("normalizes the whitelisted profile fields", () => {
    expect(
      updateMyProfileSchema.parse({
        displayName: "  南加用户  ",
        bio: "  Community member  ",
        preferredLocale: "en-US",
        homeRegionId: null,
      }),
    ).toEqual({
      displayName: "南加用户",
      bio: "Community member",
      preferredLocale: "en-US",
      homeRegionId: null,
    });
  });

  it("rejects empty, unknown, contact, and directional-control fields", () => {
    for (const input of [
      {},
      { email: "private@example.invalid" },
      { displayName: "unsafe\u202Ename" },
      { bio: "unsafe\u0000bio" },
    ]) {
      expect(updateMyProfileSchema.safeParse(input).success).toBe(false);
    }
  });

  it("coerces bounded session pagination while rejecting unknown queries", () => {
    expect(listMySessionsQuerySchema.parse({ limit: "25" })).toEqual({ limit: 25 });
    expect(listMySessionsQuerySchema.safeParse({ limit: "101" }).success).toBe(false);
    expect(listMySessionsQuerySchema.safeParse({ offset: "0" }).success).toBe(false);
  });
});
