import { describe, expect, it } from "vitest";
import { workerLiveness, workerReadiness } from "../src/health-status";

describe("worker health status", () => {
  it("keeps liveness independent from Redis", () => {
    const response = workerLiveness(new Date("2026-01-02T03:04:05.000Z"));

    expect(response).toEqual({
      statusCode: 200,
      body: {
        status: "ok",
        service: "worker",
        timestamp: "2026-01-02T03:04:05.000Z",
      },
    });
  });

  it("fails readiness while Redis is unavailable", () => {
    expect(workerReadiness(false)).toMatchObject({
      statusCode: 503,
      body: { status: "unavailable", checks: { process: "ok", redis: "unavailable" } },
    });
  });
});
