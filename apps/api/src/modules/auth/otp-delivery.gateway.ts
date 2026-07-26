export const OTP_DELIVERY_GATEWAY = Symbol("OTP_DELIVERY_GATEWAY");

export type OtpDeliveryMessage = {
  challengeId: string;
  channel: "SMS" | "EMAIL";
  destination: string;
  purpose: "SIGN_IN" | "VERIFY_CONTACT" | "SENSITIVE_ACTION";
  locale: "zh-Hans" | "en-US";
  code: string;
  expiresAt: Date;
};

export type OtpDeliveryGateway = {
  dispatch(message: OtpDeliveryMessage): Promise<void>;
};

export class OtpDeliveryUnavailableError extends Error {
  constructor() {
    super("OTP delivery provider is not configured");
    this.name = "OtpDeliveryUnavailableError";
  }
}

export class FailClosedOtpDeliveryGateway implements OtpDeliveryGateway {
  dispatch(): Promise<void> {
    return Promise.reject(new OtpDeliveryUnavailableError());
  }
}
