export const PASSWORD_NOTIFICATION_GATEWAY = Symbol("PASSWORD_NOTIFICATION_GATEWAY");

export type PasswordNotificationMessage =
  | {
      kind: "RECOVERY_REQUESTED";
      deliverable: boolean;
      channel: "EMAIL" | "SMS";
      destination: string;
      locale: "zh-Hans" | "en-US";
      requestId: string;
      token: string;
      availableAt: Date;
      expiresAt: Date;
    }
  | {
      kind: "PASSWORD_CHANGED";
      deliverable: true;
      channel: "EMAIL" | "SMS";
      destination: string;
      locale: "zh-Hans" | "en-US";
      changedAt: Date;
    };

export type PasswordNotificationGateway = {
  dispatch(message: PasswordNotificationMessage): Promise<void>;
};

export class UnavailablePasswordNotificationGateway implements PasswordNotificationGateway {
  dispatch(): Promise<void> {
    return Promise.reject(new Error("Password notification provider is not configured"));
  }
}
