import { describe, expect, it } from "vitest";
import {
  createSearchIndexRebuildRequestSchema,
  createSearchIndexRollbackRequestSchema,
  listingSearchIndexSchemaVersion,
} from "../src";

describe("search index operation contracts", () => {
  it("applies the current schema and bounded rollback window defaults", () => {
    expect(listingSearchIndexSchemaVersion).toBe(1);
    expect(
      createSearchIndexRebuildRequestSchema.parse({ reasonCode: "INDEX_DRIFT_RECOVERY" }),
    ).toEqual({ reasonCode: "INDEX_DRIFT_RECOVERY", rollbackWindowHours: 24 });
    expect(
      createSearchIndexRebuildRequestSchema.parse({
        reasonCode: "PLANNED_REINDEX",
        ticketRef: "INC-2026-0050",
        rollbackWindowHours: 168,
      }),
    ).toEqual({
      reasonCode: "PLANNED_REINDEX",
      ticketRef: "INC-2026-0050",
      rollbackWindowHours: 168,
    });
  });

  it("rejects unknown fields, unsafe evidence, and invalid windows", () => {
    for (const request of [
      { reasonCode: "INDEX_DRIFT_RECOVERY", scanCursor: "private" },
      { reasonCode: "operator note" },
      { reasonCode: "INDEX_DRIFT_RECOVERY", ticketRef: "INC-1\nforged" },
      { reasonCode: "INDEX_DRIFT_RECOVERY", rollbackWindowHours: 0 },
      { reasonCode: "INDEX_DRIFT_RECOVERY", rollbackWindowHours: 169 },
      { reasonCode: "INDEX_DRIFT_RECOVERY", rollbackWindowHours: 1.5 },
    ]) {
      expect(createSearchIndexRebuildRequestSchema.safeParse(request).success).toBe(false);
    }
  });

  it("keeps rollback input minimal and strict", () => {
    expect(
      createSearchIndexRollbackRequestSchema.parse({
        reasonCode: "ROLLBACK_DRILL",
        ticketRef: "DRILL-0050",
      }),
    ).toEqual({ reasonCode: "ROLLBACK_DRILL", ticketRef: "DRILL-0050" });
    expect(
      createSearchIndexRollbackRequestSchema.safeParse({
        reasonCode: "ROLLBACK_DRILL",
        targetIndex: "private-index-name",
      }).success,
    ).toBe(false);
  });
});
