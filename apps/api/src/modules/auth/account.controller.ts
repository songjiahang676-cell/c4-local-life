import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  Req,
  Res,
  UnauthorizedException,
  UnprocessableEntityException,
} from "@nestjs/common";
import type { ApiEnvironment } from "@socal/config";
import {
  listMySessionsQuerySchema,
  updateMyProfileSchema,
  type ListMySessionsQuery,
  type MyProfileResponse,
  type SessionDeviceCollection,
  type UpdateMyProfileRequest,
} from "@socal/contracts";
import type { FastifyReply, FastifyRequest } from "fastify";
import { API_ENVIRONMENT } from "../../common/api-environment.token";
import { selfServicePolicyActions } from "../../common/authorization/policy";
import { RequirePolicy } from "../../common/authorization/require-policy.decorator";
import { SchemaValidationPipe } from "../../common/schema-validation.pipe";
import {
  AccountProfileConflictError,
  AccountService,
  AccountUnavailableError,
  InvalidHomeRegionError,
  InvalidSessionCursorError,
  profileEtag,
  profileVersionFromEtag,
} from "./account.service";
import { AuthContextAccessor, type AuthContext } from "./auth-context";
import { serializeClearedSessionCookie } from "./session-cookie";

function requireContext(contexts: AuthContextAccessor, request: FastifyRequest): AuthContext {
  const context = contexts.get(request);
  if (!context) throw new UnauthorizedException("Authentication required");
  return context;
}

@Controller("me")
export class AccountController {
  constructor(
    @Inject(API_ENVIRONMENT) private readonly environment: ApiEnvironment,
    private readonly contexts: AuthContextAccessor,
    private readonly accounts: AccountService,
  ) {}

  @Get()
  @RequirePolicy(selfServicePolicyActions.profileRead)
  @Header("Cache-Control", "no-store")
  @Header("Pragma", "no-cache")
  async getProfile(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<MyProfileResponse> {
    try {
      const context = requireContext(this.contexts, request);
      const profile = await this.accounts.getProfile(context.response.user.id);
      void reply.header("etag", profileEtag(profile.version));
      return { data: profile };
    } catch (error) {
      this.#translateError(error);
    }
  }

  @Patch()
  @RequirePolicy(selfServicePolicyActions.profileUpdate)
  @Header("Cache-Control", "no-store")
  @Header("Pragma", "no-cache")
  async updateProfile(
    @Body(new SchemaValidationPipe(updateMyProfileSchema)) input: UpdateMyProfileRequest,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<MyProfileResponse> {
    const context = requireContext(this.contexts, request);
    const version = profileVersionFromEtag(request.headers["if-match"]);
    if (!version) throw new BadRequestException("A valid If-Match profile ETag is required");

    try {
      const profile = await this.accounts.updateProfile(context.response.user.id, version, input);
      void reply.header("etag", profileEtag(profile.version));
      return { data: profile };
    } catch (error) {
      this.#translateError(error);
    }
  }

  @Get("sessions")
  @RequirePolicy(selfServicePolicyActions.sessionsRead)
  @Header("Cache-Control", "no-store")
  @Header("Pragma", "no-cache")
  async listSessions(
    @Query(new SchemaValidationPipe(listMySessionsQuerySchema)) query: ListMySessionsQuery,
    @Req() request: FastifyRequest,
  ): Promise<SessionDeviceCollection> {
    const context = requireContext(this.contexts, request);
    try {
      return await this.accounts.listSessions(context.response.user.id, context.sessionId, query);
    } catch (error) {
      this.#translateError(error);
    }
  }

  @Delete("sessions")
  @RequirePolicy(selfServicePolicyActions.sessionsRevoke)
  @HttpCode(204)
  @Header("Cache-Control", "no-store")
  async logoutAll(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    const context = requireContext(this.contexts, request);
    await this.accounts.revokeAllSessions(context.response.user.id);
    void reply.header(
      "set-cookie",
      serializeClearedSessionCookie(this.environment.SESSION_COOKIE_NAME),
    );
  }

  @Delete("sessions/:sessionId")
  @RequirePolicy(selfServicePolicyActions.sessionsRevoke)
  @HttpCode(204)
  @Header("Cache-Control", "no-store")
  async revokeSession(
    @Param("sessionId", new ParseUUIDPipe({ version: "4" })) sessionId: string,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    const context = requireContext(this.contexts, request);
    await this.accounts.revokeSession(context.response.user.id, sessionId);
    if (sessionId === context.sessionId) {
      void reply.header(
        "set-cookie",
        serializeClearedSessionCookie(this.environment.SESSION_COOKIE_NAME),
      );
    }
  }

  #translateError(error: unknown): never {
    if (error instanceof AccountProfileConflictError) {
      throw new ConflictException("Profile version conflict");
    }
    if (error instanceof InvalidHomeRegionError) {
      throw new UnprocessableEntityException("Home region is unavailable");
    }
    if (error instanceof InvalidSessionCursorError) {
      throw new BadRequestException("Session cursor is invalid");
    }
    if (error instanceof AccountUnavailableError) {
      throw new UnauthorizedException("Authentication required");
    }
    throw error;
  }
}
