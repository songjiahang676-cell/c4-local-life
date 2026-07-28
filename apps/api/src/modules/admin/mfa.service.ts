import { Inject, Injectable } from "@nestjs/common";
import type { ApiEnvironment } from "@socal/config";
import type {
  AdminMfaActivationResponse,
  AdminMfaEnrollmentResponse,
  AdminMfaVerificationResponse,
} from "@socal/contracts";
import { API_ENVIRONMENT } from "../../common/api-environment.token";
import {
  AuthSessionService,
  type IssuedSession,
  type SessionClientMetadata,
} from "../auth/auth-session.service";
import {
  buildOtpAuthUri,
  decryptTotpSecret,
  encryptTotpSecret,
  generateRecoveryCodes,
  generateTotpSecret,
  hashRecoveryCode,
  matchTotpStep,
  normalizeRecoveryCode,
} from "./mfa-crypto";
import { MFA_STORE, type MfaCredentialSecret, type MfaStore } from "./mfa.store";

const millisecondsPerSecond = 1_000;
const encryptionKeyVersion = 1;

export class MfaEnrollmentConflictError extends Error {
  constructor() {
    super("An active MFA credential already exists");
    this.name = "MfaEnrollmentConflictError";
  }
}

export class MfaNotEnrolledError extends Error {
  constructor() {
    super("MFA enrollment is required");
    this.name = "MfaNotEnrolledError";
  }
}

export class InvalidMfaCodeError extends Error {
  constructor() {
    super("The MFA verification is invalid or expired");
    this.name = "InvalidMfaCodeError";
  }
}

export class MfaRateLimitError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super("MFA verification is temporarily locked");
    this.name = "MfaRateLimitError";
  }
}

export class MfaSessionUnavailableError extends Error {
  constructor() {
    super("The authenticated session is no longer available");
    this.name = "MfaSessionUnavailableError";
  }
}

export type MfaVerificationContext = {
  userId: string;
  currentToken: string;
  requestId: string;
  metadata: SessionClientMetadata;
};

export type MfaActivationResult = {
  response: AdminMfaActivationResponse;
  issuedSession: IssuedSession | null;
};

export type MfaVerificationResult = {
  response: AdminMfaVerificationResponse;
  issuedSession: IssuedSession;
};

function addSeconds(value: Date, seconds: number): Date {
  return new Date(value.getTime() + seconds * millisecondsPerSecond);
}

@Injectable()
export class MfaService {
  readonly #masterSecret: string;

  constructor(
    @Inject(API_ENVIRONMENT) private readonly environment: ApiEnvironment,
    @Inject(MFA_STORE) private readonly store: MfaStore,
    private readonly sessions: AuthSessionService,
  ) {
    this.#masterSecret = environment.MFA_SECRET.reveal();
  }

  async beginEnrollment(userId: string, now = new Date()): Promise<AdminMfaEnrollmentResponse> {
    const secret = generateTotpSecret();
    const expiresAt = addSeconds(now, this.environment.MFA_ENROLLMENT_TTL_SECONDS);
    const result = await this.store.startEnrollment({
      userId,
      encryptedSecret: encryptTotpSecret(secret, this.#masterSecret),
      keyVersion: encryptionKeyVersion,
      expiresAt,
      now,
    });
    if (result.kind === "active") throw new MfaEnrollmentConflictError();
    if (result.kind === "unavailable") throw new MfaNotEnrolledError();
    const responseSecret =
      result.kind === "existing"
        ? decryptTotpSecret(result.encryptedSecret, this.#masterSecret)
        : secret;
    const responseExpiresAt = result.kind === "existing" ? result.expiresAt : expiresAt;
    return {
      data: {
        credentialId: result.credentialId,
        secret: responseSecret,
        otpauthUri: buildOtpAuthUri(userId, responseSecret),
        expiresAt: responseExpiresAt.toISOString(),
      },
    };
  }

  async activateEnrollment(
    context: MfaVerificationContext,
    credentialId: string,
    code: string,
    now = new Date(),
  ): Promise<MfaActivationResult> {
    const credential = await this.store.findPending(context.userId, credentialId, now);
    if (!credential) throw new InvalidMfaCodeError();
    this.#assertNotLocked(credential, now);

    const step = matchTotpStep(
      decryptTotpSecret(credential.encryptedSecret, this.#masterSecret),
      code,
      now,
    );
    if (step === null || (credential.lastUsedStep !== null && step <= credential.lastUsedStep)) {
      return this.#reject(credential, now);
    }

    const recoveryCodes = this.#uniqueRecoveryCodes();
    const activated = await this.store.activate(
      context.userId,
      credential.id,
      step,
      recoveryCodes.map((recoveryCode) => hashRecoveryCode(recoveryCode, this.#masterSecret)),
      now,
      context.requestId,
    );
    if (!activated) throw new InvalidMfaCodeError();

    const issuedSession = await this.sessions.elevateWithMfa(
      context.currentToken,
      context.metadata,
      now,
    );
    const stepUpExpiresAt = addSeconds(now, this.environment.ADMIN_STEP_UP_TTL_SECONDS);
    return {
      issuedSession,
      response: {
        data: {
          recoveryCodes,
          mfaVerifiedAt: now.toISOString(),
          stepUpExpiresAt: stepUpExpiresAt.toISOString(),
        },
      },
    };
  }

  async verify(
    context: MfaVerificationContext,
    code: string,
    now = new Date(),
  ): Promise<MfaVerificationResult> {
    const credential = await this.store.findActive(context.userId);
    if (!credential) throw new MfaNotEnrolledError();
    this.#assertNotLocked(credential, now);

    const recoveryCode = normalizeRecoveryCode(code);
    let recoveryCodeUsed = false;
    let verified = false;
    if (recoveryCode) {
      recoveryCodeUsed = true;
      verified = await this.store.consumeRecoveryCode(
        context.userId,
        credential.id,
        hashRecoveryCode(recoveryCode, this.#masterSecret),
        now,
        context.requestId,
      );
    } else {
      const step = matchTotpStep(
        decryptTotpSecret(credential.encryptedSecret, this.#masterSecret),
        code,
        now,
      );
      if (step !== null && (credential.lastUsedStep === null || step > credential.lastUsedStep)) {
        verified = await this.store.consumeTotp(
          context.userId,
          credential.id,
          step,
          now,
          context.requestId,
        );
      }
    }
    if (!verified) await this.#reject(credential, now);

    const issuedSession = await this.sessions.elevateWithMfa(
      context.currentToken,
      context.metadata,
      now,
    );
    if (!issuedSession) throw new MfaSessionUnavailableError();
    return {
      issuedSession,
      response: {
        data: {
          mfaVerifiedAt: now.toISOString(),
          stepUpExpiresAt: addSeconds(
            now,
            this.environment.ADMIN_STEP_UP_TTL_SECONDS,
          ).toISOString(),
          recoveryCodeUsed,
        },
      },
    };
  }

  #assertNotLocked(credential: MfaCredentialSecret, now: Date): void {
    if (credential.lockedUntil && credential.lockedUntil > now) {
      throw new MfaRateLimitError(
        Math.max(
          1,
          Math.ceil((credential.lockedUntil.getTime() - now.getTime()) / millisecondsPerSecond),
        ),
      );
    }
  }

  async #reject(credential: MfaCredentialSecret, now: Date): Promise<never> {
    const willLock = credential.failedAttempts + 1 >= this.environment.MFA_MAX_ATTEMPTS;
    await this.store.recordFailure(
      credential.id,
      this.environment.MFA_MAX_ATTEMPTS,
      addSeconds(now, this.environment.MFA_LOCK_SECONDS),
      now,
    );
    if (willLock) throw new MfaRateLimitError(this.environment.MFA_LOCK_SECONDS);
    throw new InvalidMfaCodeError();
  }

  #uniqueRecoveryCodes(): string[] {
    const codes = new Set<string>();
    while (codes.size < 10) {
      for (const code of generateRecoveryCodes(10 - codes.size)) codes.add(code);
    }
    return [...codes];
  }
}
