import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Header,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from "@nestjs/common";
import type { ApiEnvironment } from "@socal/config";
import {
  adminMfaEnrollmentVerifyRequestSchema,
  adminMfaVerifyRequestSchema,
  type AdminMfaActivationResponse,
  type AdminMfaEnrollmentResponse,
  type AdminMfaEnrollmentVerifyRequest,
  type AdminMfaVerificationResponse,
  type AdminMfaVerifyRequest,
} from "@socal/contracts";
import type { FastifyReply, FastifyRequest } from "fastify";
import { API_ENVIRONMENT } from "../../common/api-environment.token";
import { adminPolicyActions } from "../../common/authorization/policy";
import {
  RequestContextAccessor,
  type SessionIdentityContext,
} from "../../common/authorization/request-context";
import { RequirePolicy } from "../../common/authorization/require-policy.decorator";
import { SchemaValidationPipe } from "../../common/schema-validation.pipe";
import { readSessionCookie } from "../auth/session-cookie";
import {
  InvalidMfaCodeError,
  MfaEnrollmentConflictError,
  MfaNotEnrolledError,
  MfaRateLimitError,
  MfaService,
  MfaSessionUnavailableError,
  type MfaVerificationContext,
} from "./mfa.service";

@Controller("admin/mfa")
export class MfaController {
  constructor(
    @Inject(API_ENVIRONMENT) private readonly environment: ApiEnvironment,
    private readonly contexts: RequestContextAccessor,
    private readonly mfa: MfaService,
  ) {}

  @Post("enrollment")
  @HttpCode(201)
  @RequirePolicy(adminPolicyActions.consoleAccess)
  @Header("Cache-Control", "no-store")
  async beginEnrollment(@Req() request: FastifyRequest): Promise<AdminMfaEnrollmentResponse> {
    try {
      return await this.mfa.beginEnrollment(this.#identity(request).response.user.id);
    } catch (error) {
      this.#translateError(error);
    }
  }

  @Post("enrollment/verify")
  @HttpCode(200)
  @RequirePolicy(adminPolicyActions.consoleAccess)
  @Header("Cache-Control", "no-store")
  async activateEnrollment(
    @Body(new SchemaValidationPipe(adminMfaEnrollmentVerifyRequestSchema))
    input: AdminMfaEnrollmentVerifyRequest,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<AdminMfaActivationResponse> {
    try {
      const result = await this.mfa.activateEnrollment(
        this.#verificationContext(request),
        input.credentialId,
        input.code,
      );
      if (result.issuedSession) {
        void reply.header("set-cookie", result.issuedSession.cookie);
      }
      return result.response;
    } catch (error) {
      this.#translateError(error, reply);
    }
  }

  @Post("verify")
  @HttpCode(200)
  @RequirePolicy(adminPolicyActions.consoleAccess)
  @Header("Cache-Control", "no-store")
  async verify(
    @Body(new SchemaValidationPipe(adminMfaVerifyRequestSchema)) input: AdminMfaVerifyRequest,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<AdminMfaVerificationResponse> {
    try {
      const result = await this.mfa.verify(this.#verificationContext(request), input.code);
      void reply.header("set-cookie", result.issuedSession.cookie);
      return result.response;
    } catch (error) {
      this.#translateError(error, reply);
    }
  }

  #identity(request: FastifyRequest): SessionIdentityContext {
    const identity = this.contexts.identity(request);
    if (!identity) throw new UnauthorizedException("Authentication required");
    return identity;
  }

  #verificationContext(request: FastifyRequest): MfaVerificationContext {
    const identity = this.#identity(request);
    const currentToken = readSessionCookie(
      request.headers.cookie,
      this.environment.SESSION_COOKIE_NAME,
    );
    if (!currentToken) throw new UnauthorizedException("Authentication required");
    return {
      userId: identity.response.user.id,
      currentToken,
      requestId: request.id,
      metadata: {
        userAgent: request.headers["user-agent"],
        ipAddress: request.ip,
      },
    };
  }

  #translateError(error: unknown, reply?: FastifyReply): never {
    if (error instanceof MfaEnrollmentConflictError) {
      throw new ConflictException("An active MFA credential already exists");
    }
    if (error instanceof MfaNotEnrolledError) {
      throw new ForbiddenException("MFA enrollment is required");
    }
    if (error instanceof InvalidMfaCodeError) {
      throw new BadRequestException("The MFA verification is invalid or expired");
    }
    if (error instanceof MfaRateLimitError) {
      void reply?.header("retry-after", error.retryAfterSeconds);
      throw new HttpException(
        "MFA verification is temporarily locked",
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    if (error instanceof MfaSessionUnavailableError) {
      throw new UnauthorizedException("Authentication required");
    }
    throw error;
  }
}
