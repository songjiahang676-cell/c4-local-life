import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { FastifyRequest } from "fastify";
import { PolicyService, type PolicyAction } from "./policy";
import { POLICY_ACTION_METADATA } from "./require-policy.decorator";
import { RequestContextAccessor } from "./request-context";

@Injectable()
export class AuthorizationGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly contexts: RequestContextAccessor,
    private readonly policies: PolicyService,
  ) {}

  async canActivate(executionContext: ExecutionContext): Promise<boolean> {
    const action = this.reflector.getAllAndOverride<PolicyAction | undefined>(
      POLICY_ACTION_METADATA,
      [executionContext.getHandler(), executionContext.getClass()],
    );
    if (!action) return true;

    const request = executionContext.switchToHttp().getRequest<FastifyRequest>();
    await this.policies.require({
      action,
      context: this.contexts.require(request),
    });
    return true;
  }
}
