import { describe, expect, it } from "vitest";
import { ListingsService } from "../src/modules/listings/listings.service";

describe("ListingsService", () => {
  it("creates a draft and applies type filtering", () => {
    const service = new ListingsService();
    const created = service.create({
      type: "RENTAL",
      categoryId: "11111111-1111-4111-8111-111111111111",
      locale: "zh-Hans",
      title: "Irvine two-bedroom rental",
      body: "A deliberately fictional listing body for a foundation test.",
      regionCode: "US-CA-ORANGE-IRVINE",
      attributes: {},
      mediaIds: [],
      contactMode: "IN_APP",
    });

    expect(created.id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(created.status).toBe("DRAFT");
    expect(service.list("RENTAL")).toEqual([created]);
    expect(service.list("JOB")).toEqual([]);
  });
});
