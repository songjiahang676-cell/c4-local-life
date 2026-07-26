import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
} from "@nestjs/common";
import type { ApiEnvironment } from "@socal/config";
import type { FastifyRequest } from "fastify";
import { API_ENVIRONMENT } from "./api-environment.token";

const safeMethods = new Set(["GET", "HEAD", "OPTIONS"]);

function hasCookie(cookieHeader: string | undefined, cookieName: string): boolean {
  if (!cookieHeader) return false;
  return cookieHeader.split(";").some((part) => part.trim().startsWith(`${cookieName}=`));
}

@Injectable()
export class CsrfOriginGuard implements CanActivate {
  readonly #allowedOrigins: ReadonlySet<string>;

  constructor(@Inject(API_ENVIRONMENT) private readonly environment: ApiEnvironment) {
    this.#allowedOrigins = new Set([
      this.environment.PUBLIC_WEB_URL,
      this.environment.PUBLIC_ADMIN_URL,
    ]);
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    if (safeMethods.has(request.method)) return true;
    if (request.url.startsWith("/v1/webhooks/")) return true;

    const cookie = request.headers.cookie;
    if (!hasCookie(cookie, this.environment.SESSION_COOKIE_NAME)) return true;

    const origin = request.headers.origin;
    if (typeof origin !== "string" || !this.#allowedOrigins.has(origin)) {
      throw new ForbiddenException("Cross-site request rejected");
    }
    return true;
  }
}
