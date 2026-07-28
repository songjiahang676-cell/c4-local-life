import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type { ApiEnvironment } from "@socal/config";
import type {
  PasswordLoginRequest,
  PasswordRecoveryAcceptedResponse,
  PasswordRecoveryConfirmRequest,
  PasswordRecoveryRequest,
  PasswordRecoveryResponse,
  SessionResponse,
} from "@socal/contracts";
import { API_ENVIRONMENT } from "../../common/api-environment.token";
import {
  AuthSessionService,
  SessionSubjectUnavailableError,
  type SessionClientMetadata,
} from "./auth-session.service";
import {
  hashPassword,
  normalizeAndValidatePassword,
  verifyPassword,
  WeakPasswordError,
} from "./password-crypto";
import {
  PASSWORD_NOTIFICATION_GATEWAY,
  type PasswordNotificationGateway,
} from "./password-notification.gateway";
import { PASSWORD_STORE, type PasswordIdentifier, type PasswordStore } from "./password.store";

const millisecondsPerSecond = 1_000;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const phonePattern = /^\+[1-9]\d{7,14}$/u;

export class InvalidPasswordCredentialsError extends Error {
  constructor() {
    super("The credentials are invalid");
    this.name = "InvalidPasswordCredentialsError";
  }
}

export class InvalidPasswordRecoveryError extends Error {
  constructor() {
    super("The password recovery request is invalid or expired");
    this.name = "InvalidPasswordRecoveryError";
  }
}

export class PasswordRateLimitError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super("Password authentication is temporarily limited");
    this.name = "PasswordRateLimitError";
  }
}

export class PasswordRecoveryCooldownError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super("Password recovery is in its security cooldown");
    this.name = "PasswordRecoveryCooldownError";
  }
}

export type PasswordRequestMetadata = {
  ipAddress: string;
  deviceId: string;
  userAgent?: string;
};

function addSeconds(value: Date, seconds: number): Date {
  return new Date(value.getTime() + seconds * millisecondsPerSecond);
}

function keyedHash(secret: string, domain: string, value: string): string {
  return createHmac("sha256", secret)
    .update(domain, "utf8")
    .update("\0", "utf8")
    .update(value, "utf8")
    .digest("hex");
}

function identifier(value: string): PasswordIdentifier {
  const normalized = value.trim().toLowerCase();
  if (emailPattern.test(normalized)) {
    return { kind: "EMAIL", value: normalized, hash: "" };
  }
  const phone = value.trim();
  if (phonePattern.test(phone)) {
    return { kind: "PHONE", value: phone, hash: "" };
  }
  throw new InvalidPasswordCredentialsError();
}

@Injectable()
export class PasswordService {
  readonly #pepper: string;
  readonly #dummyHash: Promise<string>;

  constructor(
    @Inject(API_ENVIRONMENT) private readonly environment: ApiEnvironment,
    @Inject(PASSWORD_STORE) private readonly store: PasswordStore,
    @Inject(PASSWORD_NOTIFICATION_GATEWAY)
    private readonly notifications: PasswordNotificationGateway,
    private readonly sessions: AuthSessionService,
  ) {
    this.#pepper = environment.PASSWORD_PEPPER.reveal();
    this.#dummyHash = hashPassword(
      "dummy password material for unavailable accounts 2026",
      this.#pepper,
    );
  }

  async login(
    input: PasswordLoginRequest,
    metadata: PasswordRequestMetadata,
    now = new Date(),
  ): Promise<{ response: SessionResponse; cookie: string }> {
    const subject = this.#identifier(input.identifier);
    const result = await this.store.beginLogin({
      attemptId: randomUUID(),
      identifier: subject,
      ipHash: this.#hash("password-login-ip-v1", metadata.ipAddress),
      deviceHash: this.#hash("password-login-device-v1", metadata.deviceId),
      now,
      limits: {
        identifier: {
          limit: this.environment.PASSWORD_LOGIN_IDENTIFIER_LIMIT,
          windowSeconds: this.environment.PASSWORD_LOGIN_IDENTIFIER_WINDOW_SECONDS,
        },
        ip: {
          limit: this.environment.PASSWORD_LOGIN_IP_LIMIT,
          windowSeconds: this.environment.PASSWORD_LOGIN_IP_WINDOW_SECONDS,
        },
        device: {
          limit: this.environment.PASSWORD_LOGIN_DEVICE_LIMIT,
          windowSeconds: this.environment.PASSWORD_LOGIN_DEVICE_WINDOW_SECONDS,
        },
      },
    });
    if (result.kind === "rate_limited") {
      throw new PasswordRateLimitError(result.retryAfterSeconds);
    }

    const locked = result.lockedUntil !== null && result.lockedUntil.getTime() > now.getTime();
    const encoded = result.passwordHash?.startsWith("$scrypt$ln=17,r=8,p=1$")
      ? result.passwordHash
      : await this.#dummyHash;
    const verified = await verifyPassword(input.password, encoded, this.#pepper);
    const credentialsMatch =
      !locked && Boolean(result.userId) && Boolean(result.passwordHash) && verified;
    const accepted = await this.store.completeLogin(
      result.attemptId,
      locked ? null : result.userId,
      result.passwordHash,
      credentialsMatch,
      this.environment.PASSWORD_LOGIN_MAX_FAILURES,
      addSeconds(now, this.environment.PASSWORD_LOGIN_LOCK_SECONDS),
      now,
    );
    if (!accepted) {
      if (locked) {
        throw new PasswordRateLimitError(
          Math.max(1, Math.ceil((result.lockedUntil!.getTime() - now.getTime()) / 1_000)),
        );
      }
      throw new InvalidPasswordCredentialsError();
    }

    let issued: Awaited<ReturnType<AuthSessionService["issueSession"]>>;
    try {
      issued = await this.sessions.issueSession(
        result.userId!,
        {
          userAgent: metadata.userAgent,
          ipAddress: metadata.ipAddress,
        } satisfies SessionClientMetadata,
        now,
      );
    } catch (error) {
      if (error instanceof SessionSubjectUnavailableError) {
        throw new InvalidPasswordCredentialsError();
      }
      throw error;
    }
    return { response: { data: issued.response }, cookie: issued.cookie };
  }

  async requestRecovery(
    input: PasswordRecoveryRequest,
    metadata: PasswordRequestMetadata,
    requestId: string,
    now = new Date(),
  ): Promise<PasswordRecoveryAcceptedResponse> {
    const subject = this.#identifier(input.destination);
    if (subject.kind !== input.channel) throw new InvalidPasswordCredentialsError();
    const id = randomUUID();
    const token = randomBytes(32).toString("base64url");
    const availableAt = addSeconds(now, this.environment.PASSWORD_RECOVERY_COOLDOWN_SECONDS);
    const expiresAt = addSeconds(now, this.environment.PASSWORD_RECOVERY_TTL_SECONDS);
    const result = await this.store.createRecovery({
      id,
      identifier: subject,
      channel: input.channel,
      tokenHash: this.#recoveryTokenHash(id, token),
      ipHash: this.#hash("password-recovery-ip-v1", metadata.ipAddress),
      deviceHash: this.#hash("password-recovery-device-v1", metadata.deviceId),
      availableAt,
      expiresAt,
      now,
      limits: {
        destination: {
          limit: this.environment.PASSWORD_RECOVERY_DESTINATION_LIMIT,
          windowSeconds: this.environment.PASSWORD_RECOVERY_DESTINATION_WINDOW_SECONDS,
        },
        ip: {
          limit: this.environment.PASSWORD_RECOVERY_IP_LIMIT,
          windowSeconds: this.environment.PASSWORD_RECOVERY_IP_WINDOW_SECONDS,
        },
        device: {
          limit: this.environment.PASSWORD_RECOVERY_DEVICE_LIMIT,
          windowSeconds: this.environment.PASSWORD_RECOVERY_DEVICE_WINDOW_SECONDS,
        },
      },
    });
    if (result.kind === "rate_limited") {
      throw new PasswordRateLimitError(result.retryAfterSeconds);
    }
    await this.#notify({
      kind: "RECOVERY_REQUESTED",
      deliverable: result.deliveryAllowed,
      channel: input.channel,
      destination: subject.value,
      locale: result.locale,
      requestId: id,
      token,
      availableAt,
      expiresAt,
    });
    return {
      accepted: true,
      requestId,
      recoveryRequestId: id,
      availableAt: availableAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
    };
  }

  async confirmRecovery(
    input: PasswordRecoveryConfirmRequest,
    metadata: PasswordRequestMetadata,
    requestId: string,
    now = new Date(),
  ): Promise<PasswordRecoveryResponse> {
    const gate = await this.store.recoveryGate(
      input.recoveryRequestId,
      now,
      this.environment.PASSWORD_RECOVERY_MAX_ATTEMPTS,
    );
    if (gate.kind === "invalid") throw new InvalidPasswordRecoveryError();
    if (gate.kind === "cooldown") {
      throw new PasswordRecoveryCooldownError(gate.retryAfterSeconds);
    }
    if (gate.kind === "rate_limited") {
      throw new PasswordRateLimitError(gate.retryAfterSeconds);
    }

    const normalized = normalizeAndValidatePassword(input.newPassword);
    const encoded = await hashPassword(normalized, this.#pepper);
    const result = await this.store.completeRecovery({
      id: input.recoveryRequestId,
      tokenHash: this.#recoveryTokenHash(input.recoveryRequestId, input.token),
      passwordHash: encoded,
      now,
      maximumAttempts: this.environment.PASSWORD_RECOVERY_MAX_ATTEMPTS,
      requestId,
      ipHash: this.#hash("password-recovery-ip-v1", metadata.ipAddress),
    });
    if (result.kind === "invalid") throw new InvalidPasswordRecoveryError();
    if (result.kind === "cooldown") {
      throw new PasswordRecoveryCooldownError(result.retryAfterSeconds);
    }
    if (result.kind === "rate_limited") {
      throw new PasswordRateLimitError(result.retryAfterSeconds);
    }
    await this.#notify({
      kind: "PASSWORD_CHANGED",
      deliverable: true,
      ...result.notification,
      changedAt: now,
    });
    return { data: { passwordChanged: true, sessionsRevoked: true } };
  }

  #identifier(value: string): PasswordIdentifier {
    const parsed = identifier(value);
    return {
      ...parsed,
      hash: this.#hash("password-identifier-v1", `${parsed.kind}\0${parsed.value}`),
    };
  }

  #hash(domain: string, value: string): string {
    return keyedHash(this.#pepper, domain, value);
  }

  #recoveryTokenHash(id: string, token: string): string {
    return this.#hash("password-recovery-token-v1", `${id}\0${token}`);
  }

  async #notify(message: Parameters<PasswordNotificationGateway["dispatch"]>[0]): Promise<void> {
    try {
      await this.notifications.dispatch(message);
    } catch {
      // The public response stays uniform when the provider is unavailable. A durable
      // notification adapter replaces the unavailable default in NOTIF-001/EVT-001.
    }
  }
}

export { WeakPasswordError };
