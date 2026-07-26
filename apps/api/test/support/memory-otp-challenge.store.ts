import type {
  OtpChallengeCreateInput,
  OtpChallengeCreateResult,
  OtpChallengeVerifyInput,
  OtpChallengeVerifyResult,
} from "@socal/database/otp-challenge";
import type { OtpChallengeStore } from "../../src/modules/auth/otp-challenge.store";
import type {
  OtpDeliveryGateway,
  OtpDeliveryMessage,
} from "../../src/modules/auth/otp-delivery.gateway";

type StoredChallenge = {
  input: OtpChallengeCreateInput;
  consumed: boolean;
  failedAttempts: number;
};

export class MemoryOtpChallengeStore implements OtpChallengeStore {
  readonly createInputs: OtpChallengeCreateInput[] = [];
  readonly verifyInputs: OtpChallengeVerifyInput[] = [];
  readonly #challenges = new Map<string, StoredChallenge>();
  userId = "30000000-0000-4000-8000-000000000001";

  create(input: OtpChallengeCreateInput): Promise<OtpChallengeCreateResult> {
    this.createInputs.push(input);
    const destinationCount = this.createInputs.filter(
      (candidate) =>
        candidate.destinationHash === input.destinationHash &&
        candidate.purpose === input.purpose &&
        candidate.now >=
          new Date(input.now.getTime() - input.limits.destination.windowSeconds * 1_000),
    ).length;
    const ipCount = this.createInputs.filter(
      (candidate) =>
        candidate.ipHash === input.ipHash &&
        candidate.now >= new Date(input.now.getTime() - input.limits.ip.windowSeconds * 1_000),
    ).length;
    const deviceCount = this.createInputs.filter(
      (candidate) =>
        candidate.deviceHash === input.deviceHash &&
        candidate.now >= new Date(input.now.getTime() - input.limits.device.windowSeconds * 1_000),
    ).length;

    if (
      destinationCount > input.limits.destination.limit ||
      ipCount > input.limits.ip.limit ||
      deviceCount > input.limits.device.limit
    ) {
      return Promise.resolve({
        kind: "rate_limited",
        retryAfterSeconds: Math.max(
          input.limits.destination.windowSeconds,
          input.limits.ip.windowSeconds,
          input.limits.device.windowSeconds,
        ),
      });
    }

    this.#challenges.set(input.id, {
      input,
      consumed: false,
      failedAttempts: 0,
    });
    return Promise.resolve({
      kind: "created",
      challenge: { id: input.id, expiresAt: input.expiresAt },
      deliveryAllowed: true,
    });
  }

  verify(input: OtpChallengeVerifyInput): Promise<OtpChallengeVerifyResult> {
    this.verifyInputs.push(input);
    const stored = this.#challenges.get(input.challengeId);
    if (!stored || stored.consumed || stored.input.expiresAt <= input.now) {
      return Promise.resolve({ kind: "invalid" });
    }
    if (stored.failedAttempts >= input.maximumAttempts) {
      return Promise.resolve({ kind: "rate_limited", retryAfterSeconds: 60 });
    }
    if (stored.input.codeHash !== input.codeHash || stored.input.deviceHash !== input.deviceHash) {
      stored.failedAttempts += 1;
      return Promise.resolve(
        stored.failedAttempts >= input.maximumAttempts
          ? { kind: "rate_limited", retryAfterSeconds: 60 }
          : { kind: "invalid" },
      );
    }
    stored.consumed = true;
    return Promise.resolve({ kind: "verified", userId: stored.input.actorUserId ?? this.userId });
  }
}

export class CapturingOtpDeliveryGateway implements OtpDeliveryGateway {
  readonly messages: OtpDeliveryMessage[] = [];

  dispatch(message: OtpDeliveryMessage): Promise<void> {
    this.messages.push(message);
    return Promise.resolve();
  }
}
