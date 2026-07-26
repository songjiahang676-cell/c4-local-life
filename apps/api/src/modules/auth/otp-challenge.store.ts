import type {
  OtpChallengeCreateInput,
  OtpChallengeCreateResult,
  OtpChallengeVerifyInput,
  OtpChallengeVerifyResult,
} from "@socal/database/otp-challenge";

export const OTP_CHALLENGE_STORE = Symbol("OTP_CHALLENGE_STORE");

export type OtpChallengeStore = {
  create(input: OtpChallengeCreateInput): Promise<OtpChallengeCreateResult>;
  verify(input: OtpChallengeVerifyInput): Promise<OtpChallengeVerifyResult>;
};
