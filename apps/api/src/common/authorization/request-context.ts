import { Injectable } from "@nestjs/common";
import type { Session } from "@socal/contracts";
import type { FastifyRequest } from "fastify";
import type { AuthenticatedActor, PolicyActor, PolicyRequestContext } from "./policy";

export type SessionIdentityContext = {
  sessionId: string;
  response: Session;
};

function actorFromSession(identity: SessionIdentityContext | null): PolicyActor {
  if (!identity) return Object.freeze({ kind: "guest" });
  const actor: AuthenticatedActor = {
    kind: "authenticated",
    userId: identity.response.user.id,
    sessionId: identity.sessionId,
    accountStatus: identity.response.user.status,
    verificationBadges: Object.freeze([...(identity.response.user.verificationBadges ?? [])]),
    permissions: Object.freeze([...identity.response.permissions]),
    platformRoles: Object.freeze([...identity.response.platformRoles]),
    organizations: Object.freeze(
      (identity.response.organizations ?? []).map((organization) =>
        Object.freeze({
          organizationId: organization.id,
          role: organization.role,
        }),
      ),
    ),
  };
  return Object.freeze(actor);
}

@Injectable()
export class RequestContextAccessor {
  readonly #contexts = new WeakMap<FastifyRequest, PolicyRequestContext>();
  readonly #identities = new WeakMap<FastifyRequest, SessionIdentityContext>();

  initialize(request: FastifyRequest, identity: SessionIdentityContext | null): void {
    if (identity) {
      this.#identities.set(request, identity);
    } else {
      this.#identities.delete(request);
    }
    this.#contexts.set(
      request,
      Object.freeze({
        requestId: request.id,
        method: request.method,
        route: request.routeOptions.url || request.url.split("?", 1)[0] || "/",
        actor: actorFromSession(identity),
      }),
    );
  }

  get(request: FastifyRequest): PolicyRequestContext | null {
    return this.#contexts.get(request) ?? null;
  }

  identity(request: FastifyRequest): SessionIdentityContext | null {
    return this.#identities.get(request) ?? null;
  }

  require(request: FastifyRequest): PolicyRequestContext {
    const context = this.get(request);
    if (!context) throw new Error("Request context was not initialized");
    return context;
  }
}
