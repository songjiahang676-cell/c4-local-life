import { createHmac, randomBytes } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type { WebVitalReport } from "@socal/contracts";
import type { MetricsRegistry } from "@socal/observability";
import { API_METRICS } from "../../common/api-metrics.token";

type ClientWindow = {
  count: number;
  expiresAt: number;
};

const windowMilliseconds = 60_000;
const reportsPerWindow = 120;
const maximumTrackedClients = 10_000;

@Injectable()
export class PerformanceService {
  readonly #clientWindows = new Map<string, ClientWindow>();
  readonly #addressKey = randomBytes(32);

  constructor(@Inject(API_METRICS) private readonly metrics: MetricsRegistry) {}

  record(report: WebVitalReport, clientAddress: string, now = Date.now()): boolean {
    const key = createHmac("sha256", this.#addressKey)
      .update(clientAddress.slice(0, 160), "utf8")
      .digest("hex");
    const current = this.#clientWindows.get(key);
    if (current && current.expiresAt > now) {
      if (current.count >= reportsPerWindow) return false;
      current.count += 1;
    } else {
      this.#removeExpired(now);
      if (!current && this.#clientWindows.size >= maximumTrackedClients) return false;
      this.#clientWindows.set(key, {
        count: 1,
        expiresAt: now + windowMilliseconds,
      });
    }
    this.metrics.webVital(report);
    return true;
  }

  #removeExpired(now: number): void {
    if (this.#clientWindows.size < maximumTrackedClients) return;
    for (const [key, value] of this.#clientWindows) {
      if (value.expiresAt <= now) this.#clientWindows.delete(key);
    }
  }
}
