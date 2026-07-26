import { Inject, Injectable, type OnModuleDestroy } from "@nestjs/common";
import type { ApiEnvironment } from "@socal/config";
import {
  OtpChallengeRepository,
  type OtpChallengeCreateInput,
  type OtpChallengeCreateResult,
  type OtpChallengeVerifyInput,
  type OtpChallengeVerifyResult,
} from "@socal/database/otp-challenge";
import { API_ENVIRONMENT } from "../../common/api-environment.token";
import type { OtpChallengeStore } from "./otp-challenge.store";

@Injectable()
export class DatabaseOtpChallengeStore implements OtpChallengeStore, OnModuleDestroy {
  readonly #repository: OtpChallengeRepository;

  constructor(@Inject(API_ENVIRONMENT) environment: ApiEnvironment) {
    this.#repository = new OtpChallengeRepository({
      connectionString: environment.DATABASE_URL,
      poolMaximum: environment.DATABASE_POOL_MAX,
    });
  }

  create(input: OtpChallengeCreateInput): Promise<OtpChallengeCreateResult> {
    return this.#repository.create(input);
  }

  verify(input: OtpChallengeVerifyInput): Promise<OtpChallengeVerifyResult> {
    return this.#repository.verify(input);
  }

  onModuleDestroy(): Promise<void> {
    return this.#repository.close();
  }
}
