import {
  BadRequestException,
  Body,
  Controller,
  Header,
  HttpCode,
  HttpException,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from "@nestjs/common";
import {
  passwordLoginRequestSchema,
  passwordRecoveryConfirmRequestSchema,
  passwordRecoveryRequestSchema,
  type PasswordLoginRequest,
  type PasswordRecoveryAcceptedResponse,
  type PasswordRecoveryConfirmRequest,
  type PasswordRecoveryRequest,
  type PasswordRecoveryResponse,
  type SessionResponse,
} from "@socal/contracts";
import type { FastifyReply, FastifyRequest } from "fastify";
import { SchemaValidationPipe } from "../../common/schema-validation.pipe";
import {
  InvalidPasswordCredentialsError,
  InvalidPasswordRecoveryError,
  PasswordRateLimitError,
  PasswordRecoveryCooldownError,
  PasswordService,
  WeakPasswordError,
} from "./password.service";

const deviceIdPattern = /^[A-Za-z0-9._:-]{16,128}$/;

function requestMetadata(request: FastifyRequest): {
  ipAddress: string;
  deviceId: string;
  userAgent?: string;
} {
  const deviceId = request.headers["x-device-id"];
  if (typeof deviceId !== "string" || !deviceIdPattern.test(deviceId)) {
    throw new BadRequestException({
      message: "Request validation failed",
      errors: { "x-device-id": ["A valid X-Device-Id header is required"] },
    });
  }
  return {
    ipAddress: request.ip,
    deviceId,
    userAgent: request.headers["user-agent"],
  };
}

@Controller("auth/password")
export class PasswordController {
  constructor(private readonly passwords: PasswordService) {}

  @Post("login")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  async login(
    @Body(new SchemaValidationPipe(passwordLoginRequestSchema)) input: PasswordLoginRequest,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<SessionResponse> {
    try {
      const result = await this.passwords.login(input, requestMetadata(request));
      void reply.header("set-cookie", result.cookie);
      return result.response;
    } catch (error) {
      this.#translate(error, reply);
    }
  }

  @Post("recovery")
  @HttpCode(202)
  @Header("Cache-Control", "no-store")
  async requestRecovery(
    @Body(new SchemaValidationPipe(passwordRecoveryRequestSchema))
    input: PasswordRecoveryRequest,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<PasswordRecoveryAcceptedResponse> {
    try {
      return await this.passwords.requestRecovery(input, requestMetadata(request), request.id);
    } catch (error) {
      this.#translate(error, reply);
    }
  }

  @Post("recovery/confirm")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  async confirmRecovery(
    @Body(new SchemaValidationPipe(passwordRecoveryConfirmRequestSchema))
    input: PasswordRecoveryConfirmRequest,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<PasswordRecoveryResponse> {
    try {
      return await this.passwords.confirmRecovery(input, requestMetadata(request), request.id);
    } catch (error) {
      this.#translate(error, reply);
    }
  }

  #translate(error: unknown, reply: FastifyReply): never {
    if (error instanceof InvalidPasswordCredentialsError) {
      throw new UnauthorizedException("The credentials are invalid");
    }
    if (error instanceof InvalidPasswordRecoveryError) {
      throw new BadRequestException("The password recovery request is invalid or expired");
    }
    if (error instanceof WeakPasswordError) {
      throw new BadRequestException({
        message: "Request validation failed",
        errors: {
          newPassword: [
            "Choose a 15–128 character password that is not commonly used or compromised",
          ],
        },
      });
    }
    if (error instanceof PasswordRateLimitError || error instanceof PasswordRecoveryCooldownError) {
      void reply.header("retry-after", error.retryAfterSeconds);
      throw new HttpException(
        "Password authentication is temporarily limited",
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    throw error;
  }
}
