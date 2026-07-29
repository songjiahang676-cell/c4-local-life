import { Inject, Injectable, type OnModuleDestroy } from "@nestjs/common";
import type { ApiEnvironment } from "@socal/config";
import {
  ListingDraftRepository,
  type CreateListingDraftInput,
  type CreateListingDraftResult,
  type FindListingDraftCreateRetryInput,
  type FindListingDraftCreateRetryResult,
  type ListingDraftReferences,
  type ResolveListingDraftReferencesInput,
  type UpdateListingDraftInput,
  type UpdateListingDraftResult,
} from "@socal/database/listing-draft";
import {
  ListingRepository,
  type OwnerListingProjection,
  type PublicListingProjection,
  type PublicListingReadInput,
  type ScopedListingReadInput,
} from "@socal/database/listing";
import { API_ENVIRONMENT } from "../../common/api-environment.token";
import type { ListingStore } from "./listing.store";

@Injectable()
export class DatabaseListingStore implements ListingStore, OnModuleDestroy {
  readonly #drafts: ListingDraftRepository;
  readonly #listings: ListingRepository;

  constructor(@Inject(API_ENVIRONMENT) environment: ApiEnvironment) {
    const options = {
      connectionString: environment.DATABASE_URL,
      poolMaximum: environment.DATABASE_POOL_MAX,
    };
    this.#drafts = new ListingDraftRepository(options);
    this.#listings = new ListingRepository(options);
  }

  resolveReferences(
    input: ResolveListingDraftReferencesInput,
  ): Promise<ListingDraftReferences | null> {
    return this.#drafts.resolveReferences(input);
  }

  findCreateRetry(
    input: FindListingDraftCreateRetryInput,
  ): Promise<FindListingDraftCreateRetryResult> {
    return this.#drafts.findCreateRetry(input);
  }

  createDraft(input: CreateListingDraftInput): Promise<CreateListingDraftResult> {
    return this.#drafts.createDraft(input);
  }

  updateDraft(input: UpdateListingDraftInput): Promise<UpdateListingDraftResult> {
    return this.#drafts.updateDraft(input);
  }

  findPublicById(input: PublicListingReadInput): Promise<PublicListingProjection | null> {
    return this.#listings.findPublicById(input);
  }

  findByIdForOwner(input: ScopedListingReadInput): Promise<OwnerListingProjection | null> {
    return this.#listings.findByIdForOwner(input);
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all([this.#drafts.close(), this.#listings.close()]);
  }
}
