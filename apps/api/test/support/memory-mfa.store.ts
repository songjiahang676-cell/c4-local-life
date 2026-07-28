import { randomUUID } from "node:crypto";
import type {
  MfaCredentialSecret,
  MfaCredentialState,
  MfaStore,
} from "../../src/modules/admin/mfa.store";

type StoredCredential = MfaCredentialSecret & {
  status: "PENDING" | "ACTIVE" | "DISABLED";
  enrollmentExpiresAt: Date;
  activatedAt: Date | null;
  recoveryCodeHashes: Set<string>;
  consumedRecoveryCodeHashes: Set<string>;
};

export class MemoryMfaStore implements MfaStore {
  readonly #byUser = new Map<string, StoredCredential>();

  findState(userId: string, now: Date): Promise<MfaCredentialState> {
    const credential = this.#byUser.get(userId);
    if (!credential) return Promise.resolve(this.#emptyState());
    if (credential.status === "PENDING" && credential.enrollmentExpiresAt <= now) {
      return Promise.resolve(this.#emptyState());
    }
    return Promise.resolve({
      credentialId: credential.id,
      status: credential.status,
      enrollmentExpiresAt: credential.status === "PENDING" ? credential.enrollmentExpiresAt : null,
      activatedAt: credential.activatedAt,
    });
  }

  startEnrollment(input: {
    userId: string;
    encryptedSecret: string;
    keyVersion: number;
    expiresAt: Date;
    now: Date;
  }): Promise<
    | { kind: "created"; credentialId: string }
    | {
        kind: "existing";
        credentialId: string;
        encryptedSecret: string;
        keyVersion: number;
        expiresAt: Date;
      }
    | { kind: "active" }
    | { kind: "unavailable" }
  > {
    const existing = this.#byUser.get(input.userId);
    if (existing?.status === "ACTIVE") return Promise.resolve({ kind: "active" });
    if (existing?.status === "DISABLED") return Promise.resolve({ kind: "unavailable" });
    if (existing?.status === "PENDING" && existing.enrollmentExpiresAt > input.now) {
      return Promise.resolve({
        kind: "existing",
        credentialId: existing.id,
        encryptedSecret: existing.encryptedSecret,
        keyVersion: existing.keyVersion,
        expiresAt: existing.enrollmentExpiresAt,
      });
    }
    const credential: StoredCredential = {
      id: existing?.id ?? randomUUID(),
      userId: input.userId,
      encryptedSecret: input.encryptedSecret,
      keyVersion: input.keyVersion,
      lastUsedStep: null,
      failedAttempts: 0,
      lockedUntil: null,
      status: "PENDING",
      enrollmentExpiresAt: input.expiresAt,
      activatedAt: null,
      recoveryCodeHashes: new Set(),
      consumedRecoveryCodeHashes: new Set(),
    };
    this.#byUser.set(input.userId, credential);
    return Promise.resolve({ kind: "created", credentialId: credential.id });
  }

  findPending(
    userId: string,
    credentialId: string,
    now: Date,
  ): Promise<MfaCredentialSecret | null> {
    const credential = this.#byUser.get(userId);
    return Promise.resolve(
      credential?.id === credentialId &&
        credential.status === "PENDING" &&
        credential.enrollmentExpiresAt > now
        ? credential
        : null,
    );
  }

  findActive(userId: string): Promise<MfaCredentialSecret | null> {
    const credential = this.#byUser.get(userId);
    return Promise.resolve(credential?.status === "ACTIVE" ? credential : null);
  }

  activate(
    userId: string,
    credentialId: string,
    lastUsedStep: bigint,
    recoveryCodeHashes: readonly string[],
    now: Date,
    _requestId: string,
  ): Promise<boolean> {
    void _requestId;
    const credential = this.#byUser.get(userId);
    if (
      !credential ||
      credential.id !== credentialId ||
      credential.status !== "PENDING" ||
      credential.enrollmentExpiresAt <= now
    ) {
      return Promise.resolve(false);
    }
    credential.status = "ACTIVE";
    credential.activatedAt = now;
    credential.lastUsedStep = lastUsedStep;
    credential.failedAttempts = 0;
    credential.lockedUntil = null;
    credential.recoveryCodeHashes = new Set(recoveryCodeHashes);
    return Promise.resolve(true);
  }

  consumeTotp(
    userId: string,
    credentialId: string,
    step: bigint,
    now: Date,
    _requestId: string,
  ): Promise<boolean> {
    void _requestId;
    const credential = this.#byUser.get(userId);
    if (
      !credential ||
      credential.id !== credentialId ||
      credential.status !== "ACTIVE" ||
      (credential.lockedUntil !== null && credential.lockedUntil > now) ||
      (credential.lastUsedStep !== null && credential.lastUsedStep >= step)
    ) {
      return Promise.resolve(false);
    }
    credential.lastUsedStep = step;
    credential.failedAttempts = 0;
    credential.lockedUntil = null;
    return Promise.resolve(true);
  }

  consumeRecoveryCode(
    userId: string,
    credentialId: string,
    codeHash: string,
    now: Date,
    _requestId: string,
  ): Promise<boolean> {
    void _requestId;
    const credential = this.#byUser.get(userId);
    if (
      !credential ||
      credential.id !== credentialId ||
      credential.status !== "ACTIVE" ||
      (credential.lockedUntil !== null && credential.lockedUntil > now) ||
      !credential.recoveryCodeHashes.has(codeHash) ||
      credential.consumedRecoveryCodeHashes.has(codeHash)
    ) {
      return Promise.resolve(false);
    }
    credential.consumedRecoveryCodeHashes.add(codeHash);
    credential.failedAttempts = 0;
    credential.lockedUntil = null;
    return Promise.resolve(true);
  }

  recordFailure(
    credentialId: string,
    maxAttempts: number,
    lockedUntil: Date,
    _now: Date,
  ): Promise<void> {
    void _now;
    const credential = [...this.#byUser.values()].find(
      (candidate) => candidate.id === credentialId,
    );
    if (!credential) return Promise.resolve();
    credential.failedAttempts += 1;
    if (credential.failedAttempts >= maxAttempts) {
      credential.failedAttempts = 0;
      credential.lockedUntil = lockedUntil;
    }
    return Promise.resolve();
  }

  #emptyState(): MfaCredentialState {
    return {
      credentialId: null,
      status: "NOT_ENROLLED",
      enrollmentExpiresAt: null,
      activatedAt: null,
    };
  }
}
