import { describe, expect, it } from "vitest";
import { ContentStatus } from "../generated/prisma/enums";

describe("generated Prisma client", () => {
  it("contains the canonical content lifecycle enum", () => {
    expect(ContentStatus).toMatchObject({
      DRAFT: "DRAFT",
      SUBMITTED: "SUBMITTED",
      PUBLISHED: "PUBLISHED",
      ARCHIVED: "ARCHIVED",
    });
  });
});
