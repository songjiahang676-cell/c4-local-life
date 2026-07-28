import { Controller, Get, Header, Req, UnauthorizedException } from "@nestjs/common";
import type { AdminSessionResponse } from "@socal/contracts";
import type { FastifyRequest } from "fastify";
import { adminPolicyActions } from "../../common/authorization/policy";
import { RequestContextAccessor } from "../../common/authorization/request-context";
import { RequirePolicy } from "../../common/authorization/require-policy.decorator";
import { AdminSessionService } from "./admin-session.service";

@Controller("admin/session")
export class AdminSessionController {
  constructor(
    private readonly adminSession: AdminSessionService,
    private readonly requestContexts: RequestContextAccessor,
  ) {}

  @Get()
  @RequirePolicy(adminPolicyActions.consoleAccess)
  @Header("Cache-Control", "no-store")
  @Header("Pragma", "no-cache")
  @Header("Vary", "Cookie")
  async getSession(@Req() request: FastifyRequest): Promise<AdminSessionResponse> {
    const identity = this.requestContexts.identity(request);
    if (!identity) throw new UnauthorizedException("Authentication required");
    return this.adminSession.getSession(this.requestContexts.require(request), identity.response);
  }
}
