import { Inject, Injectable, type OnModuleDestroy } from "@nestjs/common";
import type { ApiEnvironment } from "@socal/config";
import { MediaAssetRepository } from "@socal/database/media";
import { API_ENVIRONMENT } from "../../common/api-environment.token";
import type {
  MediaStore,
  ReserveMediaUploadIntentInput,
  ReserveMediaUploadIntentResult,
} from "./media.store";

@Injectable()
export class DatabaseMediaStore implements MediaStore, OnModuleDestroy {
  readonly #repository: MediaAssetRepository;

  constructor(@Inject(API_ENVIRONMENT) environment: ApiEnvironment) {
    this.#repository = new MediaAssetRepository({
      connectionString: environment.DATABASE_URL,
      poolMaximum: environment.DATABASE_POOL_MAX,
    });
  }

  reserveUploadIntent(
    input: ReserveMediaUploadIntentInput,
  ): Promise<ReserveMediaUploadIntentResult> {
    return this.#repository.reserveUploadIntent(input);
  }

  onModuleDestroy(): Promise<void> {
    return this.#repository.close();
  }
}
