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
  OwnerListingCursor,
  OwnerListingListInput,
  OwnerListingListResult,
  OwnerListingBucket,
  OwnerListingSummaryProjection,
  OwnerListingTransitionInput,
  OwnerListingTransitionResult,
  PublicListingCursor,
  PublicListingListInput,
  PublicListingListResult,
  PublicListingProjection,
  PublicListingReadInput,
  ScopedListingReadInput,
} from "@socal/database/listing";
import type {
  FindListingDuplicateCandidatesInput,
  FindListingSubmissionRetryInput,
  FindListingSubmissionRetryResult,
  ListingSubmissionCandidate,
  ListingSubmissionProjection,
  ListingSubmissionTransitionEvidence,
  ListingDuplicateCandidateMatch,
  SubmitListingInput,
  SubmitListingResult,
} from "@socal/database/listing-submission";
import type {
  FindPublishedRevisionRetryInput,
  FindPublishedRevisionRetryResult,
  ListListingRevisionsInput,
  ListListingRevisionsResult,
  ListingRevisionCursor,
  ListingRevisionDiffEntry,
  ListingRevisionProjection,
  ListingRevisionReasonCode,
  ListingRevisionSnapshot,
  RevisePublishedListingInput,
  RevisePublishedListingResult,
} from "@socal/database/listing-revision";

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
  listPublic(input: PublicListingListInput): Promise<PublicListingListResult>;
  listForOwner(input: OwnerListingListInput): Promise<OwnerListingListResult>;
  findPublicById(input: PublicListingReadInput): Promise<PublicListingProjection | null>;
  findByIdForOwner(input: ScopedListingReadInput): Promise<OwnerListingProjection | null>;
  transitionOwner(input: OwnerListingTransitionInput): Promise<OwnerListingTransitionResult>;
  findSubmissionRetry(
    input: FindListingSubmissionRetryInput,
  ): Promise<FindListingSubmissionRetryResult>;
  findSubmissionCandidate(input: {
    actorUserId: string;
    listingId: string;
  }): Promise<ListingSubmissionCandidate | null>;
  findDuplicateCandidates(
    input: FindListingDuplicateCandidatesInput,
  ): Promise<ListingDuplicateCandidateMatch[]>;
  findMediaPerceptualHashes(input: {
    actorUserId: string;
    listingId: string;
    mediaIds: readonly string[];
  }): Promise<string[]>;
  submit(input: SubmitListingInput): Promise<SubmitListingResult>;
  findPublishedRevisionRetry(
    input: FindPublishedRevisionRetryInput,
  ): Promise<FindPublishedRevisionRetryResult>;
  revisePublished(input: RevisePublishedListingInput): Promise<RevisePublishedListingResult>;
  listRevisions(input: ListListingRevisionsInput): Promise<ListListingRevisionsResult>;
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
  OwnerListingBucket,
  OwnerListingCursor,
  OwnerListingListInput,
  OwnerListingListResult,
  OwnerListingSummaryProjection,
  OwnerListingTransitionInput,
  OwnerListingTransitionResult,
  PublicListingCursor,
  PublicListingListInput,
  PublicListingListResult,
  PublicListingProjection,
  ResolveListingDraftReferencesInput,
  UpdateListingDraftInput,
  UpdateListingDraftResult,
  FindListingSubmissionRetryInput,
  FindListingSubmissionRetryResult,
  ListingSubmissionCandidate,
  ListingSubmissionProjection,
  FindListingDuplicateCandidatesInput,
  ListingDuplicateCandidateMatch,
  ListingSubmissionTransitionEvidence,
  SubmitListingInput,
  SubmitListingResult,
  FindPublishedRevisionRetryInput,
  FindPublishedRevisionRetryResult,
  ListListingRevisionsInput,
  ListListingRevisionsResult,
  RevisePublishedListingInput,
  RevisePublishedListingResult,
  ListingRevisionCursor,
  ListingRevisionDiffEntry,
  ListingRevisionProjection,
  ListingRevisionReasonCode,
  ListingRevisionSnapshot,
};
