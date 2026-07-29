import { Inject, Injectable, type OnModuleDestroy } from "@nestjs/common";
import type { ApiEnvironment } from "@socal/config";
import {
  TrustSafetyRepository,
  type CommitAppealActionInput,
  type CommitReportActionInput,
  type CommitTrustSafetyActionResult,
  type CreateAppealInput,
  type CreateAppealResult,
  type CreateReportInput,
  type CreateReportResult,
  type GetAppealCaseInput,
  type GetAppealCaseResult,
  type GetReportCaseInput,
  type GetReportCaseResult,
  type ListAppealCasesInput,
  type ListAppealCasesResult,
  type ListReportCasesInput,
  type ListReportCasesResult,
} from "@socal/database/trust-safety";
import { API_ENVIRONMENT } from "../../common/api-environment.token";
import type { TrustSafetyStore } from "./trust-safety.store";

@Injectable()
export class DatabaseTrustSafetyStore implements TrustSafetyStore, OnModuleDestroy {
  readonly #repository: TrustSafetyRepository;

  constructor(@Inject(API_ENVIRONMENT) environment: ApiEnvironment) {
    this.#repository = new TrustSafetyRepository({
      connectionString: environment.DATABASE_URL,
      poolMaximum: environment.DATABASE_POOL_MAX,
    });
  }

  createReport(input: CreateReportInput): Promise<CreateReportResult> {
    return this.#repository.createReport(input);
  }

  createAppeal(input: CreateAppealInput): Promise<CreateAppealResult> {
    return this.#repository.createAppeal(input);
  }

  listReports(input: ListReportCasesInput): Promise<ListReportCasesResult> {
    return this.#repository.listReports(input);
  }

  listAppeals(input: ListAppealCasesInput): Promise<ListAppealCasesResult> {
    return this.#repository.listAppeals(input);
  }

  getReport(input: GetReportCaseInput): Promise<GetReportCaseResult> {
    return this.#repository.getReport(input);
  }

  getAppeal(input: GetAppealCaseInput): Promise<GetAppealCaseResult> {
    return this.#repository.getAppeal(input);
  }

  commitReportAction(input: CommitReportActionInput): Promise<CommitTrustSafetyActionResult> {
    return this.#repository.commitReportAction(input);
  }

  commitAppealAction(input: CommitAppealActionInput): Promise<CommitTrustSafetyActionResult> {
    return this.#repository.commitAppealAction(input);
  }

  onModuleDestroy(): Promise<void> {
    return this.#repository.close();
  }
}
