import { describe, expect, it } from "vitest";
import {
  createQueueReconciliationRunRequestSchema,
  createQueueReplayBatchRequestSchema,
  listQueueDeadLettersQuerySchema,
} from "../src";

const id = "40000000-0000-4000-8000-000000000101";

describe("queue operations contracts", () => {
  it("applies bounded dead-letter filters and rejects unknown input", () => {
    expect(listQueueDeadLettersQuerySchema.parse({})).toEqual({ limit: 20 });
    expect(
      listQueueDeadLettersQuerySchema.parse({
        source: "QUEUE",
        eventType: "listing.published",
        failureCode: "JOB_HANDLER_FAILED",
        limit: "50",
      }),
    ).toMatchObject({ source: "QUEUE", limit: 50 });
    expect(listQueueDeadLettersQuerySchema.safeParse({ limit: 51 }).success).toBe(false);
    expect(
      listQueueDeadLettersQuerySchema.safeParse({ failureCode: "raw error text" }).success,
    ).toBe(false);
    expect(listQueueDeadLettersQuerySchema.safeParse({ payload: true }).success).toBe(false);
  });

  it("requires explicit unique replay targets and stable incident evidence", () => {
    const request = {
      targets: [{ source: "QUEUE" as const, targetId: id }],
      reasonCode: "INCIDENT_RECOVERY",
      ticketRef: "INC-2026-0042",
    };
    expect(createQueueReplayBatchRequestSchema.parse(request)).toEqual(request);
    expect(
      createQueueReplayBatchRequestSchema.safeParse({
        ...request,
        targets: [...request.targets, ...request.targets],
      }).success,
    ).toBe(false);
    expect(
      createQueueReplayBatchRequestSchema.safeParse({ ...request, reasonCode: "operator note" })
        .success,
    ).toBe(false);
    expect(
      createQueueReplayBatchRequestSchema.safeParse({ ...request, ticketRef: "x\nforged" }).success,
    ).toBe(false);
  });

  it("bounds dry-run and repair reconciliation batches", () => {
    expect(
      createQueueReconciliationRunRequestSchema.parse({
        dryRun: true,
        maxItems: 500,
        reasonCode: "DRIFT_CHECK",
      }),
    ).toMatchObject({ dryRun: true, maxItems: 500 });
    expect(
      createQueueReconciliationRunRequestSchema.safeParse({
        dryRun: false,
        maxItems: 501,
        reasonCode: "DRIFT_REPAIR",
      }).success,
    ).toBe(false);
  });
});
