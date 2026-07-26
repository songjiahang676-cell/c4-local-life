import { AsyncLocalStorage } from "node:async_hooks";

export type ObservabilityContext = {
  requestId?: string;
  traceId?: string;
  spanId?: string;
  jobId?: string;
  jobName?: string;
};

const storage = new AsyncLocalStorage<ObservabilityContext>();

export function currentObservabilityContext(): Readonly<ObservabilityContext> {
  return storage.getStore() ?? {};
}

export function runWithObservabilityContext<T>(value: ObservabilityContext, callback: () => T): T {
  return storage.run(value, callback);
}
