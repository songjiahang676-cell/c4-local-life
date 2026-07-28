import type {
  MfaCredentialSecret,
  MfaCredentialState,
  MfaEnrollmentStartInput,
  MfaEnrollmentStartResult,
} from "@socal/database/mfa-credential";

export const MFA_STORE = Symbol("MFA_STORE");

export type MfaStore = {
  findState(userId: string, now: Date): Promise<MfaCredentialState>;
  startEnrollment(input: MfaEnrollmentStartInput): Promise<MfaEnrollmentStartResult>;
  findPending(userId: string, credentialId: string, now: Date): Promise<MfaCredentialSecret | null>;
  findActive(userId: string): Promise<MfaCredentialSecret | null>;
  activate(
    userId: string,
    credentialId: string,
    lastUsedStep: bigint,
    recoveryCodeHashes: readonly string[],
    now: Date,
    requestId: string,
  ): Promise<boolean>;
  consumeTotp(
    userId: string,
    credentialId: string,
    step: bigint,
    now: Date,
    requestId: string,
  ): Promise<boolean>;
  consumeRecoveryCode(
    userId: string,
    credentialId: string,
    codeHash: string,
    now: Date,
    requestId: string,
  ): Promise<boolean>;
  recordFailure(
    credentialId: string,
    maxAttempts: number,
    lockedUntil: Date,
    now: Date,
  ): Promise<void>;
};

export type { MfaCredentialSecret, MfaCredentialState };
