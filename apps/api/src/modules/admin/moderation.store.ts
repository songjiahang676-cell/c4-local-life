import type {
  CommitModerationActionInput,
  CommitModerationActionResult,
  GetModerationCaseInput,
  GetModerationCaseResult,
  ListModerationCasesInput,
  ListModerationCasesResult,
} from "@socal/database/moderation-case";

export const MODERATION_STORE = Symbol("MODERATION_STORE");

export type ModerationStore = {
  list(input: ListModerationCasesInput): Promise<ListModerationCasesResult>;
  get(input: GetModerationCaseInput): Promise<GetModerationCaseResult>;
  commit(input: CommitModerationActionInput): Promise<CommitModerationActionResult>;
};

export type {
  CommitModerationActionInput,
  CommitModerationActionResult,
  GetModerationCaseInput,
  GetModerationCaseResult,
  ListModerationCasesInput,
  ListModerationCasesResult,
};
