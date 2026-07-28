import type {
  CompleteMediaUploadInput,
  CompleteMediaUploadResult,
  MediaUploadIntentRecord,
  ReserveMediaUploadIntentInput,
  ReserveMediaUploadIntentResult,
} from "@socal/database/media";

export const MEDIA_STORE = Symbol("MEDIA_STORE");

export type MediaStore = {
  reserveUploadIntent(
    input: ReserveMediaUploadIntentInput,
  ): Promise<ReserveMediaUploadIntentResult>;
  findOwnedUploadIntent(id: string, ownerId: string): Promise<MediaUploadIntentRecord | null>;
  completeUpload(input: CompleteMediaUploadInput): Promise<CompleteMediaUploadResult>;
};

export type {
  CompleteMediaUploadInput,
  CompleteMediaUploadResult,
  MediaUploadIntentRecord,
  ReserveMediaUploadIntentInput,
  ReserveMediaUploadIntentResult,
};
