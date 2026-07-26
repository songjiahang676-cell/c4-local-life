import {
  BadRequestException,
  Body,
  Controller,
  Header,
  HttpException,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  ServiceUnavailableException,
} from "@nestjs/common";
import {
  otpRequestSchema,
  otpVerifyRequestSchema,
  type OtpAcceptedResponse,
  type OtpRequest,
  type OtpVerifyRequest,
  type SessionResponse,
} from "@socal/contracts";
import type { FastifyReply, FastifyRequest } from "fastify";
import { SchemaValidationPipe } from "../../common/schema-validation.pipe";
import { AuthContextAccessor } from "./auth-context";
import { AuthSessionService, SessionSubjectUnavailableError } from "./auth-session.service";
import { OtpDeliveryUnavailableError } from "./otp-delivery.gateway";
import { InvalidOtpChallengeError, OtpRateLimitError, OtpService } from "./otp.service";

const deviceIdPattern = /^[A-Za-z0-9._:-]{16,128}$/;

function deviceIdFromRequest(request: FastifyRequest): string {
  const value = request.headers["x-device-id"];
  if (typeof value !== "string" || !deviceIdPattern.test(value)) {
    throw new BadRequestException({
      message: "Request validation failed",
      errors: { "x-device-id": ["A valid X-Device-Id header is required"] },
    });
  }
  return value;
}

@Controller("auth/otp")
export class OtpController {
  constructor(
    private readonly otp: OtpService,
    private readonly contexts: AuthContextAccessor,
    private readonly sessions: AuthSessionService,
  ) {}

  @Post("request")
  @HttpCode(202)
  @Header("Cache-Control", "no-store")
  async requestOtp(
    @Body(new SchemaValidationPipe(otpRequestSchema)) input: OtpRequest,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<OtpAcceptedResponse> {
    try {
      return await this.otp.request(
        input,
        {
          actorUserId: this.contexts.get(request)?.response.user.id ?? null,
          ipAddress: request.ip,
          deviceId: deviceIdFromRequest(request),
        },
        request.id,
      );
    } catch (error) {
      this.#translateError(error, reply);
    }
  }

  @Post("verify")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  async verifyOtp(
    @Body(new SchemaValidationPipe(otpVerifyRequestSchema)) input: OtpVerifyRequest,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<SessionResponse> {
    try {
      const userId = await this.otp.verify(
        input.challengeId,
        input.code,
        deviceIdFromRequest(request),
      );
      const issued = await this.sessions.issueSession(userId, {
        userAgent: request.headers["user-agent"],
        ipAddress: request.ip,
      });
      void reply.header("set-cookie", issued.cookie);
      return { data: issued.response };
    } catch (error) {
      this.#translateError(error, reply);
    }
  }

  #translateError(error: unknown, reply: FastifyReply): never {
    if (error instanceof OtpRateLimitError) {
      void reply.header("retry-after", error.retryAfterSeconds);
      throw new HttpException("OTP rate limit exceeded", HttpStatus.TOO_MANY_REQUESTS);
    }
    if (error instanceof InvalidOtpChallengeError) {
      throw new BadRequestException("The challenge is invalid or expired");
    }
    if (error instanceof SessionSubjectUnavailableError) {
      throw new BadRequestException("The challenge is invalid or expired");
    }
    if (error instanceof OtpDeliveryUnavailableError) {
      throw new ServiceUnavailableException("OTP delivery is unavailable");
    }
    throw error;
  }
}
