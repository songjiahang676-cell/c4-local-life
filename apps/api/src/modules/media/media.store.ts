import type {
  MediaUploadIntentRecord,
  ReserveMediaUploadIntentInput,
  ReserveMediaUploadIntentResult,
} from "@socal/database/media";

export const MEDIA_STORE = Symbol("MEDIA_STORE");

export type MediaStore = {
  reserveUploadIntent(
    input: ReserveMediaUploadIntentInput,
  ): Promise<ReserveMediaUploadIntentResult>;
};

export type {
  MediaUploadIntentRecord,
  ReserveMediaUploadIntentInput,
  ReserveMediaUploadIntentResult,
};
