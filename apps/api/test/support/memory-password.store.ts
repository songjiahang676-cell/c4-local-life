import type {
  PasswordLoginBeginInput,
  PasswordLoginBeginResult,
  PasswordRecoveryCompleteInput,
  PasswordRecoveryCompleteResult,
  PasswordRecoveryCreateInput,
  PasswordRecoveryCreateResult,
  PasswordRecoveryGateResult,
} from "@socal/database/password-credential";
import type {
  PasswordNotificationGateway,
  PasswordNotificationMessage,
} from "../../src/modules/auth/password-notification.gateway";
import type { PasswordStore } from "../../src/modules/auth/password.store";

type Account = {
  userId: string;
  identifier: string;
  passwordHash: string | null;
  locale: "zh-Hans" | "en-US";
  failedAttempts: number;
  lockedUntil: Date | null;
};

type Attempt = {
  input: PasswordLoginBeginInput;
  completed: boolean;
};

type Recovery = {
  input: PasswordRecoveryCreateInput;
  userId: string | null;
  failedAttempts: number;
  consumed: boolean;
  superseded: boolean;
};

export class MemoryPasswordStore implements PasswordStore {
  readonly #accounts = new Map<string, Account>();
  readonly #attempts = new Map<string, Attempt>();
  readonly #recoveries = new Map<string, Recovery>();
  forceRateLimited = false;

  registerAccount(input: {
    userId: string;
    identifier: string;
    passwordHash?: string | null;
    locale?: "zh-Hans" | "en-US";
  }): void {
    this.#accounts.set(input.identifier.toLowerCase(), {
      userId: input.userId,
      identifier: input.identifier.toLowerCase(),
      passwordHash: input.passwordHash ?? null,
      locale: input.locale ?? "zh-Hans",
      failedAttempts: 0,
      lockedUntil: null,
    });
  }

  passwordHash(identifier: string): string | null {
    return this.#accounts.get(identifier.toLowerCase())?.passwordHash ?? null;
  }

  makeRecoveryReady(id: string, now = new Date()): void {
    const recovery = this.#recoveries.get(id);
    if (recovery) recovery.input.availableAt = now;
  }

  beginLogin(input: PasswordLoginBeginInput): Promise<PasswordLoginBeginResult> {
    if (this.forceRateLimited) {
      return Promise.resolve({ kind: "rate_limited", retryAfterSeconds: 60 });
    }
    const account = this.#accounts.get(input.identifier.value.toLowerCase());
    this.#attempts.set(input.attemptId, { input, completed: false });
    return Promise.resolve({
      kind: "begun",
      attemptId: input.attemptId,
      userId: account?.userId ?? null,
      passwordHash: account?.passwordHash ?? null,
      lockedUntil: account?.lockedUntil ?? null,
    });
  }

  completeLogin(
    attemptId: string,
    userId: string | null,
    expectedPasswordHash: string | null,
    success: boolean,
    maximumFailures: number,
    lockedUntil: Date,
  ): Promise<boolean> {
    const attempt = this.#attempts.get(attemptId);
    if (!attempt || attempt.completed) return Promise.resolve(false);
    attempt.completed = true;
    const account = [...this.#accounts.values()].find((candidate) => candidate.userId === userId);
    if (!account || !expectedPasswordHash || account.passwordHash !== expectedPasswordHash) {
      return Promise.resolve(false);
    }
    if (success) {
      account.failedAttempts = 0;
      account.lockedUntil = null;
      return Promise.resolve(true);
    }
    account.failedAttempts += 1;
    if (account.failedAttempts >= maximumFailures) {
      account.failedAttempts = 0;
      account.lockedUntil = lockedUntil;
    }
    return Promise.resolve(false);
  }

  createRecovery(input: PasswordRecoveryCreateInput): Promise<PasswordRecoveryCreateResult> {
    if (this.forceRateLimited) {
      return Promise.resolve({ kind: "rate_limited", retryAfterSeconds: 60 });
    }
    const account = this.#accounts.get(input.identifier.value.toLowerCase());
    for (const recovery of this.#recoveries.values()) {
      if (
        recovery.input.identifier.hash === input.identifier.hash &&
        !recovery.consumed &&
        !recovery.superseded
      ) {
        recovery.superseded = true;
      }
    }
    this.#recoveries.set(input.id, {
      input,
      userId: account?.userId ?? null,
      failedAttempts: 0,
      consumed: false,
      superseded: false,
    });
    return Promise.resolve({
      kind: "created",
      deliveryAllowed: Boolean(account),
      locale: account?.locale ?? "zh-Hans",
    });
  }

  recoveryGate(
    id: string,
    now: Date,
    maximumAttempts: number,
  ): Promise<PasswordRecoveryGateResult> {
    const recovery = this.#recoveries.get(id);
    if (
      !recovery ||
      !recovery.userId ||
      recovery.consumed ||
      recovery.superseded ||
      recovery.input.expiresAt <= now
    ) {
      return Promise.resolve({ kind: "invalid" });
    }
    if (recovery.failedAttempts >= maximumAttempts) {
      return Promise.resolve({ kind: "rate_limited", retryAfterSeconds: 60 });
    }
    if (recovery.input.availableAt > now) {
      return Promise.resolve({
        kind: "cooldown",
        retryAfterSeconds: Math.ceil(
          (recovery.input.availableAt.getTime() - now.getTime()) / 1_000,
        ),
      });
    }
    return Promise.resolve({ kind: "ready" });
  }

  completeRecovery(input: PasswordRecoveryCompleteInput): Promise<PasswordRecoveryCompleteResult> {
    const recovery = this.#recoveries.get(input.id);
    if (
      !recovery ||
      !recovery.userId ||
      recovery.consumed ||
      recovery.superseded ||
      recovery.input.expiresAt <= input.now
    ) {
      return Promise.resolve({ kind: "invalid" });
    }
    if (recovery.input.availableAt > input.now) {
      return Promise.resolve({
        kind: "cooldown",
        retryAfterSeconds: Math.ceil(
          (recovery.input.availableAt.getTime() - input.now.getTime()) / 1_000,
        ),
      });
    }
    if (recovery.failedAttempts >= input.maximumAttempts) {
      return Promise.resolve({ kind: "rate_limited", retryAfterSeconds: 60 });
    }
    if (recovery.input.tokenHash !== input.tokenHash) {
      recovery.failedAttempts += 1;
      return Promise.resolve(
        recovery.failedAttempts >= input.maximumAttempts
          ? { kind: "rate_limited", retryAfterSeconds: 60 }
          : { kind: "invalid" },
      );
    }
    const account = [...this.#accounts.values()].find(
      (candidate) => candidate.userId === recovery.userId,
    );
    if (!account) return Promise.resolve({ kind: "invalid" });
    account.passwordHash = input.passwordHash;
    account.failedAttempts = 0;
    account.lockedUntil = null;
    recovery.consumed = true;
    return Promise.resolve({
      kind: "completed",
      notification: {
        channel: recovery.input.channel,
        destination: account.identifier,
        locale: account.locale,
      },
    });
  }
}

export class CapturingPasswordNotificationGateway implements PasswordNotificationGateway {
  readonly messages: PasswordNotificationMessage[] = [];

  dispatch(message: PasswordNotificationMessage): Promise<void> {
    this.messages.push(message);
    return Promise.resolve();
  }
}
