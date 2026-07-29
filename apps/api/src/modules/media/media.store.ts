import type {
  CompleteMediaUploadInput,
  CompleteMediaUploadResult,
  MediaUploadIntentRecord,
  OwnedMediaStatusRecord,
  ReserveMediaUploadIntentInput,
  ReserveMediaUploadIntentResult,
} from "@socal/database/media";

export const MEDIA_STORE = Symbol("MEDIA_STORE");

export type MediaStore = {
  reserveUploadIntent(
    input: ReserveMediaUploadIntentInput,
  ): Promise<ReserveMediaUploadIntentResult>;
  findOwnedUploadIntent(id: string, ownerId: string): Promise<MediaUploadIntentRecord | null>;
  findOwnedStatus(id: string, ownerId: string): Promise<OwnedMediaStatusRecord | null>;
  completeUpload(input: CompleteMediaUploadInput): Promise<CompleteMediaUploadResult>;
};

export type {
  CompleteMediaUploadInput,
  CompleteMediaUploadResult,
  MediaUploadIntentRecord,
  OwnedMediaStatusRecord,
  ReserveMediaUploadIntentInput,
  ReserveMediaUploadIntentResult,
};
