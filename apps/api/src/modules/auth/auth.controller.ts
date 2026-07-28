import {
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Inject,
  Req,
  Res,
  UnauthorizedException,
} from "@nestjs/common";
import type { ApiEnvironment } from "@socal/config";
import type { SessionResponse } from "@socal/contracts";
import type { FastifyReply, FastifyRequest } from "fastify";
import { API_ENVIRONMENT } from "../../common/api-environment.token";
import { selfServicePolicyActions } from "../../common/authorization/policy";
import { RequirePolicy } from "../../common/authorization/require-policy.decorator";
import { AuthContextAccessor } from "./auth-context";
import { AuthSessionService } from "./auth-session.service";
import { readSessionCookie, serializeClearedSessionCookie } from "./session-cookie";

@Controller("auth/session")
export class AuthController {
  constructor(
    @Inject(API_ENVIRONMENT) private readonly environment: ApiEnvironment,
    private readonly contexts: AuthContextAccessor,
    private readonly sessions: AuthSessionService,
  ) {}

  @Get()
  @RequirePolicy(selfServicePolicyActions.currentSessionRead)
  @Header("Cache-Control", "no-store")
  @Header("Pragma", "no-cache")
  getSession(@Req() request: FastifyRequest): SessionResponse {
    const context = this.contexts.get(request);
    if (!context) throw new UnauthorizedException("Authentication required");
    return { data: context.response };
  }

  @Delete()
  @HttpCode(204)
  @Header("Cache-Control", "no-store")
  async logout(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    const token = readSessionCookie(request.headers.cookie, this.environment.SESSION_COOKIE_NAME);
    if (token) await this.sessions.logout(token);
    void reply.header(
      "set-cookie",
      serializeClearedSessionCookie(this.environment.SESSION_COOKIE_NAME),
    );
  }
}
