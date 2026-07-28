import { Inject, Injectable, type OnModuleDestroy } from "@nestjs/common";
import type { ApiEnvironment } from "@socal/config";
import {
  MfaCredentialRepository,
  type MfaCredentialSecret,
  type MfaCredentialState,
  type MfaEnrollmentStartInput,
  type MfaEnrollmentStartResult,
} from "@socal/database/mfa-credential";
import { API_ENVIRONMENT } from "../../common/api-environment.token";
import type { MfaStore } from "./mfa.store";

@Injectable()
export class DatabaseMfaStore implements MfaStore, OnModuleDestroy {
  readonly #repository: MfaCredentialRepository;

  constructor(@Inject(API_ENVIRONMENT) environment: ApiEnvironment) {
    this.#repository = new MfaCredentialRepository({
      connectionString: environment.DATABASE_URL,
      poolMaximum: environment.DATABASE_POOL_MAX,
    });
  }

  findState(userId: string, now: Date): Promise<MfaCredentialState> {
    return this.#repository.findState(userId, now);
  }

  startEnrollment(input: MfaEnrollmentStartInput): Promise<MfaEnrollmentStartResult> {
    return this.#repository.startEnrollment(input);
  }

  findPending(
    userId: string,
    credentialId: string,
    now: Date,
  ): Promise<MfaCredentialSecret | null> {
    return this.#repository.findPending(userId, credentialId, now);
  }

  findActive(userId: string): Promise<MfaCredentialSecret | null> {
    return this.#repository.findActive(userId);
  }

  activate(
    userId: string,
    credentialId: string,
    lastUsedStep: bigint,
    recoveryCodeHashes: readonly string[],
    now: Date,
    requestId: string,
  ): Promise<boolean> {
    return this.#repository.activate(
      userId,
      credentialId,
      lastUsedStep,
      recoveryCodeHashes,
      now,
      requestId,
    );
  }

  consumeTotp(
    userId: string,
    credentialId: string,
    step: bigint,
    now: Date,
    requestId: string,
  ): Promise<boolean> {
    return this.#repository.consumeTotp(userId, credentialId, step, now, requestId);
  }

  consumeRecoveryCode(
    userId: string,
    credentialId: string,
    codeHash: string,
    now: Date,
    requestId: string,
  ): Promise<boolean> {
    return this.#repository.consumeRecoveryCode(userId, credentialId, codeHash, now, requestId);
  }

  recordFailure(
    credentialId: string,
    maxAttempts: number,
    lockedUntil: Date,
    now: Date,
  ): Promise<void> {
    return this.#repository.recordFailure(credentialId, maxAttempts, lockedUntil, now);
  }

  onModuleDestroy(): Promise<void> {
    return this.#repository.close();
  }
}
