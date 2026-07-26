import { CanActivate, ExecutionContext, Inject, Injectable } from "@nestjs/common";
import type { ApiEnvironment } from "@socal/config";
import type { FastifyRequest } from "fastify";
import { API_ENVIRONMENT } from "../../common/api-environment.token";
import { AuthContextAccessor } from "./auth-context";
import { AuthSessionService } from "./auth-session.service";
import { readSessionCookie } from "./session-cookie";

@Injectable()
export class AuthContextGuard implements CanActivate {
  constructor(
    @Inject(API_ENVIRONMENT) private readonly environment: ApiEnvironment,
    private readonly sessions: AuthSessionService,
    private readonly contexts: AuthContextAccessor,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    this.contexts.clear(request);
    const token = readSessionCookie(request.headers.cookie, this.environment.SESSION_COOKIE_NAME);
    if (!token) return true;

    const authContext = await this.sessions.resolveToken(token);
    if (authContext) this.contexts.set(request, authContext);
    return true;
  }
}
