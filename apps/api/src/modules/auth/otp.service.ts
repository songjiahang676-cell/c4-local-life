import { createHmac, randomInt, randomUUID } from "node:crypto";
import { Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import type { ApiEnvironment } from "@socal/config";
import type { OtpAcceptedResponse, OtpRequest } from "@socal/contracts";
import { API_ENVIRONMENT } from "../../common/api-environment.token";
import { OTP_CHALLENGE_STORE, type OtpChallengeStore } from "./otp-challenge.store";
import { OTP_DELIVERY_GATEWAY, type OtpDeliveryGateway } from "./otp-delivery.gateway";

const millisecondsPerSecond = 1_000;

export class OtpRateLimitError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super("OTP rate limit exceeded");
    this.name = "OtpRateLimitError";
  }
}

export class InvalidOtpChallengeError extends Error {
  constructor() {
    super("The challenge is invalid or expired");
    this.name = "InvalidOtpChallengeError";
  }
}

export type OtpRequestMetadata = {
  actorUserId: string | null;
  ipAddress: string;
  deviceId: string;
};

function normalizeDestination(channel: OtpRequest["channel"], destination: string): string {
  const trimmed = destination.trim();
  return channel === "EMAIL" ? trimmed.toLowerCase() : trimmed;
}

function keyedHash(secret: string, domain: string, value: string): string {
  return createHmac("sha256", secret)
    .update(domain, "utf8")
    .update("\0", "utf8")
    .update(value, "utf8")
    .digest("hex");
}

function hashCode(secret: string, challengeId: string, code: string): string {
  return keyedHash(secret, "socal-otp-code-v1", `${challengeId}\0${code}`);
}

@Injectable()
export class OtpService {
  readonly #secret: string;

  constructor(
    @Inject(API_ENVIRONMENT) private readonly environment: ApiEnvironment,
    @Inject(OTP_CHALLENGE_STORE) private readonly store: OtpChallengeStore,
    @Inject(OTP_DELIVERY_GATEWAY) private readonly delivery: OtpDeliveryGateway,
  ) {
    this.#secret = environment.OTP_SECRET.reveal();
  }

  async request(
    input: OtpRequest,
    metadata: OtpRequestMetadata,
    requestId: string,
    now = new Date(),
  ): Promise<OtpAcceptedResponse> {
    if (input.purpose !== "SIGN_IN" && !metadata.actorUserId) {
      throw new UnauthorizedException("Authentication required");
    }

    const challengeId = randomUUID();
    const destination = normalizeDestination(input.channel, input.destination);
    const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
    const expiresAt = new Date(
      now.getTime() + this.environment.OTP_TTL_SECONDS * millisecondsPerSecond,
    );
    const created = await this.store.create({
      id: challengeId,
      actorUserId: metadata.actorUserId,
      channel: input.channel,
      destination,
      destinationHash: keyedHash(
        this.#secret,
        "socal-otp-destination-v1",
        `${input.channel}\0${destination}`,
      ),
      purpose: input.purpose,
      locale: input.locale ?? "zh-Hans",
      codeHash: hashCode(this.#secret, challengeId, code),
      ipHash: keyedHash(this.#secret, "socal-otp-ip-v1", metadata.ipAddress),
      deviceHash: keyedHash(this.#secret, "socal-otp-device-v1", metadata.deviceId),
      expiresAt,
      now,
      limits: {
        destination: {
          limit: this.environment.OTP_DESTINATION_LIMIT,
          windowSeconds: this.environment.OTP_DESTINATION_WINDOW_SECONDS,
        },
        ip: {
          limit: this.environment.OTP_IP_LIMIT,
          windowSeconds: this.environment.OTP_IP_WINDOW_SECONDS,
        },
        device: {
          limit: this.environment.OTP_DEVICE_LIMIT,
          windowSeconds: this.environment.OTP_DEVICE_WINDOW_SECONDS,
        },
      },
    });
    if (created.kind === "rate_limited") {
      throw new OtpRateLimitError(created.retryAfterSeconds);
    }

    if (created.deliveryAllowed) {
      await this.delivery.dispatch({
        challengeId,
        channel: input.channel,
        destination,
        purpose: input.purpose,
        locale: input.locale ?? "zh-Hans",
        code,
        expiresAt,
      });
    }

    return {
      accepted: true,
      requestId,
      challengeId: created.challenge.id,
      expiresAt: created.challenge.expiresAt.toISOString(),
    };
  }

  async verify(
    challengeId: string,
    code: string,
    deviceId: string,
    now = new Date(),
  ): Promise<string> {
    const result = await this.store.verify({
      challengeId,
      codeHash: hashCode(this.#secret, challengeId, code),
      deviceHash: keyedHash(this.#secret, "socal-otp-device-v1", deviceId),
      now,
      maximumAttempts: this.environment.OTP_MAX_ATTEMPTS,
    });
    if (result.kind === "rate_limited") {
      throw new OtpRateLimitError(result.retryAfterSeconds);
    }
    if (result.kind === "invalid") throw new InvalidOtpChallengeError();
    return result.userId;
  }
}
