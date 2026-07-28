import type {
  PasswordLoginBeginInput,
  PasswordLoginBeginResult,
  PasswordIdentifier,
  PasswordRecoveryCompleteInput,
  PasswordRecoveryCompleteResult,
  PasswordRecoveryCreateInput,
  PasswordRecoveryCreateResult,
  PasswordRecoveryGateResult,
} from "@socal/database/password-credential";

export const PASSWORD_STORE = Symbol("PASSWORD_STORE");

export type PasswordStore = {
  beginLogin(input: PasswordLoginBeginInput): Promise<PasswordLoginBeginResult>;
  completeLogin(
    attemptId: string,
    userId: string | null,
    expectedPasswordHash: string | null,
    success: boolean,
    maximumFailures: number,
    lockedUntil: Date,
    now: Date,
  ): Promise<boolean>;
  createRecovery(input: PasswordRecoveryCreateInput): Promise<PasswordRecoveryCreateResult>;
  recoveryGate(id: string, now: Date, maximumAttempts: number): Promise<PasswordRecoveryGateResult>;
  completeRecovery(input: PasswordRecoveryCompleteInput): Promise<PasswordRecoveryCompleteResult>;
};

export type {
  PasswordLoginBeginInput,
  PasswordLoginBeginResult,
  PasswordIdentifier,
  PasswordRecoveryCompleteInput,
  PasswordRecoveryCompleteResult,
  PasswordRecoveryCreateInput,
  PasswordRecoveryCreateResult,
  PasswordRecoveryGateResult,
};
