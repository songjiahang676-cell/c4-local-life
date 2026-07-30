import {
  Body,
  Controller,
  Header,
  HttpException,
  HttpCode,
  HttpStatus,
  Ip,
  Post,
} from "@nestjs/common";
import {
  webVitalReportSchema,
  type WebVitalAcceptedResponse,
  type WebVitalReport,
} from "@socal/contracts";
import { SchemaValidationPipe } from "../../common/schema-validation.pipe";
import { PerformanceService } from "./performance.service";

@Controller("performance")
export class PerformanceController {
  constructor(private readonly performance: PerformanceService) {}

  @Post("web-vitals")
  @HttpCode(202)
  @Header("Cache-Control", "no-store")
  record(
    @Body(new SchemaValidationPipe(webVitalReportSchema)) report: WebVitalReport,
    @Ip() clientAddress: string,
  ): WebVitalAcceptedResponse {
    if (!this.performance.record(report, clientAddress)) {
      throw new HttpException(
        "Performance telemetry rate limit exceeded",
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return { accepted: true };
  }
}
