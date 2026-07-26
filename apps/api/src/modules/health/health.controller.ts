import { Controller, Get } from "@nestjs/common";
import type { OpenApiComponents } from "@socal/contracts";

type HealthResponse = OpenApiComponents["schemas"]["HealthResponse"];
type ReadinessResponse = OpenApiComponents["schemas"]["ReadinessResponse"];

@Controller("health")
export class HealthController {
  @Get("live")
  live(): HealthResponse {
    return { status: "ok", service: "api", timestamp: new Date().toISOString() };
  }

  @Get("ready")
  ready(): ReadinessResponse {
    return {
      status: "ok",
      checks: { process: "ok" },
    };
  }
}
