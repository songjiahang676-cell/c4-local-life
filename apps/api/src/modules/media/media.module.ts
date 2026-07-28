import { type DynamicModule, Module, type Provider } from "@nestjs/common";
import type { ApiEnvironment } from "@socal/config";
import { API_ENVIRONMENT } from "../../common/api-environment.token";
import { DatabaseMediaStore } from "./database-media.store";
import { MediaController } from "./media.controller";
import { MEDIA_OBJECT_STORAGE, type MediaObjectStorage } from "./media-object-storage";
import { MediaService } from "./media.service";
import { MEDIA_STORE, type MediaStore } from "./media.store";
import { S3MediaObjectStorage } from "./s3-media-object-storage";

@Module({})
export class MediaModule {
  static register(
    environment: ApiEnvironment,
    store?: MediaStore,
    objectStorage?: MediaObjectStorage,
  ): DynamicModule {
    const storeProviders: Provider[] = store
      ? [{ provide: MEDIA_STORE, useValue: store }]
      : [DatabaseMediaStore, { provide: MEDIA_STORE, useExisting: DatabaseMediaStore }];
    const storageProviders: Provider[] = objectStorage
      ? [{ provide: MEDIA_OBJECT_STORAGE, useValue: objectStorage }]
      : [
          S3MediaObjectStorage,
          { provide: MEDIA_OBJECT_STORAGE, useExisting: S3MediaObjectStorage },
        ];
    return {
      module: MediaModule,
      controllers: [MediaController],
      providers: [
        { provide: API_ENVIRONMENT, useValue: environment },
        ...storeProviders,
        ...storageProviders,
        MediaService,
      ],
      exports: [MediaService],
    };
  }
}
