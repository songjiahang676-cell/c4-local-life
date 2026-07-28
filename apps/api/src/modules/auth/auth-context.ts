import { Injectable } from "@nestjs/common";
import type { Session } from "@socal/contracts";
import type { FastifyRequest } from "fastify";
import type { SessionAuthentication } from "./auth-session.service";

export type AuthContext = {
  sessionId: string;
  response: Session;
  authentication: SessionAuthentication;
};

@Injectable()
export class AuthContextAccessor {
  readonly #contexts = new WeakMap<FastifyRequest, AuthContext>();

  set(request: FastifyRequest, context: AuthContext): void {
    this.#contexts.set(request, context);
  }

  clear(request: FastifyRequest): void {
    this.#contexts.delete(request);
  }

  get(request: FastifyRequest): AuthContext | null {
    return this.#contexts.get(request) ?? null;
  }
}
