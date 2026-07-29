import type {
  CreateListingDraftInput,
  CreateListingDraftResult,
  FindListingDraftCreateRetryInput,
  FindListingDraftCreateRetryResult,
  ListingDraftJsonValue,
  ListingDraftReferences,
  ListingDraftWriteFields,
  ResolveListingDraftReferencesInput,
  UpdateListingDraftInput,
  UpdateListingDraftResult,
} from "@socal/database/listing-draft";
import type {
  OwnerListingProjection,
  PublicListingProjection,
  PublicListingReadInput,
  ScopedListingReadInput,
} from "@socal/database/listing";
import type {
  FindListingSubmissionRetryInput,
  FindListingSubmissionRetryResult,
  ListingSubmissionCandidate,
  ListingSubmissionProjection,
  ListingSubmissionTransitionEvidence,
  SubmitListingInput,
  SubmitListingResult,
} from "@socal/database/listing-submission";

export const LISTING_STORE = Symbol("LISTING_STORE");

export type ListingStore = {
  resolveReferences(
    input: ResolveListingDraftReferencesInput,
  ): Promise<ListingDraftReferences | null>;
  findCreateRetry(
    input: FindListingDraftCreateRetryInput,
  ): Promise<FindListingDraftCreateRetryResult>;
  createDraft(input: CreateListingDraftInput): Promise<CreateListingDraftResult>;
  updateDraft(input: UpdateListingDraftInput): Promise<UpdateListingDraftResult>;
  findPublicById(input: PublicListingReadInput): Promise<PublicListingProjection | null>;
  findByIdForOwner(input: ScopedListingReadInput): Promise<OwnerListingProjection | null>;
  findSubmissionRetry(
    input: FindListingSubmissionRetryInput,
  ): Promise<FindListingSubmissionRetryResult>;
  findSubmissionCandidate(input: {
    actorUserId: string;
    listingId: string;
  }): Promise<ListingSubmissionCandidate | null>;
  submit(input: SubmitListingInput): Promise<SubmitListingResult>;
};

export type {
  CreateListingDraftInput,
  CreateListingDraftResult,
  FindListingDraftCreateRetryInput,
  FindListingDraftCreateRetryResult,
  ListingDraftJsonValue,
  ListingDraftReferences,
  ListingDraftWriteFields,
  OwnerListingProjection,
  PublicListingProjection,
  ResolveListingDraftReferencesInput,
  UpdateListingDraftInput,
  UpdateListingDraftResult,
  FindListingSubmissionRetryInput,
  FindListingSubmissionRetryResult,
  ListingSubmissionCandidate,
  ListingSubmissionProjection,
  ListingSubmissionTransitionEvidence,
  SubmitListingInput,
  SubmitListingResult,
};
