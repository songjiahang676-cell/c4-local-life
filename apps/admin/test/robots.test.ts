import { describe, expect, it } from "vitest";
import adminRobots from "../src/app/robots";

describe("Admin crawler policy", () => {
  it("disallows the entire authenticated operator surface", () => {
    expect(adminRobots()).toEqual({
      rules: {
        userAgent: "*",
        disallow: "/",
      },
    });
  });
});
