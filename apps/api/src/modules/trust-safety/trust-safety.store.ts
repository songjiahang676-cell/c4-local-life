import type {
  CommitAppealActionInput,
  CommitReportActionInput,
  CommitTrustSafetyActionResult,
  CreateAppealInput,
  CreateAppealResult,
  CreateReportInput,
  CreateReportResult,
  GetAppealCaseInput,
  GetAppealCaseResult,
  GetReportCaseInput,
  GetReportCaseResult,
  ListAppealCasesInput,
  ListAppealCasesResult,
  ListReportCasesInput,
  ListReportCasesResult,
} from "@socal/database/trust-safety";

export const TRUST_SAFETY_STORE = Symbol("TRUST_SAFETY_STORE");

export type TrustSafetyStore = {
  createReport(input: CreateReportInput): Promise<CreateReportResult>;
  createAppeal(input: CreateAppealInput): Promise<CreateAppealResult>;
  listReports(input: ListReportCasesInput): Promise<ListReportCasesResult>;
  listAppeals(input: ListAppealCasesInput): Promise<ListAppealCasesResult>;
  getReport(input: GetReportCaseInput): Promise<GetReportCaseResult>;
  getAppeal(input: GetAppealCaseInput): Promise<GetAppealCaseResult>;
  commitReportAction(input: CommitReportActionInput): Promise<CommitTrustSafetyActionResult>;
  commitAppealAction(input: CommitAppealActionInput): Promise<CommitTrustSafetyActionResult>;
};

export type {
  CommitAppealActionInput,
  CommitReportActionInput,
  CommitTrustSafetyActionResult,
  CreateAppealInput,
  CreateAppealResult,
  CreateReportInput,
  CreateReportResult,
  GetAppealCaseInput,
  GetAppealCaseResult,
  GetReportCaseInput,
  GetReportCaseResult,
  ListAppealCasesInput,
  ListAppealCasesResult,
  ListReportCasesInput,
  ListReportCasesResult,
};
