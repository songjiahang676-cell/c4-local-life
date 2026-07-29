import { describe, expect, it } from "vitest";
import { listNotificationsQuerySchema } from "../src";

describe("notification contracts", () => {
  it("applies bounded list defaults and exact boolean coercion", () => {
    expect(listNotificationsQuerySchema.parse({})).toEqual({
      unreadOnly: false,
      limit: 20,
    });
    expect(
      listNotificationsQuerySchema.parse({
        unreadOnly: "true",
        cursor: "opaque.signed",
        limit: "50",
      }),
    ).toEqual({
      unreadOnly: true,
      cursor: "opaque.signed",
      limit: 50,
    });
  });

  it.each([
    { unreadOnly: "yes" },
    { unreadOnly: "1" },
    { limit: 0 },
    { limit: 51 },
    { cursor: "a".repeat(513) },
    { admin: true },
  ])("rejects ambiguous or over-posted notification queries", (query) => {
    expect(listNotificationsQuerySchema.safeParse(query).success).toBe(false);
  });
});
