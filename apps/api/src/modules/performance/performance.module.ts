import { type DynamicModule, Module } from "@nestjs/common";
import type { MetricsRegistry } from "@socal/observability";
import { API_METRICS } from "../../common/api-metrics.token";
import { PerformanceController } from "./performance.controller";
import { PerformanceService } from "./performance.service";

@Module({})
export class PerformanceModule {
  static register(metrics: MetricsRegistry): DynamicModule {
    return {
      module: PerformanceModule,
      controllers: [PerformanceController],
      providers: [{ provide: API_METRICS, useValue: metrics }, PerformanceService],
    };
  }
}
