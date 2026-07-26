export type WorkerHealthResponse = {
  statusCode: 200 | 503;
  body: Record<string, unknown>;
};

export function workerLiveness(now: Date = new Date()): WorkerHealthResponse {
  return {
    statusCode: 200,
    body: {
      status: "ok",
      service: "worker",
      timestamp: now.toISOString(),
    },
  };
}

export function workerReadiness(redisReady: boolean): WorkerHealthResponse {
  return {
    statusCode: redisReady ? 200 : 503,
    body: {
      status: redisReady ? "ok" : "unavailable",
      service: "worker",
      checks: { process: "ok", redis: redisReady ? "ok" : "unavailable" },
    },
  };
}
