import { Inject, Injectable, type OnModuleDestroy } from "@nestjs/common";
import type { ApiEnvironment } from "@socal/config";
import { PasswordCredentialRepository } from "@socal/database/password-credential";
import { API_ENVIRONMENT } from "../../common/api-environment.token";
import type {
  PasswordLoginBeginInput,
  PasswordLoginBeginResult,
  PasswordRecoveryCompleteInput,
  PasswordRecoveryCompleteResult,
  PasswordRecoveryCreateInput,
  PasswordRecoveryCreateResult,
  PasswordRecoveryGateResult,
  PasswordStore,
} from "./password.store";

@Injectable()
export class DatabasePasswordStore implements PasswordStore, OnModuleDestroy {
  readonly #repository: PasswordCredentialRepository;

  constructor(@Inject(API_ENVIRONMENT) environment: ApiEnvironment) {
    this.#repository = new PasswordCredentialRepository({
      connectionString: environment.DATABASE_URL,
      poolMaximum: environment.DATABASE_POOL_MAX,
    });
  }

  beginLogin(input: PasswordLoginBeginInput): Promise<PasswordLoginBeginResult> {
    return this.#repository.beginLogin(input);
  }

  completeLogin(
    attemptId: string,
    userId: string | null,
    expectedPasswordHash: string | null,
    success: boolean,
    maximumFailures: number,
    lockedUntil: Date,
    now: Date,
  ): Promise<boolean> {
    return this.#repository.completeLogin(
      attemptId,
      userId,
      expectedPasswordHash,
      success,
      maximumFailures,
      lockedUntil,
      now,
    );
  }

  createRecovery(input: PasswordRecoveryCreateInput): Promise<PasswordRecoveryCreateResult> {
    return this.#repository.createRecovery(input);
  }

  recoveryGate(
    id: string,
    now: Date,
    maximumAttempts: number,
  ): Promise<PasswordRecoveryGateResult> {
    return this.#repository.recoveryGate(id, now, maximumAttempts);
  }

  completeRecovery(input: PasswordRecoveryCompleteInput): Promise<PasswordRecoveryCompleteResult> {
    return this.#repository.completeRecovery(input);
  }

  onModuleDestroy(): Promise<void> {
    return this.#repository.close();
  }
}
