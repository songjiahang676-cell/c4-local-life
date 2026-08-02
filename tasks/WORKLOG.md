# Implementation worklog

## FND-004 — 运行时配置 schema 与秘密管理接口

Task: FND-004 运行时配置 schema 与秘密管理接口  
Changed: `packages/config/src/index.ts`, `packages/config/tsconfig.build.json`, `apps/api/src/main.ts`, `apps/worker/src/main.ts`, workspace package manifests, `.env.example`, CI scripts and workflow  
Contracts: OpenAPI unchanged; runtime environment contract documented and checked  
Migrations: 无  
Security: Required configuration fails before binding ports; sensitive values use an explicit redacted wrapper; startup summaries use allowlisted fields; recursive redaction checks cover common secret keys  
Tests run: `pnpm config:check` passed; missing API configuration exited 1 without a secret; built API served `/v1/health/live` and `/v1/health/ready` with HTTP 200; `pnpm ci:quality` passed on 2026-07-24  
Not run: `bash scripts/check-architecture.sh` is not runnable in the installed Windows Git Bash because its PATH cannot locate the required Python interpreter; the equivalent repository CI workflow check ran, but this is not recorded as the shell script passing  
Observability: Structured `api.started`, `api.startup.failed`, `worker.started`, `worker.job.*`, and worker process-failure events use safe fields only  
Docs: Added `docs/runtime-configuration.md`; linked it from `README.md`; updated `.env.example` and `CHANGELOG.md`  
Known gaps: Secret-provider integration remains an infrastructure task; database/Redis/OpenSearch readiness probes belong to their owning Gate 0 tasks

## FND-005 — 四应用容器与健康检查（验证未完成）

Task: FND-005 四应用容器与健康检查  
Changed: `Dockerfile`, `.dockerignore`, `docker-compose.yml`, Web/Admin health routes, API readiness response, Worker health server, container validation script and CI image-build job  
Contracts: OpenAPI unchanged; operational HTTP health endpoints added without public business schemas  
Migrations: 无  
Security: All four runtime targets use `USER node`; Compose drops capabilities, disables privilege escalation, and does not bake `.env` into build context  
Tests run: `pnpm containers:check`, `pnpm ci:workflow:check`, `pnpm typecheck`, `pnpm lint`, and `pnpm build` passed; standalone Web/Admin live and ready returned 200; Worker live returned 200 and ready correctly returned 503 while Redis was unavailable; Podman 5.8.3 was installed and its Hyper-V provider was explicitly probed  
Not run: Actual image build and Compose startup. WSL is absent; Hyper-V services are not installed for this unelevated session, and `CONTAINERS_MACHINE_PROVIDER=hyperv podman machine init` exited 1 with `hyperv machines require admin authority` before creating a VM  
Observability: Worker exposes a separate liveness/readiness listener and reports Redis availability without returning connection details  
Docs: Added `docs/local-containers.md`, updated runtime configuration, README, `.env.example`, and `CHANGELOG.md`  
Known gaps: FND-005 remains `todo` until all four images are actually built and run; API dependency probes will be added with the database/Redis/search adapters

## FND-006 — 建立 Vitest/Testing Library 基线

Task: FND-006 建立 Vitest/Testing Library 基线  
Changed: `vitest.config.ts`, `tsconfig.tests.json`, Testing Library setup, eight workspace test files, package test/lint scripts, root test scripts, and CI report upload  
Contracts: OpenAPI/Schema/DB unchanged  
Migrations: 无  
Security: Test fixtures are deliberately fictional; configuration tests verify secret redaction and fail-fast behavior; no production data is used  
Tests run: `pnpm test:unit` passed 8 files/11 tests; `pnpm test` passed and generated JUnit, JSON, and V8 coverage; `pnpm typecheck`, `pnpm lint`, and complete `pnpm ci:quality` passed on 2026-07-24  
Not run: Browser E2E belongs to FND-007; real repository integration belongs to DATA-006  
Observability: CI retains unit and coverage reports for 14 days; no runtime telemetry changed  
Docs: Updated `docs/18-testing-quality.md` and `CHANGELOG.md`  
Known gaps: Coverage is intentionally reported without a global percentage gate at the foundation stage; risk-specific thresholds should be introduced with the relevant domain tasks

## DATA-001 — Prisma schema 校验与首个迁移

Task: DATA-001 Prisma schema 校验与首个迁移  
Changed: Prisma schema/config, `0000_extensions`, `20260725044311_baseline`, migration lock/operations notes, post-schema SQL, executable baseline checker, CI migration steps  
Contracts: OpenAPI unchanged; Prisma schema now represents the generated PostGIS geography field and three custom indexes  
Migrations: 有；two forward migrations apply extensions first and tables/custom constraints second; disposable-empty-database rollback/recreate was tested; production uses reviewed roll-forward and must not drop shared extensions  
Security: Negative database tests prove review rating and order subject checks plus listing owner referential integrity; fixtures use reserved UUIDs and `example.invalid`, run inside a rolled-back transaction  
Tests run: Prisma validate/generate passed; migration deploy from a new empty PostgreSQL 17/PostGIS 3.6.2 database passed twice with a drop/recreate between runs; migrate status was current; migration-to-schema diff was empty; `pnpm db:baseline:check` passed two extensions, three custom indexes, generated geography, and three negative cases; `pnpm ci:quality` passed on 2026-07-24  
Not run: Upgrade from a previous released schema belongs to DATA-004 because no previous release exists yet  
Observability: Baseline checker emits one structured summary without connection strings or fixture contents  
Docs: Added `packages/database/prisma/migrations/README.md`; updated CI and `CHANGELOG.md`  
Known gaps: The isolated PostgreSQL server was stopped, but deletion of `C:\Users\Administrator\AppData\Local\Temp\socal-data001-postgres17` was blocked by the execution policy; the directory contains only downloaded public binaries and disposable test data, no project or production data

## API-001 — HTTP 基础中间件与 Problem Details

Task: API-001 HTTP 基础中间件与 Problem Details  
Changed: API application factory, dynamic application module, CSRF origin guard, request validation, Problem Details filter, runtime config, OpenAPI/shared contracts, and API integration tests  
Contracts: OpenAPI now declares listing 400/403/413 responses and requires the six core Problem Details fields; shared Zod contract matches  
Migrations: 无  
Security: Request IDs are character/length constrained; unknown DTO/query fields fail closed; generic body limit defaults to 1 MiB; credentialed CORS is exact-origin; cookie-authenticated mutations require an approved Origin; errors omit stack/provider detail and query strings  
Tests run: API targeted suite passed 2 files/9 tests including eight HTTP injection cases; complete `pnpm ci:quality` passed 9 files/19 tests plus all typecheck/lint/build steps on 2026-07-24  
Not run: `bash scripts/check-architecture.sh` exited nonzero because Git Bash reaches only the unavailable Windows Store `python3` launcher; no pass claimed  
Observability: Every response returns the accepted or generated `X-Request-Id`; error envelopes carry the same request ID and disable caching  
Docs: Updated `docs/08-api-and-integrations.md`, runtime configuration, `.env.example`, OpenAPI, and `CHANGELOG.md`  
Known gaps: Auth/session token validation is owned by Gate 1; webhook signature/replay enforcement is owned by COM-002; endpoint-specific rate limits and upload limits are later tasks

## OBS-001 — 结构日志、基础指标和 OTel trace

Task: OBS-001 结构日志、基础指标和 OTel trace  
Changed: New `@socal/observability` workspace, API request hooks/logger/metrics, Worker job context and metrics, runtime configuration, container packaging, CI runtime check, and observability tests  
Contracts: Public OpenAPI and database schema unchanged; operational contracts add W3C `traceparent`, internal `/metrics`, and the documented `data.telemetry` job envelope  
Migrations: 无  
Security: Recursive sanitization blocks credential, OTP, cookie, token, email, phone, address, message, payload, query and payment-card patterns; HTTP query/body/headers and Worker payloads are never logged; provider errors are reduced to safe types/codes; metrics use bounded labels without resource or user identifiers  
Tests run: Observability/API/Worker targeted typechecks, lint and tests passed; full `pnpm ci:quality` passed 11 files/24 tests, nine workspace typechecks/lints and all builds on 2026-07-24; built API `pnpm observability:check` returned an accepted request ID, valid W3C trace and HTTP RED metrics  
Not run: `bash scripts/check-architecture.sh` was attempted and failed because `bash` is unavailable on this Windows PATH; no pass claimed; no external OTLP Collector was configured, so network export was not exercised  
Observability: JSON records carry service/environment/version and request/trace/span context; API exports RED counters/gauges/histograms; Worker exports job counters/durations; OTLP trace export is enabled only when configured  
Docs: Added `docs/observability-baseline.md`; linked it from `docs/17-observability-analytics.md` and `README.md`; updated runtime configuration, `.env.example`, Compose and `CHANGELOG.md`  
Known gaps: Collector deployment, production sampling, SLO dashboards and alerts belong to `OBS-002`; infrastructure must restrict `/metrics` to Collector/operations networks

## DATA-002 — PostGIS/trigram 扩展与地理类型 repository

Task: DATA-002 PostGIS/trigram 扩展与地理类型 repository  
Changed: `ListingGeoRepository`, bounded query validation, public nearby-listing projection, reference fallback SQL, unit/real-PostgreSQL integration tests, and CI database integration environment  
Contracts: OpenAPI unchanged; database read contract adds a typed radius query returning distance without coordinates/private addresses  
Migrations: 无；复用 DATA-001 已审查的 PostGIS/pg_trgm 扩展、生成 geography 列和 GiST/trigram 索引  
Security: All coordinates/radius/type/limit values are validated and parameter-bound; radius is capped at 250 miles and results at 100; query defensively requires published/current/moderation-approved records and active taxonomy; projection omits coordinates and exact address data  
Tests run: Unit suite passed seven query-boundary cases; real PostgreSQL 17.10/PostGIS 3.6.2 integration suite passed extension installation twice, trigram similarity, five-mile filtering, excluded draft/expired/deleted/far fixtures, and generated-geography update; full `pnpm ci:quality` passed 13 files/34 tests with `DATABASE_INTEGRATION_URL` set on 2026-07-24  
Not run: `bash scripts/check-architecture.sh` remains unavailable because `bash` is absent from the current Windows PATH; no pass claimed; PostgreSQL query-plan/load benchmarking belongs to later performance tasks  
Observability: No runtime logging added; integration tests emit only pass/fail metadata and never connection strings or fixture content  
Docs: Updated `docs/06-domain-and-data-model.md`, database SQL notes/reference query, CI workflow and `CHANGELOG.md`  
Known gaps: Exact-address storage/policy is not introduced by this task; callers must supply only policy-approved blurred public coordinates; generalized transaction-isolated repository harness is `DATA-006`

## DATA-003 — 种子与测试数据工厂

Task: DATA-003 种子与测试数据工厂  
Changed: Zod contracts/loaders for four seed files, deterministic UUIDv5 IDs, transactional Prisma seed, fictional test factories, seed policy, integration/unit tests, CI seed validation, and additive `REGION_GROUP` enum migration  
Contracts: OpenAPI unchanged; Prisma `RegionType` adds `REGION_GROUP` to represent `US-CA-SOCAL` without misclassification; seed command and JSON validation are documented operational contracts  
Migrations: 有；`20260725051500_region_group_type` is additive and forward-safe; application rollback can stop using the value, while physical enum removal requires a later reviewed data migration/enum replacement and is intentionally not attempted in-place  
Security: Seed command fails closed in staging/production before opening a database connection; identity uses `example.invalid`; five sample listings are prefixed `[示例]`, remain `DRAFT`/`NOT_REVIEWED`, and contain no ratings, ads, traffic or fabricated publication state  
Tests run: `pnpm db:seed:validate` passed all four versioned files; migration deploy and baseline checker passed three migrations; database↔schema and migrations↔schema diffs were empty; actual `pnpm db:seed` ran twice with stable 17 regions/58 categories/5 listings/1 user; real PostgreSQL idempotency test passed and cleaned fixtures; production seed command exited 1 before connection; full `pnpm ci:quality` passed 15 files/39 tests on 2026-07-24  
Not run: `bash scripts/check-architecture.sh` remains unavailable because `bash` is absent from this Windows PATH; no pass claimed; authoritative production GIS/content import belongs to `LAUNCH-001`  
Observability: Validation and seed commands emit bounded JSON summaries containing versions/counts only, without database URLs or content bodies  
Docs: Updated `seed/README.md`, migration operations notes, `docs/18-testing-quality.md`, CI and `CHANGELOG.md`  
Known gaps: Region centroids remain explicit development placeholders rather than verified GIS boundaries; taxonomy read APIs and aliases belong to `TAX-001`

## DATA-006 — Repository 集成测试框架

Task: DATA-006 Repository 集成测试框架  
Changed: Guarded integration database harness, transaction rollback wrapper, explicit non-skipping runner, isolation tests, and refactored Geo/Seed integration suites  
Contracts: OpenAPI/Prisma schema unchanged; test contract requires `DATABASE_INTEGRATION_URL` for explicit integration runs and one shared `TransactionClient` per test  
Migrations: 无  
Security: Connection guard defaults to loopback PostgreSQL and requires a database name marked test/baseline/integration/empty; remote ephemeral databases need explicit opt-in; connection strings are not logged; tests use only `example.invalid`/synthetic data  
Tests run: `pnpm db:test:integration` passed seven database files/19 tests on real PostgreSQL 17.10/PostGIS; missing URL command exited 1 instead of silently skipping; isolation test proved successful and intentionally failed callbacks both leave zero rows; full `pnpm ci:quality` passed 17 files/42 tests, all typechecks/lints/builds on 2026-07-24  
Not run: `bash scripts/check-architecture.sh` remains unavailable because `bash` is absent from this Windows PATH; no pass claimed; container-parallel and remote ephemeral database execution will be exercised by remote CI/infrastructure  
Observability: Test runner emits only Vitest/JUnit results; database target and fixture values are not serialized  
Docs: Added `docs/database-integration-testing.md`; updated testing strategy, README and `CHANGELOG.md`  
Known gaps: CI service execution is configured but no remote GitHub run/branch-protection evidence exists, so `FND-003` remains open; migration upgrade compatibility is `DATA-004`

## API-002 — OpenAPI serving/lint/schema test（实现完成，依赖未关闭）

Task: API-002 OpenAPI serving/lint/schema test  
Changed: Canonical OpenAPI loader and Swagger serving, Redocly configuration/root command, API contract tests, schema examples, runtime image packaging, and CI quality enforcement  
Contracts: `openapi/openapi.yaml` remains the single REST source; added examples to three existing response schemas without changing endpoint behavior; JSON and YAML views are served from the same document  
Migrations: 无  
Security: Contract examples contain no real PII or credentials; startup fails on invalid/non-3.1 YAML; implementation checks verify sanitized RFC 9457 responses rather than exposing framework errors  
Tests run: `pnpm --filter @socal/api typecheck`, `lint`, and 3 files/14 tests passed; `pnpm openapi:lint` exited 0 and validated the contract; examples and live health/400 responses passed dereferenced JSON Schema validation; built API runtime served canonical JSON/YAML  
Not run: Remote GitHub CI and protected-branch merge blocking cannot run because the repository has no remote and GitHub CLI is unauthenticated; full root quality run follows this entry; `bash scripts/check-architecture.sh` remains unavailable because `bash` is absent  
Observability: No new telemetry; API contract responses continue through the existing request/trace/RED instrumentation  
Docs: Updated API integration architecture, README, CI workflow, and `CHANGELOG.md`  
Known gaps: Software license metadata awaits owner/legal confirmation; task remains `todo` because required dependency `FND-003` cannot be closed without remote CI/branch-protection evidence

## API-003 — 契约生成方向与共享类型（实现完成，依赖未关闭）

Task: API-003 契约生成方向与共享类型  
Changed: Deterministic `openapi-typescript` generation/check commands, generated component/operation types, buildable `@socal/contracts`, OpenAPI-constrained Zod adapters, Nest schema pipe, and removal of duplicate request DTO decorators  
Contracts: Direction is OpenAPI → generated TypeScript → runtime Zod adapter; `CreateListingRequest` now explicitly rejects additional fields, constrains region code, and documents the existing empty media default  
Migrations: 无  
Security: Request validation remains fail-closed and reports field-addressable errors; generated public types contain no Prisma models; unknown fields and invalid nested coordinates are rejected before the service layer  
Tests run: Targeted contracts/API typechecks, lint and builds passed; Contracts 1 file/4 tests and API 3 files/14 tests passed; zero-warning OpenAPI lint and generated-file drift check passed; full `pnpm ci:quality` passed 18 files/48 tests, all nine workspace typechecks/lints, and seven builds with real PostgreSQL on 2026-07-24; built API runtime check passed  
Not run: Remote GitHub CI cannot run because no repository remote/authenticated GitHub session exists; `bash scripts/check-architecture.sh` remains unavailable because `bash` is absent  
Observability: No telemetry change; rejected requests continue through the existing Problem Details and RED instrumentation  
Docs: Documented the one-way generation policy in API architecture and updated `CHANGELOG.md`  
Known gaps: API-003 remains `todo` because its API-002 dependency cannot close before FND-003; future endpoints must add runtime adapters only when their implementation begins, not pre-generate handwritten DTO copies

## DATA-004 — 数据库迁移 CI 与兼容检查（实现完成，外部 CI 未验证）

Task: DATA-004 数据库迁移 CI 与兼容检查  
Changed: Destructive SQL analyzer/runner/tests, versioned previous-release compatibility manifest, disposable upgrade checker, root commands, and CI enforcement  
Contracts: OpenAPI/Prisma schema unchanged; migration review contract now requires explicit reason and rollback text for destructive exceptions  
Migrations: 无；all three existing migrations scan clean; upgrade test applies the two-migration `0.1.0-baseline`, preserves a synthetic region sentinel, then applies the additive taxonomy migration  
Security: Upgrade targets must be clearly disposable and local unless remote integration use is explicitly enabled; randomized database identifiers are regex-validated; no connection strings or row bodies are logged; temporary database is dropped in `finally`  
Tests run: Migration analyzer 3 unit tests passed; `pnpm db:migrate:safety` scanned 3 migrations with zero exceptions; real PostgreSQL upgrade check applied 2 prior + 1 current migration and preserved the sentinel; missing integration URL exited 1; full `pnpm ci:quality` passed 19 files/51 tests, all nine workspace typechecks/lints, and seven builds on 2026-07-24; CI workflow contract enforces 19 commands  
Not run: GitHub-hosted execution and branch-protection evidence are unavailable because no remote/authenticated GitHub session exists; `bash scripts/check-architecture.sh` remains unavailable because `bash` is absent  
Observability: Upgrade checker emits one bounded JSON event with migration counts/baseline label only  
Docs: Updated migration operations, data strategy, testing strategy, CI workflow, and `CHANGELOG.md`  
Known gaps: DATA-004 remains `todo` because FND-003 is not formally closed; the compatibility manifest must advance only with a promoted release, not on every migration

## FND-007 — 建立 Playwright E2E 基线（实现完成，容器依赖未关闭）

Task: FND-007 建立 Playwright E2E 基线  
Changed: Pinned Playwright dependency/configuration, desktop/mobile foundation specs, production standalone runtime preparation, Web mobile language-action fix, root E2E commands, typed/linted test inclusion, CI browser installation/report upload, and workflow contract enforcement  
Contracts: OpenAPI/Prisma schema unchanged; smoke verifies the canonical runtime OpenAPI still exposes 31 paths and invalid listing requests return sanitized Problem Details  
Migrations: 无  
Security: Tests use only fictional configuration and `example.invalid` database targets; Web/API bind to loopback-only isolated ports; validation errors are asserted not to expose stack traces; no credentials, PII, production data, or persistent service state is used  
Tests run: `pnpm install` rebuilt the lock under the existing minimum-release-age policy with Playwright 1.61.1 and no 1.62.0 residue; matching Chromium 149 installed; all nine workspace typechecks/lints passed; all seven builds passed; direct standalone Web readiness/homepage checks returned 200; final `pnpm test:e2e:ci` passed 4/4 tests across Desktop Chrome and Pixel 7 on 2026-07-24  
Not run: Docker-backed full-stack startup remains unavailable because this Windows environment has no Docker/compatible container engine; GitHub-hosted E2E execution is unavailable because the repository has no remote/authenticated session; `bash scripts/check-architecture.sh` remains unavailable because Bash is absent  
Observability: JUnit, HTML and failure-only trace/screenshot/video artifacts are written under `reports/e2e/` and uploaded by CI; the API smoke asserts bounded request correlation  
Docs: Updated `docs/18-testing-quality.md`, `README.md`, CI workflow and `CHANGELOG.md`  
Known gaps: Two intermediate reruns timed out because tool timeouts left Web child processes on port 3100; the exact test PIDs were removed, a fresh standalone server was verified, and the clean rerun passed. FND-007 remains `todo` because required dependency FND-005 cannot be formally closed until all four container images are built and health-checked on a real container engine

## FND-008 — 生成代码所有权与 PR 模板（本地实现完成，远程治理未配置）

Task: FND-008 生成代码所有权与 PR 模板  
Changed: Expanded CODEOWNERS path routing, security/migration/test-aware PR template, executable governance checker, CI/root-quality enforcement, and ownership operating instructions  
Contracts: OpenAPI/Prisma schema unchanged; repository governance contract now requires Backlog scope, contract/data impact, security/idempotency, actual/not-run verification, observability and known gaps  
Migrations: 无  
Security: Security/privacy, environment, infrastructure, database migration, payment and moderation paths require multiple role reviews; PRs explicitly attest object authorization, PII/upload abuse, idempotency/auditability and absence of secrets/real PII  
Tests run: `pnpm governance:check` validates all critical CODEOWNERS routes and PR requirements; CI workflow checker enforces the governance command; format, full quality and browser results are recorded in the surrounding Gate 0 entries  
Not run: GitHub owner/team resolution, required code-owner review and branch protection cannot run because the repository has no remote, organization/team mapping or authenticated GitHub session  
Observability: No runtime telemetry changed; PR template requires logging/metrics/traces/alerts impact to be recorded  
Docs: Updated `docs/25-team-operating-model.md`, `.github` policy files, CI workflow and `CHANGELOG.md`  
Known gaps: The personal private repository now maps every route to the real maintainer `@songjiahang676-cell`; split ownership into role teams and require independent code-owner approval when an organization/second maintainer exists. FND-008 remains `todo` until FND-003 remote governance evidence closes

## FND-001 — 安装后架构检查可重复性修复

Task: FND-001 锁定依赖并建立可重复安装（后续修复）  
Changed: Cross-platform Python runtime selection and source-tree scoping in `scripts/check-architecture.sh`; ignored local `.env` handling now verifies `.gitignore` instead of rejecting a bootstrapped workspace  
Contracts: No product API/schema/DB changes; architecture validation still covers canonical JSON/YAML/OpenAPI/Prisma/Backlog/Markdown and credential patterns while excluding dependency, build and report output  
Migrations: 无  
Security: Local `.env` content is never read or printed; the check fails if `.env` exists without an explicit ignore rule; `.env.example` and every other repository source remain in the credential scan  
Tests run: Initial real runs exposed unavailable `python3`, third-party JSON parsing after install, and unconditional `.env` rejection; all three were fixed. Final Git Bash run with isolated PyYAML 6.0.3/jsonschema 4.26.0 dependencies passed 100 tasks, 36 Prisma models, 31 OpenAPI paths, 52 schemas and 35 JSON files without a downgraded-check note  
Not run: None for the architecture script; CI still needs to execute the standard PATH-based command on Ubuntu as part of FND-003 remote evidence  
Observability: No runtime telemetry changed; the script reports bounded validation counts and explicit degraded-check notes only when optional validators are absent  
Docs: Updated `README.md`, CI limitations and `CHANGELOG.md`  
Known gaps: The Windows toolchain paths are machine-local and intentionally not committed; normal Linux/CI environments use `bash` and `python3` from PATH

## FND-003 — 建立 CI 质量流水线（实现完成，远程执行未验证）

Task: FND-003 建立 CI 质量流水线  
Changed: Read-only/concurrency-bounded GitHub Actions quality gate, PostgreSQL/Redis services, locked install, 22 enforced quality commands, migration/contract/unit/integration/build/E2E reports, four-image build job, workflow self-check and documented branch-protection policy  
Contracts: OpenAPI/Prisma schema unchanged; CI treats architecture, OpenAPI generation, migrations, governance and application builds as required contracts  
Migrations: 无；CI deploys the current migrations to an isolated PostGIS service, validates the baseline, and tests prior-release upgrade compatibility  
Security: Checkout credentials are not persisted; workflow permissions are read-only; test secrets are explicit CI-only values; images and repository tests do not receive production credentials; protected-branch policy requires code-owner review and prevents bypass by ordinary contributors  
Tests run: `pnpm ci:workflow:check` passed with 22 quality commands/four container targets; the same Windows workspace passed full `pnpm ci:quality` with 19 files/51 tests, all nine typechecks/lints and seven builds; architecture and Playwright smoke passed separately  
Not run: GitHub-hosted PR execution, failed-merge blocking and branch/ruleset inspection because this checkout has no remote and `gh` has no authenticated account  
Observability: Unit/coverage and Playwright reports upload on failure or success with 14-day retention; no production telemetry changed  
Docs: Updated `docs/16-infrastructure-devops.md`, `docs/18-testing-quality.md`, ownership guidance and `CHANGELOG.md`  
Known gaps: Repository owner must create/select the remote, map CODEOWNERS aliases, run one failing and one green PR, and require the two documented check names. FND-003 remains `todo` until that external evidence exists

## FND-003 — 首次托管 CI 差异修复

Task: FND-003 建立 CI 质量流水线（GitHub run 30185510707）  
Changed: Vitest now resolves `@socal/contracts` directly to source like the other internal packages; Playwright artifact upload warns rather than creating a second failure when an earlier step prevents report generation  
Contracts: OpenAPI/Prisma unchanged; test module resolution now works from a clean checkout without relying on stale local `dist` output  
Migrations: 无  
Security: No permission or runtime policy changes; GitHub token received only the additional `workflow` scope required to push the reviewed workflow file and remains in the OS keyring  
Tests run: Hosted architecture, locked install, governance, configuration, container contract, seed, OpenAPI, formatting, Prisma migration/deploy/upgrade/baseline, TypeScript and lint steps passed before the clean-checkout test failure exposed the missing alias  
Not run: Build, browser smoke and image build were skipped by the failed hosted test and will run on the corrected commit  
Observability: Existing unit reports uploaded successfully; missing downstream Playwright output no longer obscures the primary failure  
Docs: Updated `CHANGELOG.md` and this worklog  
Known gaps: Await corrected hosted run and container job

## ADR-0006 — 免费运营年与延后自动充值

Task: 产品基线补充（关联未来 `COM-006`）  
Changed: 公开上线后 12 个月全站免费；预留 `/v1/billing/auto-top-up-policy` 资源名和 Commerce 应用端口，但不提前开放路由  
Contracts: OpenAPI/Prisma 当前不变；`COM-006` 实现时必须先更新 OpenAPI、数据模型和契约测试  
Migrations: 无  
Security: 自动充值默认关闭且逐用户 opt-in；仅保存 provider reference；要求幂等、签名 webhook、限额、kill switch、通知、审计和对账  
Tests run: `scripts/check-architecture.sh` passed with full PyYAML/jsonschema validation（101 tasks、依赖无环、31 paths、52 schemas）；`pnpm format:check` passed  
Not run: 收费与自动充值实现/支付测试（依赖 Gate 5，按 Gate 纪律延后）  
Observability: 规定未来记录策略版本、触发窗口、订单/支付引用和失败分类，不记录卡数据  
Docs: Added ADR-0006；更新商业化文档、假设决策、实施顺序、Backlog、交付清单和 Changelog  
Known gaps: 正式上线时间、收费价格、支付条款、退款、税务和 provider 生产账号仍需在周年日前复核；周年日不会自动启用收费

## FND-005 — 首次托管容器构建差异修复

Task: FND-005 四应用容器与健康检查（GitHub run 30185679624）  
Changed: Build stage installs OpenSSL and supplies a fixed loopback-only Prisma datasource URL to generation/compilation；API runtime includes its contracts workspace；CI now starts all four images, verifies `node` user and waits for readiness；container contracts prevent regression  
Contracts: OpenAPI/Prisma unchanged；runtime configuration contract unchanged  
Migrations: 无  
Security: No secret enters the Docker context or image；the placeholder cannot address a remote database；runtime still fails fast without deployment-provided configuration  
Tests run: Hosted quality job passed locked install、architecture/contracts、migration/baseline/upgrade、typecheck、lint、51 tests、7 builds and 4 Playwright smoke cases；local `pnpm containers:check`、`pnpm ci:workflow:check`、`pnpm governance:check`、`pnpm format:check` and full `scripts/check-architecture.sh` passed after the fix  
Not run: Corrected hosted four-target build/runtime smoke awaits the next commit  
Observability: 无生产遥测变化；GitHub job logs retain the failed layer and corrected build evidence  
Docs: Updated `docs/local-containers.md`、`CHANGELOG.md` and this worklog  
Known gaps: Run 30185679624 failed before the first runtime target completed；all four corrected targets must build before FND-005 is done

## Gate 0 — 托管质量、镜像与运行态证据

Task: FND-005、FND-007（GitHub run 30186103447）；FND-003 外部治理证据  
Changed: PR #1 now runs the complete quality gate and builds/starts all four application images；Backlog marks FND-005/FND-007 done while FND-003 and its dependent tasks remain todo  
Contracts: OpenAPI remains 31 paths/52 schemas；Prisma remains 36 models/3 migrations；Backlog now has 101 tasks after COM-006 was added  
Migrations: 无新增；empty deploy、previous-release upgrade、baseline drift and destructive SQL safety all passed  
Security: Images run as `node`；runtime smoke uses only loopback ports and fictional configuration；no real secret/PII entered Actions；repository visibility was not changed  
Tests run: GitHub run `30186103447` passed architecture、frozen install、governance/config/container/seed/OpenAPI contracts、format、Prisma、migration deploy/safety/upgrade/baseline、9 typechecks、9 lints、19 files/51 tests、7 builds、4 Playwright smoke cases、4 image builds and 4 runtime readiness checks；local `pnpm ci:quality` passed the same source state with real PostgreSQL integration  
Not run: Enforced failed-merge check on `main` cannot be configured on this private repository under GitHub Free；branch protection and ruleset APIs both returned HTTP 403 requiring Pro or public visibility  
Observability: Unit/coverage and Playwright reports retained 14 days；container failure/startup logs surface only on bounded CI failure；no production telemetry changed  
Docs: Updated `README.md`、Gate status/checklist、infrastructure and team governance docs、`CHANGELOG.md` and this worklog  
Known gaps: FND-003 remains `todo`；FND-008、DATA-004、API-002 and API-003 remain formally blocked by that dependency despite their implementation checks passing；Gate 1 must not start until merge protection is resolved

## FND-003 — 公开仓库与强制合并保护完成

Task: FND-003 建立 CI 质量流水线；解除 FND-008、DATA-004、API-002、API-003 依赖阻塞  
Changed: With explicit owner authorization, changed `songjiahang676-cell/c4-local-life` from private to public；protected `main` with PR-only, strict required checks, conversation resolution, admin enforcement, and force-push/deletion denial  
Contracts: OpenAPI/Prisma unchanged；Backlog statuses move all 17 Gate 0 tasks to done  
Migrations: 无新增；existing empty deploy、upgrade compatibility、baseline and destructive SQL checks remain required  
Security: Visibility change was explicit；credential scan/ignored `.env` controls remained green；branch protection applies to administrators and binds both checks to the GitHub Actions app  
Tests run: PR #1/run `30186346943` passed both required jobs；temporary non-draft PR #2 intentionally added one broken internal link, run `30187032798` failed architecture validation, and GitHub reported `mergeStateStatus=BLOCKED`  
Not run: Independent approval/code-owner review requires a second maintainer and is intentionally not self-approved  
Observability: GitHub retains positive/negative check runs and closed PR #2 as audit evidence；temporary branch was deleted locally and remotely  
Docs: Updated `README.md`、Gate status/checklist、infrastructure/team governance docs、architecture book、`CHANGELOG.md` and this worklog  
Known gaps: PR #1 final head CI and protected merge remain before starting AUTH-001；no Gate 1 implementation has started early

## AUTH-001 — 会话模型、认证上下文与 Cookie

Task: AUTH-001 会话模型、认证上下文与 Cookie  
Changed: Added Prisma-backed session lifecycle Repository；256-bit opaque token + domain-separated HMAC；absolute/idle expiry and bounded touch；atomic rotation/revoke；Fastify auth context Guard；`GET/DELETE /v1/auth/session`；hardened host-only Cookie；database package runtime build boundary  
Contracts: OpenAPI remains 31 paths/52 schemas；documented current-session no-store and logout Set-Cookie headers；regenerated shared OpenAPI types；Prisma `AuthSession` adds required `idleExpiresAt`/`lastSeenAt` and index  
Migrations: 有，`20260726041310_auth_session_lifecycle`；empty deploy and previous-baseline upgrade passed；existing sessions intentionally idle-expire once；application rollback retains additive columns and requires reauthentication，不执行 down/drop  
Security: Raw session/IP never persisted or returned；Cookie is host-only、Secure、HttpOnly、SameSite=Lax、Path=/v1；duplicate/malformed Cookie rejected；foreign-origin logout blocked；absolute/idle expiry、suspended/deleted/profile-missing fail closed；response excludes email/phone/hash  
Tests run: `scripts/check-architecture.sh` passed（101 tasks、36 models、31 paths、52 schemas）；empty `socal_empty` replayed all 4 migrations and `db:baseline:check` passed；`db:upgrade:check` passed；`pnpm ci:quality` passed with 9 typechecks、9 lints、22 files/66 tests（including 4 real PostgreSQL auth repository tests）、8 builds；`pnpm observability:check` started the compiled API and passed；`pnpm test:e2e:ci` passed Chromium desktop/mobile 4/4  
Not run: Local Docker runtime smoke（Docker CLI unavailable）；hosted required-check/container jobs pending；OTP request/verify intentionally deferred to AUTH-002  
Observability: Existing correlated HTTP logs cover session endpoints without request headers/token/session hash/PII；no new high-cardinality session metric or token logging  
Docs: Updated security/API/runtime configuration/migration operations、README、status、changelog、architecture book and this worklog  
Known gaps: Hosted PR must prove clean Linux/container runtime；dual-key `SESSION_SECRET` rotation runbook and device/session listing remain later tasks；permissions stay empty until API-004

## AUTH-002 — 邮箱/手机 OTP 请求与验证

Task: AUTH-002 邮箱/手机 OTP 请求与验证

Changed: Added PostgreSQL `OtpChallengeRepository`、EMAIL/SMS request and verify controllers、provider-neutral delivery port、minimal sign-in registration/profile creation、AUTH-001 session issuance、strict contact/device validation and CORS support；new challenge supersedes the previous live challenge for the same destination/purpose

Contracts: OpenAPI remains 31 paths and grows from 52 to 53 schemas；`OtpAcceptedResponse` now returns the challenge UUID/expiry required by verify；both endpoints require `X-Device-Id`；generated contract types and Zod validators updated；Prisma grows from 36 to 37 models with `OtpChannel`/`OtpPurpose` enums

Migrations: 有，`20260726044453_otp_challenges`；additive enum/table/index/FK migration；all 5 migrations replayed from an explicitly recreated empty database and previous-baseline upgrade preserved the sentinel；application rollback disables routes and retains the table through its short retention window，不执行 down/drop

Security: Six-digit code uses `randomInt` and a dedicated domain-separated HMAC secret；raw code never enters DB、HTTP response or logs；destination/purpose、IP and device request limits are serialized with ordered PostgreSQL advisory transaction locks；verify is device-bound、single-use、five-attempt capped；unknown/expired/consumed/wrong/cross-device/unavailable subjects share one generic error；occupied contact verification produces a non-deliverable decoy；contact PII is private and short-lived

Tests run: First real PostgreSQL run exposed Prisma's inability to deserialize advisory-lock `void` and was fixed with an explicit text cast；first full quality run exposed CRLF formatting after the branch switch and was fixed with the repository formatter；final `pnpm ci:quality` passed 9 typechecks、9 lints、24 files/81 tests（including 5 real PostgreSQL OTP tests）and 8 builds；API targeted suite passed 33 tests；database integration passed 31 tests；empty deploy、`db:baseline:check`、`db:upgrade:check` and migration safety passed；`pnpm observability:check` passed；`pnpm test:e2e:ci` passed Chromium desktop/mobile 4/4

Not run: Local Docker runtime smoke（Docker CLI unavailable）；protected hosted Linux/container jobs pending；no real email/SMS provider credentials were supplied, so the default runtime adapter intentionally returns generic 503 while test adapters prove both channels

Observability: Existing bounded route/status RED metrics expose 202/400/429/503 outcomes；correlated structured logs do not include body、destination、code、IP、device ID or hashes；no high-cardinality identifier metric added

Docs: Updated API/security/retention/runtime configuration、migration operations、README、status、changelog、architecture book and this worklog

Known gaps: Production email/SMS adapter、durable delivery/retry/receipt belong to the notification/Outbox tasks after provider selection；24-hour physical purge/aggregation is scheduled under PRIV-001；profile/session-device management continues in AUTH-003

## AUTH-003 — 用户资料、会话设备与注销全部

Task: AUTH-003 用户资料、会话设备与注销全部

Changed: Added authenticated `AccountController`/`AccountService`、safe self-profile read/update、JSON Merge Patch parser、signed cursor active-session listing、user-scoped single-session revoke and revoke-all；extended the PostgreSQL identity repository and memory adapter；account-state changes now enforce session revocation at the database boundary

Contracts: OpenAPI grows from 31 to 34 paths and 53 to 58 schemas；added `GET/PATCH /me`、`GET/DELETE /me/sessions`、`DELETE /me/sessions/{sessionId}`、strong profile ETag/If-Match、generated TypeScript and Zod validation；Prisma remains 37 models and adds `UserProfile.version`

Migrations: 有，`20260728090000_account_management`；additive required profile version with reviewed constant-default exception plus `users.status/deleted_at` session-revocation trigger；all 6 migrations replayed on a newly recreated empty database，previous-baseline upgrade preserved the sentinel；rollback retains the additive column/trigger while the previous application ignores version

Security: Profile DTO excludes contact/trust fields and rejects unknown fields、control/bidirectional characters、arbitrary avatar URL and inactive region；strong ETag prevents lost updates；session cursor is domain-separated HMAC signed and user-bound；session read never returns token/token hash/IP hash；revoke query is scoped by actor user ID and unknown/foreign/already-revoked IDs share idempotent 204；current/all revoke clears the hardened Cookie；CSRF origin enforcement remains active；database trigger prevents later state workflows from bypassing revocation

Tests run: `pnpm ci:quality` with real PostgreSQL passed 9 typechecks、9 lints、26/26 test files、92/92 tests and 8 builds（79.60% statements、81.83% lines）；contract/API targeted suite passed 15 tests；database integration passed 10 files/33 tests；an explicitly recreated empty database deployed all 6 migrations and passed baseline checks；previous-baseline upgrade、migration safety、`pnpm observability:check` passed；`pnpm test:e2e:ci` passed Chromium desktop/mobile 4/4；initial runtime/E2E scale assertions correctly failed at the old path count and were updated to validate 34 paths/58 schemas

Not run: Local Docker runtime smoke（Docker CLI unavailable）；protected hosted Linux/container jobs pending

Observability: Existing bounded route/status RED metrics cover profile/session 200/204/400/401/403/409/422 outcomes；correlated structured logs omit bodies、profile text、session/token/IP hashes and cursor values；no high-cardinality identity metric added

Docs: Updated user journey、domain model、API/security/retention、migration operations、README、changelog、status、architecture book and this worklog

Known gaps: Avatar mutation waits for the Gate 1 quarantined media capability；session metadata physical purge remains PRIV-001；account deletion orchestration and Admin status UI remain their planned tasks；hosted PR must prove clean Linux and non-root images

## API-004 — Policy / Actor / RequestContext 框架

Task: API-004 Policy/Actor/RequestContext 框架

Changed: Added global `AuthorizationModule`、PII-minimized immutable per-request Actor/RequestContext、explicit action registry、fail-closed `PolicyService`、declarative `@RequirePolicy`/global Guard、owner-or-organization resource rule and reusable table-driven policy matrix helper；existing session/profile/device controllers declare self-service actions，Listing draft creation now requires `listing:draft:create`，and Session returns status-aware capability hints

Contracts: OpenAPI remains 34 paths/58 schemas and adds the missing 401 response for protected `POST /listings`；generated TypeScript was refreshed；Prisma remains 37 models；the existing free-form `Session.permissions` field contains five account self-service actions plus `listing:draft:create` only for ACTIVE users；LIMITED users do not receive the content-mutation capability；no client-supplied permission/owner/org field is trusted

Migrations: 无

Security: Unknown actions、duplicate registration、evaluator exceptions、suspended/deleted actors、missing/deleted resources、wrong roles and cross-organization IDs fail closed；RequestContext excludes display names、contacts、IP and tokens；HTTP maps only authentication-required to generic 401 and all other denial reasons to generic 403；Repository scoped queries remain mandatory before object-policy evaluation

Tests run: API targeted typecheck/lint and final 8 files/46 tests passed；reusable matrix covers guest、owner、organization Editor、Billing、cross-org、unrelated、limited、deleted and missing-resource cases；first full run correctly failed because optional `verificationBadges` was iterated without a fallback and was repaired；after protecting Listing create，old unauthenticated POST contract/E2E checks correctly changed from expected 400 to actual 401 and were moved to a public invalid-query 400 while dedicated write tests assert 401/403；contract test asserts Listing create declares both 401/403；`DATABASE_INTEGRATION_URL` forced 10 files/33 PostgreSQL tests；final `pnpm ci:quality` passed 9 typechecks、9 lints、27/27 files、99/99 tests and 8 builds；`scripts/check-architecture.sh` passed 101 tasks/37 models/34 paths/58 schemas；`pnpm observability:check` passed；final `pnpm test:e2e:ci` passed desktop/mobile 4/4

Not run: Local Docker runtime smoke（Docker CLI unavailable）；protected hosted Linux/container jobs pending

Observability: Existing correlated route/status logs cover generic 401/403 without Actor、resource context or internal deny reason；stable internal reason codes are bounded but not emitted as high-cardinality labels

Docs: Updated roles/permissions、API/integrations、security/privacy、README、changelog、architecture book、status and this worklog

Known gaps: Organization action/role matrix is intentionally next in ORG-001；platform/admin roles、step-up and two-person approval remain ADMIN-001/AUTH-005；authorization decision caching is intentionally absent until invalidation workflows exist

## ORG-001 — 组织与成员角色 / Policy

Task: ORG-001 组织与成员角色/Policy

Changed: Added Organizations API module、application service/store boundary and PostgreSQL `OrganizationRepository`；`POST /organizations` atomically creates Organization + initial OWNER and treats the globally unique slug as a payload-checked retry handle；member-scoped detail and OWNER/ADMIN member pagination use current database membership；registered explicit profile/listing/member/billing/analytics actions for OWNER/Admin/Editor/Billing/Analyst

Contracts: OpenAPI grows from 34 to 37 paths and 58 to 65 schemas with create/detail/member-list operations、Organization/Member DTOs、UUID parameter and generated TypeScript；strict Zod rejects INTERNAL organizations、over-posted status/verification/role、unsafe text/slug and offset pagination；Prisma remains 37 models because Organization/Membership were already in the baseline

Migrations: 无；existing baseline tables/enums/indexes are used，so rollback is application/contract revert only and no data-destructive step exists

Security: ACTIVE actor is rechecked inside the create transaction；Organization and initial OWNER are written atomically；same Owner + exact payload retry returns the resource while other payload/owner conflicts；object reads include actor membership in Repository queries；Policy replaces the request-start role with the current Repository role；member SQL additionally requires OWNER/ADMIN and returns only user UUID、display name、controlled avatar、role and joined time；cross-org/unknown IDs share generic 404；LIMITED and wrong-role actors receive generic 403；member cursor is domain-separated HMAC bound to actor + organization；client cannot create INTERNAL or set status/verification/role

Tests run: Contract targeted 3 files/10 tests passed；API targeted typecheck/lint and 9 files/52 tests passed；role matrix covers all five roles across profile read/edit/manage、listing write、member read/manage、billing manage and analytics read；HTTP abuse tests cover guest、LIMITED owner、wrong roles、cross-org/unknown IDs、INTERNAL/over-posting and cross-actor cursor replay；`DATABASE_INTEGRATION_URL` forced 11 files/36 real PostgreSQL tests for atomic Owner、exact retry/payload conflict、inactive actor、scope/pagination and analyst/outsider denial；first HTTP run correctly exposed an over-specific test expectation and was repaired to assert the existing generic 404；final `pnpm ci:quality` passed 9 typechecks、9 lints、30/30 files、111/111 tests and 8 builds（80.95% statements、83.25% lines）；post-checks correctly exposed stale 34-path/58-schema scale assertions in both observability and E2E validators, which were updated to the canonical 37 paths/65 schemas；final `pnpm.cmd observability:check` passed and `pnpm.cmd test:e2e:ci` passed Chromium desktop/mobile 4/4；the full architecture validator passed 101 tasks/37 models/37 paths/65 schemas after supplying PyYAML/jsonschema through a temporary Python path；the direct `pnpm` PowerShell shim was blocked by the host execution policy before running E2E, so all actual package commands use the equivalent `pnpm.cmd`

Not run: Local Docker runtime smoke（Docker CLI unavailable）；protected hosted Linux/container jobs pending

Observability: Existing correlated bounded route/status telemetry covers organization 201/200/400/401/403/404/409 without request bodies、member identity labels、cursor values or internal deny reasons

Docs: Updated product role implementation、domain model、API/integrations、security/privacy、OpenAPI/generated contracts、README、changelog、status、backlog、architecture book and this worklog

Known gaps: ORG-002 owns invitation、accept/revoke、role mutation、at-least-one-Owner concurrency during member changes and step-up Owner transfer；public business/provider profiles remain TRUST-001；generic Idempotency-Key storage remains API-005，while organization creation uses exact slug/payload retry semantics

## TAX-001 — 地区 / 分类读取、种子与别名

Task: TAX-001 地区/分类读取、种子与别名

Changed: Added `TaxonomyModule`、application store/service/controller and PostgreSQL `TaxonomyRepository`；public Region/Category endpoints return stable IDs/slugs、bilingual names、controlled original aliases and hierarchy trees，with parent/type/vertical/name/alias filters；versioned development seed now imports 17 regions/21 region aliases and 58 categories/15 category aliases with deterministic UUIDs

Contracts: OpenAPI remains 37 paths/46 operations and grows from 65 to 66 schemas with `TaxonomyAlias`；`RegionType` now matches Prisma/seed by including `REGION_GROUP`；Region/Category projections are strict recursive trees with nullable parent/centroid、active flag and aliases；generated TypeScript and strict Zod query adapters reject unknown fields、ambiguous booleans、malformed parent IDs/codes、overlong/control/bidi text and public `activeOnly=false`

Migrations: `20260728184415_taxonomy_aliases` additively creates `region_aliases` and `category_aliases` with lookup/uniqueness indexes and cascading canonical-parent FKs；roll forward deploys the migration before TAX-001 API/seed；application rollback redeploys the prior app while retaining harmless additive tables；migration-local `ROLLBACK.md` documents backed-up maintenance removal/rebuild if physical rollback is later required

Security: Anonymous taxonomy is hard-coded active-only；inactive/preview nodes cannot be disclosed with query flags；queries are bounded and parameterized，NFKC/ASCII-case/common-separator alias normalization rejects controls and bidi；normalized keys never leave the Repository；only original controlled aliases、public names and non-address region centroids are returned；hostile SQL-shaped queries return no broad match；seed aliases are FK/unique constrained and cannot create duplicate Region/Category nodes

Tests run: Contract targeted typecheck/lint and 2 taxonomy tests passed；API targeted typecheck/lint and 14 taxonomy/OpenAPI tests passed；real PostgreSQL taxonomy/seed targeted suite passed 2 files/4 tests；migration deploy applied all 7 migrations；baseline check verifies alias tables、cascade FKs and normalized uniqueness negative case；previous-release upgrade preserves its sentinel and both alias tables；actual seed ran twice with stable 17/21 Region rows/aliases、58/15 Category rows/aliases and 5 synthetic drafts；the first create-only migration attempt correctly failed because `.env` targeted an unavailable localhost:5432，then the explicit local integration URL generated and deployed it；the first recursive response contract test exposed Swagger full-dereference/Ajv recursion and was repaired to compile the canonical `$ref` document；security review removed anonymous inactive-data disclosure before final validation；final `pnpm ci:quality` passed 9 typechecks、9 lints、33/33 files、121/121 tests and 8 builds（82.22% statements、84.72% lines）；full architecture validation passed 101 tasks/39 models/37 paths/66 schemas/36 JSON；`pnpm.cmd observability:check` passed；`pnpm.cmd test:e2e:ci` passed Chromium desktop/mobile 4/4

Not run: Local Docker runtime smoke（Docker CLI unavailable）；protected hosted Linux/container jobs pending

Observability: Existing bounded route/status telemetry covers public taxonomy 200/400；no query text、alias value、normalized key or database error is added as a metric label or structured log field；responses use a five-minute public cache with stale-while-revalidate

Docs: Updated taxonomy、domain/data、API/integrations、security/privacy、seed、migration operations/rollback、OpenAPI/generated contracts、README、changelog、status、backlog、architecture book and this worklog

Known gaps: TAX-002 owns immutable dynamic form schema draft/preview/publish/rollback；production GIS boundaries、approved launch cities/categories、SEO allowlists and licensed taxonomy import provenance still require owner/operations input；search synonym/analyzer lifecycle remains SEARCH-001/004 and inactive taxonomy administration remains ADMIN work

## TAX-002 — 动态表单 schema 版本与发布

Task: TAX-002 动态表单 schema 版本与发布

Changed: Added strict dynamic-form Zod/JSON/OpenAPI contracts；`CategoryFormSchemaRepository` and Taxonomy application/store lifecycle implement optimistic draft、preview、atomic publish/materialization and append-only rollback；public Category form-schema read supports current or explicit published history with strong ETag；Listing now stores `formSchemaVersion`；versioned seed publishes schema version 1 for all 58 Categories and materializes 93 fields

Contracts: OpenAPI remains 37 paths/46 operations and grows from 66 to 70 schemas；`GET /categories/{categoryId}/form-schema` adds positive historical `version`、ETag/cache headers and complete strict field/policy shapes；generated TypeScript and Zod enforce 100-field/option bounds、bilingual text、unique key/options、select options、filterable type allowlist、private contact fields and safe regex；Prisma grows from 39 to 40 models with `CategoryFormSchemaVersion`、current-field metadata and required `Listing.formSchemaVersion`

Migrations: `20260728190935_category_form_schema_versions` additively creates version history/constraints/indexes/immutable trigger，adds conservative current-field columns and stamps existing Listings as version 1；empty/current deploy and previous-baseline upgrade passed；application rollback retains additive history/columns，physical rollback requires stopped writers and backup because dropping the Listing version severs old-draft provenance；migration-local `ROLLBACK.md` documents recovery

Security: Public read requires an active Category and a published row；draft/audit actors and inactive categories are never returned；published rows reject direct update/delete in PostgreSQL；Category row lock、expected current version and draft revision close lost-update races；rollback appends a new version with `basedOnVersion`；configuration rejects unknown/executable fields、unsafe regex backreferences/lookaround/nested quantifiers、unbounded strings/options and public/indexed PHONE/EMAIL；attributes reject unknown keys and validate against the Listing's exact published version

Tests run: `pnpm ci:quality` with real PostgreSQL passed 9 typechecks、9 lints、36/36 test files、131/131 tests and 8 builds（79.69% statements、82.37% lines）；database integration passed 13 files/42 tests，including draft revision conflict、atomic publish/current-field projection、rollback provenance、direct-adapter immutability and idempotent 58-version/93-field seed；all 8 migrations deployed，baseline checks include immutable trigger/one-draft index and 55000 negative case，previous-baseline upgrade preserved sentinel；OpenAPI lint/generation drift、migration safety and seed validation passed；architecture validation passed 101 tasks/40 models/37 paths/70 schemas/36 JSON；runtime observability check and Chromium desktop/mobile E2E passed 4/4

Not run: Local Docker runtime smoke（Docker CLI unavailable）；protected hosted Linux/container jobs pending

Observability: Existing bounded route/status telemetry covers public schema 200/400/404 without category/query/hash/audit actor metric labels；current responses use five-minute stale-while-revalidate，explicit immutable history uses one-year cache，ETag is content-only SHA-256 and contains no PII

Docs: Updated dynamic taxonomy、domain/data、API/integrations、security/privacy、seed、migration operations/rollback、OpenAPI/generated contracts、README、changelog、status、backlog、architecture book and this worklog

Known gaps: `ADMIN-001` must expose the existing management lifecycle behind SSO/MFA/RBAC rather than adding anonymous TAX writes；`LIST-001/002` must call exact-version attribute validation when real Listing persistence replaces the current skeleton；production category templates、moderation policy and search mappings still require owner/operations approval；hosted protected PR must prove clean Linux and non-root images

## MEDIA-001 — 上传 intent 与 quarantine

Task: MEDIA-001 上传 intent 与 quarantine

Changed: Added `MediaModule` with Controller → application service → store/object-storage ports；`POST /media/uploads` reserves owner-scoped upload metadata and returns a five-minute S3/MinIO PUT；`MediaAssetRepository` serializes exact idempotency and two quota layers with a PostgreSQL owner advisory transaction lock；AWS SigV4 adapter binds length、MIME、SHA-256 checksum/hash metadata and SSE；Compose adds an idempotent private MinIO quarantine bucket bootstrap

Contracts: OpenAPI remains 37 paths/46 operations/70 schemas，but `CreateUploadRequest` now requires lowercase SHA-256 and the operation declares authentication、validation、conflict、size、purpose、quota and storage failures；generated TypeScript and strict Zod reject traversal/control/bidi filenames、unknown fields、uppercase/malformed hashes and over-posted bucket/key；Prisma grows from 40 to 41 models with `MediaAsset` plus `MediaPurpose`

Migrations: `20260728201500_media_upload_intents` additively creates `media_assets`、purpose enum、owner FK、opaque-key/hash/size checks、owner-idempotency uniqueness and quota indexes；all 9 migrations deployed；application rollback disables the route and waits out five-minute URLs while retaining evidence；physical removal requires stopped writers、backup and quarantine object cleanup，documented in migration-local `ROLLBACK.md`

Security: Only ACTIVE sessions receive and pass `media:upload:create`；Cookie writes retain trusted-Origin enforcement；idempotency is bound to owner + canonical request hash and rejects comma-joined duplicate header values；the database lock prevents concurrent count/byte quota bypass；object keys contain random UUIDs and never filename/user ID；client cannot choose bucket/key；signed PUT requires declared content length/type/checksum/hash metadata/SSE；responses/errors are no-store and provider failures are sanitized；SVG/HTML/video are not accepted，and PDF/VERIFICATION fail closed until MEDIA-003 provides the restricted bucket/KMS/access boundary

Tests run: Targeted contracts passed 6 files/18 tests and API passed 13 files/68 tests；S3 unit verifies path-style SigV4 expiry and signed headers；HTTP abuse cases cover guest/LIMITED/cross-site、changed idempotency payload、unsafe hash/filename/unknown fields、purpose size、verification rejection、quota Retry-After and hidden provider failure；real PostgreSQL passed 14 files/46 tests including exact replay/conflict、inactive actor、database negative constraints and two simultaneous max-one reservations yielding exactly one success；migration deploy、safety、baseline (6 negative cases) and previous-release upgrade passed；final `pnpm ci:quality` passed 9 typechecks、9 lints、40/40 files、146/146 tests and 8 builds（80.61% statements、82.93% lines）；architecture passed 101 tasks/41 models/37 paths/70 schemas/36 JSON；observability runtime and Chromium desktop/mobile E2E passed 4/4

Not run: Local Docker/MinIO runtime PUT smoke，because this host has no Docker CLI；protected hosted Linux quality and four-image jobs pending

Observability: Existing correlated HTTP telemetry covers 201/400/401/403/409/413/422/429/503 with bounded method/route/status labels；request body、signed URL、object key、hash、filename、idempotency key and provider error are never added to logs or metric labels

Docs: Updated domain/data、roles/policy、API/integrations、security/privacy、runtime config、infrastructure/local containers、acceptance、migration operations/rollback、OpenAPI/generated contracts、README、changelog、status、backlog、architecture book and this worklog

Known gaps: MEDIA-002 owns completion/object HEAD、magic-byte/decoder/antivirus、scan queue、re-encode/EXIF removal、variants and READY/REJECTED binding；MEDIA-003 owns restricted verification bucket/KMS/approvals/retention；API-005 later generalizes idempotency storage；production Terraform bucket policy/IAM/lifecycle and a real MinIO/S3 PUT smoke remain required；the first full checks correctly exposed OpenAPI generated drift、a type-only lint issue and Prisma void lock deserialization，all repaired before the final passing runs

## ADMIN-001 — Admin shell、登录与 RBAC 导航

Task: ADMIN-001 Admin shell、登录、RBAC 导航

Changed: Replaced the Admin placeholder with an independent responsive bilingual shell、OTP sign-in/denied/error/empty states、same-origin allowlist BFF and server-generated workspace navigation；added `AdminModule`/`GET /admin/session`、current platform roles in Session/Actor、and auditable `PlatformRoleAssignment` persistence with expiry/revocation provenance；all workspaces remain inside the modular monolith

Contracts: OpenAPI grows from 37 to 38 paths、46 to 47 operations and 70 to 75 schemas；Session now requires server-derived `platformRoles`，and the new strict `AdminSessionResponse` returns only the safe operator projection、ordered roles、navigation and MFA gate；generated TypeScript updated；Prisma grows from 41 to 42 models with eight explicit `PlatformRole` values

Migrations: 有，`20260728203000_admin_platform_roles` additively creates the enum/table、three provenance FKs、object-scope/expiry/revocation checks、current-role uniqueness and lookup indexes；all 10 migrations deployed to local PostgreSQL，status/upgrade/baseline passed；rollback disables Admin and retains role history，with stopped-writer/export/drop steps documented only for exceptional physical removal

Security: ACTIVE + current unrevoked/unexpired platform role is required on every request；ordinary ACTIVE and role-bearing LIMITED users receive generic no-store 403，guest receives 401，and responses exclude email/phone/token/trust/scope；Admin BFF permits only auth/admin-session paths and sanitizes headers/upstream failures；Admin pages use noindex、no-store、no-referrer、frame denial、Permissions-Policy and per-request nonce CSP；the API sets `mfaRequired=true` and `privilegedActionsAllowed=false` so OTP sign-in cannot expose privileged data/actions before AUTH-005

Tests run: Initial targeted run exposed one ambiguous heading selector、type-only lint findings and a Nest sibling-module DI failure；the session-safe identity was moved into the global request accessor and all were repaired；API 14 files/71 tests and Admin 3 tests passed；migration safety、deploy/status、previous-release upgrade and baseline passed with 10 migrations and 9 database negative cases；real PostgreSQL integration passed 14 files/47 tests including role expiry/revocation next-request behavior；architecture passed 101 tasks/42 models/38 paths/75 schemas/36 JSON；`pnpm ci:quality` passed 9 typechecks、9 lints、41/41 files、152/152 tests and 8 builds；observability runtime passed；the first production Chromium run correctly found static prerendering prevented Next nonce injection and CSP blocked hydration，so Admin rendering was made dynamic without weakening CSP；final desktop/mobile E2E passed 6/6 and in-app browser inspection confirmed Chinese/English login、no overflow、no console errors、noindex and localized document language/title

Not run: Local Docker runtime image/Compose smoke，because this host has no Docker CLI；no real staff OTP was sent and no production staff account/role was created；protected hosted Linux quality and four-image jobs pending

Observability: Existing correlated bounded route/status telemetry covers Admin 200/401/403 without roles、scope、identity or internal denial reasons as labels；global `/v1/admin/*` response hook applies no-store even to errors；no privileged business data exists in this slice

Docs: Updated roles/permissions、domain/data、API/integrations、security/privacy、acceptance、Admin architecture、runtime configuration、migration operations/rollback、OpenAPI/generated contracts、README、SECURITY、changelog、status、backlog、architecture book and this worklog

Known gaps: AUTH-005 must add real Admin MFA/step-up/recent-auth and only then allow privileged reads/writes；role grant/revoke UI/API、scope enforcement per resource、immutable `AuditLog` writes、SSO、two-person approvals and real workspaces remain their planned tasks；bootstrap grants require a reviewed maintenance procedure；local Docker smoke and hosted protected checks remain

## AUTH-005 — 后台 MFA / step-up

Task: AUTH-005 后台 MFA/step-up

Changed: Added encrypted TOTP enrollment/activation/verification、one-time recovery codes、proof replay protection、failure lockouts、short MFA-elevated Admin sessions and recent-auth step-up；the Admin shell now presents bilingual accessible setup、recovery-code acknowledgement、verification and reauthentication states，while role navigation remains absent until MFA；added a Prisma-backed MFA Repository and a strict application store boundary

Contracts: OpenAPI grows from 38 to 41 paths、47 to 50 operations and 75 to 83 schemas with no-store enrollment/activation/verification resources；Admin session now exposes only bounded MFA state、authentication strength and server-computed privileged/sensitive flags；generated TypeScript and strict Zod validators updated；Prisma grows from 42 to 44 models with `MfaCredential`、`MfaRecoveryCode`、`AuthenticationStrength` and `MfaCredentialStatus`

Migrations: 有，`20260728221000_admin_mfa` additively creates credential/recovery storage and adds session authentication-strength/recent-MFA fields；all 11 migrations replayed on a newly created empty database，baseline checks passed 11 negative constraints and previous-release upgrade preserved its sentinel；application rollback disables MFA routes/Admin privileged actions and requires reauthentication while retaining additive evidence，and migration-local `ROLLBACK.md` documents exceptional stopped-writer physical rollback

Security: TOTP secrets use AES-256-GCM with a dedicated `MFA_SECRET`-derived key and version；recovery codes have 80 bits of entropy and only domain-separated HMAC hashes are stored；RFC 6238 verification allows one adjacent time step and atomically rejects replay；recovery codes are consumed once；five failures create a durable timed lock with generic errors and `Retry-After`；enrollment is actor/role-bound and idempotently returns only the same live pending secret；activation and every successful proof rotate/revoke the prior session；Admin absolute/idle/recent-auth windows default to 8h/30m/10m；same-origin CSRF、platform-role checks、no-store responses and minimized audit metadata apply throughout；secrets/codes are excluded from audit/logs

Tests run: RFC HOTP/TOTP vectors、encryption tamper and recovery-code tests passed；API abuse coverage proves enrollment retry stability、activation、session rotation、TOTP replay rejection、one-time recovery consumption、foreign-origin denial and lockout；real PostgreSQL passed 15 files/49 tests including role binding、atomic activation/proof/recovery and audit history；all 11 migrations deployed and status/baseline/upgrade/safety passed；the first production E2E start exposed the new Repository missing from the database runtime TypeScript include and was fixed before rerun；final `pnpm ci:quality` passed 9 typechecks、9 lints、44/44 test files、165/165 tests and 8 builds（77.69% statements、80.04% lines）；forced clean local builds passed；`pnpm observability:check` passed；`pnpm test:e2e:ci` passed Chromium desktop/mobile 6/6

Not run: Local Docker/Compose image smoke，because this host has no Docker CLI；no production staff identity/authenticator was enrolled；protected hosted Linux quality and four-image runtime jobs remain pending

Observability: Existing bounded route/status telemetry covers Admin MFA 200/201/400/401/403/409/429 without user、role、secret、code、session or provider values as labels；structured audit records contain action、actor、credential and non-sensitive method/step metadata only；no secret、recovery code、cookie or raw PII is logged

Docs: Updated roles/permissions、domain/data、API/integrations、security/privacy、acceptance、Admin architecture、runtime configuration、implementation sequence、migration operations/rollback、OpenAPI/generated contracts、README、SECURITY、changelog、status、backlog、architecture book and this worklog

Known gaps: Self-service MFA disable/reset and lost-device recovery are intentionally absent until an audited identity-recovery workflow can revoke all sessions；platform-role grant/revoke UI/API、resource scope enforcement、two-person approval、SSO and real privileged workspaces remain later tasks；`MFA_SECRET` rotation requires a dual-key operational migration before changing key version；local Docker smoke and protected hosted checks remain

## AUTH-004 — 密码与账户恢复（可选）

Task: AUTH-004 密码与账户恢复（可选）

Changed: Added optional password login and recovery through Controller → application service → store/repository boundaries；introduced NFC-normalized password policy、versioned scrypt verifier with dedicated pepper prehash、dummy verification for unknown/unusable accounts、identifier/IP/device throttles、persistent lockout、cooldown recovery、one-time proof consumption、all-session revocation and notification gateway ports；no controller imports or calls Prisma directly

Contracts: OpenAPI grows from 41 to 44 paths、50 to 53 operations and 83 to 88 schemas with strict no-store password login/recovery/recovery-confirm resources and required `X-Device-Id`；generated TypeScript and strict Zod contracts updated；Prisma grows from 44 to 46 models with password lifecycle fields on `User`、`PasswordAuthAttempt`、`PasswordRecoveryRequest` and `PasswordAuthAttemptOutcome`

Migrations: 有，`20260728223000_password_recovery` additively creates password attempt/recovery evidence and nullable password lifecycle fields；all 12 migrations replayed on a newly created empty database，baseline passed 13 negative constraints and previous-release upgrade preserved its sentinel；application rollback disables password routes and retains evidence，while migration-local `ROLLBACK.md` documents exceptional stopped-writer export/drop steps

Security: Passwords are NFC-normalized、15–128 Unicode code points、bounded to 512 UTF-8 bytes and screened against a built-in common-password denylist；a domain-separated HMAC-SHA256 pepper prehash feeds scrypt `N=2^17,r=8,p=1` with random salt；unknown/unusable accounts perform dummy KDF work and share generic 401 responses；login attempts are bound to identifier/IP/device with durable bounded lockout；recovery uses 256-bit random proofs stored only as hashes、cooldown/TTL/max-attempt/supersession controls and atomic one-time consumption；success changes the verifier、revokes every session、writes minimized audit evidence、sends a notification and never auto-signs in；tokens、passwords、pepper、full identifiers and raw provider errors are excluded from responses/logs

Tests run: Password crypto vectors/policy/tamper and contract tests passed；HTTP abuse coverage proves generic unknown/disabled/bad-password failures、device header enforcement、three-dimensional rate limiting、lockout、cooldown、unknown-account parity、one-time recovery、attempt exhaustion、supersession、session revocation and provider-unavailable behavior；real PostgreSQL passed 16 files/52 tests including serialized attempts、exact completion、hash-only recovery and atomic password/session/audit mutation；all 12 migrations deployed and status/baseline/upgrade/safety passed；final `pnpm ci:quality` passed 9 typechecks、9 lints、48/48 test files、179/179 tests and 8 builds（78.6% statements、80.96% lines）；forced clean local build passed；`pnpm observability:check` passed；`pnpm test:e2e:ci` passed Chromium desktop/mobile 6/6

Not run: Local Docker/Compose image smoke，because this host has no Docker CLI；no real email/SMS recovery message was sent because NOTIF-001/EVT-001 and production provider accounts are not implemented

Observability: Existing correlated bounded route/status telemetry covers password login/recovery 200/400/401/409/429 without identifier、IP、device、token、hash、pepper or provider values as metric labels；durable attempts and audit metadata use bounded outcome/action values；public recovery responses stay uniform when the notification provider is unavailable

Docs: Updated domain/data、API/integrations、security/privacy、acceptance、runtime configuration、implementation sequence、migration operations/rollback、OpenAPI/generated contracts、README、SECURITY、changelog、status、backlog、architecture book and this worklog

Known gaps: NOTIF-001 must replace the unavailable notification gateway with durable email/SMS dispatch before enabling recovery in production；the small built-in common-password denylist should be expanded to a reviewed compromised-password feed/service without leaking candidate passwords；self-service password enrollment/change UI and audited support recovery remain later slices；local Docker smoke remains unavailable，while PR #14 / final run `30402997906` passed hosted Linux quality and four-application non-root runtime checks and merged as `b4d9474`

## EVT-001 — Transactional Outbox dispatcher

Task: EVT-001 Transactional Outbox dispatcher

Changed: Added a PostgreSQL Outbox Repository with atomic `UPDATE … FROM (SELECT … FOR UPDATE SKIP LOCKED)` claims、attempt-versioned leases and stale-writer protection；added a Worker dispatcher、versioned BullMQ envelope、event-id job idempotency、bounded sequential batches、exponential retry with deterministic jitter、terminal failure handling、poll scheduling and graceful shutdown；wired the Worker to the database/config/observability packages and updated container/runtime contracts

Contracts: OpenAPI、generated HTTP contracts and Prisma models are unchanged；the database storage contract gains additive Outbox state constraints and a partial pending `(available_at,id)` claim index；the Worker runtime contract now requires `DATABASE_URL` and bounded Outbox/queue settings；the internal queue envelope is explicitly versioned and size-limited

Migrations: 有，`20260728234500_outbox_dispatcher_constraints` additively adds attempts/event-type/state-coherence checks and the partial pending-claim index；all 13 migrations replayed on the disposable `socal_evt001_empty` database，migration status、baseline and previous-release upgrade passed；migration-local `ROLLBACK.md` documents safe index/constraint removal while retaining Outbox rows

Security: Business state and events remain in one PostgreSQL transaction boundary；claim/publish/fail writes are conditioned on `id + attempts` to prevent an expired worker overwriting a newer lease；BullMQ uses `eventId` as the idempotency key and consumers remain responsible for durable event-id/version deduplication under at-least-once delivery；payloads are capped at 128 KiB by default and never emitted to logs/metrics，while stored errors are reduced to bounded codes；runtime secrets and raw provider errors remain excluded

Tests run: Repository integration covers concurrent disjoint claims、lease expiry/reclaim、stale completion rejection、retry scheduling、terminal failure and oldest pending age；Worker unit coverage verifies duplicate-safe publish、envelope bounds、retry/terminal classification、stale claims、poll failures and non-overlapping scheduling；database project passed 17 files/54 tests；all 13 migrations deployed，baseline passed 16 negative cases and previous-release upgrade preserved its sentinel；`pnpm ci:quality` passed 9 typechecks、9 lints、51 passed + 1 skipped test files、186 passed + 1 skipped tests and 8 builds（78.41% statements、80.8% lines）；clean Database/Worker builds、CI/container/runtime contracts、`pnpm observability:check`、architecture validation and Chromium desktop/mobile E2E 6/6 passed

Not run: The real BullMQ/Redis integration test was attempted locally and correctly failed with `ECONNREFUSED 127.0.0.1:6379` because this host has no running Redis，so the final local suite explicitly skipped only that test；local Docker/Compose image smoke was not run because this host has no Docker CLI；PR #15 / final run `30404864972` supplied a real Redis service，executed the integration test and passed the full hosted quality plus four-image non-root runtime checks before protected merge `490efa4`

Observability: Added bounded `socal_outbox_dispatch_total{outcome=published|retry|failed|stale}`、`socal_outbox_poll_failures_total` and `socal_outbox_oldest_pending_age_seconds` metrics；structured Worker events contain only event/aggregate identifiers、event type、attempt/outcome/duration and bounded error codes，never payload or raw provider details

Docs: Updated domain/data、system architecture、reliability、observability、acceptance criteria、reference implementation、runtime configuration、local containers、migration rollback、implementation sequence、README、SECURITY、changelog、status、backlog、architecture book and this worklog

Known gaps: EVT-002 must add DLQ inspection、controlled replay and canonical-data reconciliation；each future consumer must durably deduplicate `eventId` and reject stale aggregate versions；domain-specific producers/consumers and real notification/search/media jobs remain their planned slices；local Redis/Docker remain unavailable，while PR #15 / final run `30404864972` passed the equivalent hosted Redis and four-image checks and merged as `490efa4`

## MEDIA-002 — 媒体扫描、重编码与变体生命周期

Task: MEDIA-002 媒体扫描/重编码/变体生命周期

Changed: Added ACTIVE-owner `POST /media/{mediaId}/complete` through Controller → application service → store/repository boundaries；API closes the upload intent with server-trusted S3/MinIO HEAD metadata and atomically writes SCANNING + a versioned Outbox event；the existing Worker now consumes `media.upload.completed`，performs bounded object reads、exact byte/SHA-256 and JPEG/PNG/WebP magic-byte checks、ClamAV INSTREAM、Sharp decode/orientation/pixel-limit re-encoding，then writes deterministic THUMBNAIL/CARD/FULL WebP variants and atomically transitions READY/REJECTED；Compose adds a private processed bucket and versioned ClamAV service

Contracts: OpenAPI remains 44 paths/53 operations and grows from 88 to 89 schemas by defining the existing completion path response and all 400/401/403/404/409/422/503 outcomes；generated TypeScript exports `MediaProcessingResponse`；Prisma grows from 46 to 47 models with `MediaVariant`、variant kind enum and additive processing evidence/lifecycle fields on MediaAsset；the internal queue event is version 1 and lifecycleVersion-bound

Migrations: 有，`20260729003000_media_processing_lifecycle` additively adds eight MediaAsset evidence/lifecycle columns、`MediaVariantKind`、`media_variants`、state/dimension/hash/key/MIME constraints and a partial processing index；all 14 migrations replayed on the newly created empty `socal_media002_empty` database；baseline passed 19 negative cases and previous-baseline upgrade preserved its sentinel；application rollback stops completion/consumer and retains additive evidence/variants，while migration-local `ROLLBACK.md` documents exceptional stopped-writer export/drop steps

Security: Completion is ACTIVE/owner-scoped；cross-owner and unknown IDs share 404；object absence、expiry or metadata mismatch fail closed；provider failures become generic 503；API success is only SCANNING；Worker independently re-verifies actual bytes after HEAD to close replacement races，accepts no SVG/HTML/PDF/video，uses real ClamAV and bounded Sharp decoding，rejects damaged/multi-page/over-limit content，does not copy EXIF/ICC/original metadata，and writes only encrypted `image/webp` to server-derived keys；original and derivative buckets remain anonymous-none；database row locks + lifecycleVersion and `(asset,kind)` uniqueness make duplicates/late events no-op；stored rejection codes and metrics are bounded and exclude object key/hash/signature/provider details

Tests run: API project passed 18 files/89 tests including completion/replay、cross-owner 404、metadata mismatch and hidden storage failures；Worker passed 8 files/19 tests with two environment integrations explicitly skipped locally，covering real Sharp metadata stripping/orientation、ClamAV wire framing、hash/magic/malware rejection、transient retry、deterministic variants、S3 range/SSE/immutable headers and duplicate/stale delivery；Database passed 17 files/57 real PostgreSQL tests including atomic completion/Outbox、expiry/mismatch、exact three-variant enforcement and duplicate finalization；empty deploy、baseline、upgrade、migration safety、Prisma/OpenAPI/config/CI/container contracts、typecheck and lint passed；the first database run correctly exposed an invalid legacy REJECTED fixture and an over-escaped WebP key regex，both repaired and revalidated from an untouched empty database；the first complete quality run correctly found formatting drift，then the second passed all pre-build checks and 55 files/203 tests（2 service integrations skipped locally，78.21% statements/80.73% lines）before the Admin standalone copy failed with Windows `EPERM`；PR #16 / run `30406971001` passed 57 files/205 tests including real Redis and ClamAV clean/EICAR integrations，all Linux production builds、API runtime、Chromium desktop/mobile and four non-root runtime images

Not run: Local real Redis/ClamAV/MinIO lifecycle and Docker image smoke，because this host has no running services/Docker CLI；the host process has Windows medium integrity and cannot create directory symlinks，so two clean Admin builds compiled、typechecked and generated every static page but failed only while assembling `.next/standalone`；local Chromium E2E therefore cannot use a complete Admin standalone；PR #16 / run `30406971001` supplied real Redis + ClamAV clean/EICAR integration and passed complete Linux build/E2E plus four non-root image smoke

Observability: Added bounded `socal_media_processing_total{outcome=ready|rejected|stale}` and connected every media terminal/stale result；generic Worker job counts/duration expose retry failures；no mediaId、object key、hash、MIME、ClamAV signature、rejection code、payload or provider error becomes a metric label or structured-log payload

Docs: Updated media data model、system/event flow、API/integrations、security/privacy、reliability、infrastructure、observability、acceptance、reference implementation、runtime configuration、local containers、OpenAPI/generated contracts、README、SECURITY、changelog、status、backlog、architecture book and this worklog

Known gaps: Listing media binding/READY authorization belongs to LIST-002/004；quarantine/derivative deletion、lifecycle reconciliation and production no-cookie CDN/Terraform IAM remain release/infrastructure work；restricted verification documents remain MEDIA-003；only JPEG/PNG/WebP are enabled；animated/multi-page content is intentionally rejected；local dependency services and Windows symlink privilege remain unavailable，while PR #16 / run `30406971001` passed the equivalent protected Redis/ClamAV、Linux build/E2E and four-image checks

## LIST-001 — Listing 领域状态机与不变式

Task: LIST-001 Listing 领域状态机与不变式

Changed: Added a pure TypeScript Listing aggregate and transition boundary independent of NestJS and Prisma；five discriminated detail variants enforce exact `type` matching and bounded type-specific values；integer-minor-unit USD price rules distinguish fixed units from `FREE/NEGOTIABLE`；separate content/moderation states cover submit、auto/moderator approval、escalation、rejection、suspension、expiry、archive and one-time soft deletion；every mutation requires expected version、monotonic UTC time、actor and stable reason code and returns immutable before/after evidence

Contracts: Public OpenAPI、generated HTTP contracts、JSON Schemas、Prisma Schema and database storage are unchanged；the new boundary is an internal application-domain contract for LIST-002/003

Migrations: 无；all existing 14 migrations remain current and replay behavior is unchanged，so no rollback/roll-forward database action is required；code rollback removes the isolated domain module and its tests before later consumers depend on it

Security: Invalid reconstructed snapshots fail closed；type/detail mismatch、invalid money、unreviewed publication、early expiry、stale version、time regression、unsafe reason code and illegal state transitions are rejected with stable non-sensitive codes；the domain does not authorize actors or expose PII and later use cases must combine it with Policy/Repository transaction checks；no raw detail or price is logged

Tests run: API targeted typecheck、lint and 19 files/97 tests passed，including 8 new Listing test groups；`scripts/check-architecture.sh` passed 101 tasks/47 models/44 paths/89 schemas；observability runtime、format、Prisma validate、9 workspace typechecks、9 lints and the initial 44 files/171 tests passed；migration status confirmed all 14 migrations current and dedicated PostgreSQL integration passed 17 files/57 tests；final `pnpm ci:quality` passed workflow/governance/config/container/seed/migration/OpenAPI checks、Prisma generate、9 typechecks、9 lints、56 files/211 tests and 8 production builds with 78.55% statements/81.10% lines；standalone preparation and Chromium desktop/mobile E2E passed 6/6；PR #17 / run `30408426707` passed the equivalent protected real-service tests、Linux production build/runtime、Chromium and four non-root image checks

Not run: Real Redis and ClamAV integrations were explicitly skipped locally because those services are unavailable and LIST-001 does not consume either；local Docker image smoke was not run because the host has no Docker CLI；PR #17 / run `30408426707` supplied those services and passed the protected Linux and four-image runtime checks

Observability: No new runtime metric or log was added for this pure domain slice；each successful transition returns bounded actor/reason/status/version evidence for the later audited application/Outbox transaction，while rejected operations expose only stable error codes

Docs: Updated domain/data、moderation workflow、testing matrix、reference implementation、Gate checklist/status、Backlog、README、changelog、architecture book and this worklog；documented that G1/P1 ORG-002 waits for explicit G2 NOTIF-001 and G4 MEDIA-003 owns restricted verification files

Known gaps: LIST-002 must map Prisma records into this aggregate and implement owner/public/moderator safe projections；LIST-003 must run transitions with row/version predicates and atomically persist audit/Outbox evidence；dynamic form exact-version validation、media READY binding、authorization and RFC 9457 HTTP mapping remain later slices；publication lifetime and reason-code catalogs require operations/legal policy rather than being hard-coded here；protected merge is pending

## LIST-002 — Listing repository 与安全投影

Task: LIST-002 Listing repository 与安全投影

Changed: Added a PostgreSQL-backed `ListingRepository` with separate typed public、owner and moderator reads；each path uses an explicit Prisma select and maps to a purpose-built projection rather than serializing a database model；public queries fail closed across content/moderation/publish/expiry/delete、taxonomy and publishing-principal state；owner queries bind direct ownership or current organization membership to the actor；moderator reads require a current unrevoked/unexpired MODERATOR or SENIOR_MODERATOR grant and matching region/category scope；all dynamic attributes are projected through the Listing's exact published form-schema version and unknown/malformed fields never escape

Contracts: Public OpenAPI、generated HTTP contracts and JSON Schemas are unchanged；the new package exports are internal database/application contracts for LIST-003；public projections omit exact coordinates、contact mode、moderation/internal IDs and quality score；owner projections add owned management state and exact point but not moderator-only attributes or internal score；moderator projections add bounded internal state and all schema-authorized attributes but still omit raw account contact data、organization legal name and exact point

Migrations: 无；Prisma Schema and all existing 14 migrations are unchanged，so no database rollback/roll-forward action is required；code rollback removes the repository export/implementation/tests before LIST-003 consumes it

Security: Query-bound object authorization covers direct owner、current organization member and current scoped moderator；inactive/suspended actors、wrong/malformed/out-of-scope/revoked/expired roles and unknown resources fail closed；public visibility requires approved current content with active taxonomy and publishing principal；three explicit selects never retrieve user email/phone、organization legal name、token/IP or verification documents；exact historical visibility filtering returns an empty object when schema evidence is absent or malformed and drops injected unknown keys；fixtures serialize every projection to assert private values and precise coordinates do not leak；later Controllers must still combine this boundary with API-004 Policy and generic 404 mapping

Tests run: `pnpm --filter @socal/database typecheck` passed；database lint passed；targeted real PostgreSQL run passed 18 files / 61 tests including four new projection groups；`pnpm ci:quality` passed workflow/governance/runtime/container/seed/migration/OpenAPI/format/Prisma checks、9 workspace typechecks、9 lints、57 files / 215 tests with 2 explicit environment skips、8 production builds and 78.68% statements / 81.40% lines；API observability runtime passed；standalone Chromium desktop/mobile E2E passed 6/6；`scripts/check-architecture.sh` passed 101 tasks / 47 Prisma models / 44 OpenAPI paths / 89 schemas / 36 JSON files；PR #18 / run `30409724740` passed the protected real-service Linux quality、runtime/E2E and four non-root image checks

Not run: Real Redis and ClamAV integrations were skipped locally because those services are unavailable and LIST-002 does not consume either；local Docker image smoke is unavailable because the host has no Docker CLI；PR #18 / run `30409724740` supplied the equivalent real services and passed Linux quality、E2E and all four non-root runtime images

Observability: No new runtime log or metric is added for this read-only Repository slice；queries return only bounded typed data or null and do not log actor、Listing、attributes、PII or authorization scope；HTTP request outcome metrics remain a LIST-003 concern

Docs: Updated domain/data、API projection、security/privacy、testing matrix、reference implementation、Gate checklist/status、Backlog、README、changelog、architecture book and this worklog

Known gaps: LIST-003 must connect these projections to authenticated HTTP use cases、RFC 9457/generic 404 behavior、ETag/version writes and atomic domain/audit/Outbox transactions；LIST-004 owns READY media binding and dynamic form upload UX；moderation case snapshots/rule hits remain MOD-001；public list pagination/search/media DTOs are later planned slices；final head checks and protected merge are pending

## LIST-003 — 草稿创建、读取、更新与并发控制

Task: LIST-003 草稿创建/读取/更新/并发控制

Changed: Replaced the process-local Listing example with Controller → application service → store/repository boundaries；added database-backed personal/organization draft creation、owner-safe detail and strict merge-patch update；creation uses canonical request hashing、actor-scoped exact retry and a transaction advisory lock；updates require strong Listing ETags、row locking and a version predicate；both writes append minimized AuditLog and versioned Outbox evidence atomically；organization Listings require current membership and never retain a creator bypass；public collection remains intentionally empty until LIST-005 rather than returning draft or fabricated data

Contracts: OpenAPI remains 44 paths / 53 operations and grows from 89 to 98 schemas with explicit public/owner Listing views and response wrappers；POST returns 201 + Location + strong ETag + no-store，GET returns owner/private or approved public projection，PATCH requires strong If-Match and returns current ETag on 409；shared Zod adapters enforce strict/unsafe-text-free DTOs、bounded JSON/media lists、fixed-vs-free money and non-empty patches；Prisma remains 47 models and adds nullable paired create idempotency/hash evidence plus owner/key uniqueness

Migrations: 有，`20260729010000_listing_draft_idempotency`；all 15 migrations replayed on the newly created disposable `socal_list003_empty` database；the first baseline negative correctly exposed SQL CHECK three-valued logic allowing a lone key，so the unreleased migration was corrected to require both non-null fields and revalidated from a fresh database；baseline now passes 22 negative cases and previous-baseline upgrade preserves its sentinel；application rollback disables draft routes while retaining additive evidence，and migration-local `ROLLBACK.md` documents exceptional stopped-writer physical removal

Security: Create/update require ACTIVE server-derived actors；personal drafts bind owner and organization drafts bind current OWNER/ADMIN/EDITOR for writes while all current roles may read；guest/outsider unpublished reads return generic 404 and BILLING/ANALYST writes return generic 403；removing the creator membership removes access；exact historical category schema validation rejects unknown attributes；media IDs fail closed until LIST-004 binding；strong ETag prevents lost updates；idempotency evidence stores no body；explicit projections omit hashes、keys、email/phone、legal name、moderator fields and internal scores；Audit/Outbox payloads omit title、body、attributes、coordinates and contact data

Tests run: `pnpm ci:quality` passed workflow/governance/config/container/seed/migration/OpenAPI/format/Prisma checks、9 workspace typechecks、9 lints、61 files / 226 tests with 2 explicit service skips、8 production builds and 79.20% statements / 82.09% lines；real PostgreSQL integration passed 19 files / 64 tests including exact retry、changed-payload conflict、organization roles、removed membership、concurrent same-key create and concurrent version update；fresh deploy、migration status、baseline 22 negatives、upgrade compatibility and migration safety passed；OpenAPI runtime response validation、API observability runtime and Chromium desktop/mobile E2E passed 6/6；architecture check passed 101 tasks / 47 Prisma models / 44 OpenAPI paths / 98 schemas / 36 JSON files

Not run: Local Redis/ClamAV service integrations were explicitly skipped because those services are unavailable and LIST-003 neither publishes nor consumes them；local Docker image smoke is unavailable because this host has no Docker CLI；PR #19 / run `30412033239` supplied real Redis/ClamAV services and passed the Linux quality、browser and four-image non-root runtime checks

Observability: Existing bounded HTTP RED metrics/traces cover the three endpoints；successful writes add queryable `listing.draft.created|updated` Audit and Outbox evidence with actor、Listing、type/status/version/requestId only；no request body、idempotency key/hash、PII or dynamic attributes enter structured logs or metric labels；no new high-cardinality metric was added

Docs: Updated domain/data、write architecture、API projection/concurrency、security/privacy、testing matrix、acceptance boundaries、reference implementation、migration recovery、Gate checklist/status、Backlog、README、SECURITY、changelog、architecture book and this worklog

Known gaps: LIST-004 owns bilingual/mobile autosave UX and READY media binding；LIST-005 owns public cursor listing；LIST-006/007 and MOD tasks own submit/review/publish/delete/expiry；moderator HTTP views remain internal until their planned slice；the evidence commit still requires final protected head checks and merge

## LIST-004 — Rental 动态发布表单与自动保存

Task: LIST-004 Rental 动态发布表单与自动保存

Changed: Added the canonical `/{locale}/post/rental/new` page and a bilingual responsive dynamic form driven only by the published Rental schema；implemented 900ms debounced serialized autosave with a stable create idempotency key、strong ETag update、explicit 409 recovery and online retry；added strict user + locale scoped local recovery、field summary/focus/live status and JPEG/PNG/WebP upload progress/complete/status polling/retry/removal；added a method/path allowlisted same-origin Web BFF；added owner-safe media status API/store/repository boundaries；Listing create/update now atomically binds ordered READY media and owner projections include `mediaIds`

Contracts: OpenAPI grows from 44 to 45 paths、53 to 54 operations and 98 to 99 schemas with owner-scoped no-store `GET /media/{mediaId}` and `MediaStatusResponse`；create/update/owner Listing media arrays are unique and bounded to 20；generated TypeScript and strict Zod contracts updated；Prisma remains 47 models and additively relates `MediaAsset.listingId/sortOrder` to Listing

Migrations: 有，`20260729020000_listing_media_binding` additively adds nullable Listing binding、constant-default stable ordering、SET NULL foreign key、binding check and lookup index；all 16 migrations replayed from the newly created disposable `socal_list004_empty` database；baseline passes 23 negative constraints and previous-baseline upgrade preserves its sentinel；application rollback disables media selection while retaining additive binding evidence，and migration-local `ROLLBACK.md` documents exceptional stopped-writer export/drop/replay steps

Security: The Web BFF fails closed on method + strict UUID path allowlists and cannot proxy Admin、DELETE or arbitrary upstream resources；local recovery is bounded to 250KB、shape/enum/length validated and partitioned by server-derived user + locale；media status excludes bucket/key/hash/URL/provider details and unknown、deleted、foreign assets share generic 404；Repository locks candidate UUIDs in deterministic order and accepts only `LISTING_MEDIA + IMAGE + READY` owned by the actor or already attached to the same authorized organization Listing；database constraints prevent unready/wrong-purpose binding and failed validation commits neither a Listing nor a version change；original media remains private and client removal only unbinds

Tests run: Fresh PostgreSQL deploy/status/Prisma validate passed all 16 migrations；migration safety passed 9 documented exceptions；baseline passed 23 negative cases and upgrade preserved its sentinel；database suite passed 19 files / 65 tests including ordered owner READY bind、unready/foreign rejection、rollback and unbind；contracts passed 7 files / 23 tests、API passed 20 files / 106 tests and Web passed 3 files / 6 tests；root `pnpm ci:quality` passed workflow/governance/config/container/seed/migration/OpenAPI/format/Prisma checks、9 workspace typechecks、9 lints、61 files / 235 tests with 2 explicit service skips、8 production builds and 71.85% statements / 74.84% lines；production standalone Chromium desktop/mobile passed 8/8 including bilingual autosave recovery and mobile overflow；architecture check passed 101 tasks / 47 Prisma models / 45 OpenAPI paths / 99 schemas / 36 JSON files；PR #20 / run `30414690267` passed the protected real-service Linux quality、runtime/E2E and four non-root image checks

Not run: Local Redis and ClamAV integration tests were explicitly skipped because neither service is available on this host and LIST-004 does not publish or consume queue jobs；local Docker image smoke was not run because this host has no Docker CLI；PR #20 / run `30414690267` supplied real Redis/ClamAV and passed Linux quality、browser and four-image non-root runtime checks

Observability: Existing bounded HTTP RED metrics/traces cover media status and Listing writes；the form exposes user-facing saving/offline/conflict/upload/scanning/rejected states through a polite live region；no draft body、attributes、local snapshot、file bytes、hash、object key、presigned URL、idempotency key or actor identifier enters metric labels or new logs；no new high-cardinality metric was added

Docs: Updated data model、API/upload contract、UX/autosave behavior、security/privacy、testing matrix、acceptance boundaries、reference implementation、migration recovery、Gate checklist/status、Backlog、README、SECURITY、changelog、generated architecture book and this worklog

Known gaps: LIST-005 owns public cursor listing；LIST-006/007 and MOD tasks own submit/review/publish/delete/expiry；public media variant delivery remains a later detail/list slice；media object deletion remains a dedicated audited workflow；real Redis/ClamAV and non-root images await protected Linux checks；the evidence commit and protected merge remain pending

## MOD-001 — 提交风险规则与审核案件

Task: MOD-001 提交风险规则与审核案件

Changed: Added pure deterministic `listing-submission` v1 rules for account age、historical category policy、missing lifetime、external contact and external-payment requests；implemented ACTIVE owner/current organization writer submission with strong ETag and actor-scoped idempotency；low risk transitions DRAFT→SUBMITTED→PUBLISHED/AUTO_APPROVED with the historical lifetime，medium risk creates a normal PENDING_REVIEW case，and high risk transitions through ESCALATED with a priority case；added a dedicated database repository that rechecks actor/object/state/version under locks and atomically writes state、immutable evaluation/hits、case、Audit and per-transition Outbox

Contracts: OpenAPI remains 45 paths / 54 operations and grows from 99 to 100 schemas with strict `ListingSubmissionResponse`；`POST /listings/{listingId}/submit` now requires `If-Match` + `Idempotency-Key` and declares 202/no-store/ETag plus 400/401/403/404/409/422 Problem Details；generated TypeScript and API runtime contract tests updated；Prisma grows from 47 to 49 models with `ModerationEvaluation`、`ModerationRuleHit` and `ModerationRiskTier`

Migrations: 有，`20260729130000_listing_submission_moderation` additively creates evaluation/hit tables、tier enum、case relation、unique/check/index/FK controls and UPDATE/DELETE rejection triggers；all 17 migrations applied to the disposable local database；baseline passes 27 negative cases and previous-release upgrade preserves its sentinel；application rollback disables submit writes while retaining evidence，and migration-local `ROLLBACK.md` documents exceptional pre-production physical removal

Security: Submit requires ACTIVE actor permission and owner or current organization OWNER/ADMIN/EDITOR object policy；repository repeats authorization after actor/idempotency and Listing row locks；strong ETag prevents stale-risk evaluation，actor/key advisory locking and unique evidence make exact retries single-write；outsider returns generic 404，guest 401 and restricted account 403；rule hits store only code/version/severity/evidence field name，while raw matches、thresholds、body、attributes、contact data、idempotency key and request hash stay out of public responses/log labels/Audit/Outbox；database result checks bind LOW/MEDIUM/HIGH to valid lifecycle states and immutable triggers prevent evidence rewriting

Tests run: Root `pnpm ci:quality` passed workflow/governance/config/container/seed/migration/OpenAPI/format/Prisma checks、9 workspace typechecks、9 lints、63 files / 243 tests with 2 explicit service skips、8 production builds and 72.26% statements / 75.37% lines；API passed 21 files / 112 tests；real PostgreSQL passed 20 files / 67 tests including exact retry/conflict、low/high outcomes、case priority、minimal hits、Audit/Outbox atomicity and immutability；deploy、migration status、baseline 27 negatives、upgrade compatibility and migration safety passed；API observability runtime and production Chromium desktop/mobile passed 8/8；architecture check passed 101 tasks / 49 Prisma models / 45 OpenAPI paths / 100 schemas / 36 JSON files；PR #21 / runs `30416761469` and `30417062067` passed protected real-service Linux quality、runtime/E2E and four non-root image checks，then squash-merged as `d9f632d`

Not run: Local Redis and ClamAV integrations were explicitly skipped because neither service is available and MOD-001 only appends PostgreSQL Outbox records；local Docker image smoke was not run because this host has no Docker CLI；PR #21 / run `30416761469` supplied the real services and passed Linux quality、browser and four-image non-root runtime checks

Observability: Existing bounded HTTP RED metrics/traces cover submission；successful transactions append queryable `listing.submission.evaluated` Audit plus `listing.submitted|published|moderation.escalated` Outbox with stable rule/case/version fields；no content or identifier enters metric labels and no new high-cardinality metric was added

Docs: Updated moderation workflow、data model、API contract、security/privacy、testing matrix、acceptance boundaries、reference implementation、migration recovery、Gate checklist/status、Backlog、README、SECURITY、changelog、generated architecture book and this worklog

Known gaps: ADMIN-002 owns moderator queue/snapshot/diff/actions and is the next dependency-ordered slice；LIST-005 owns public cursor list/detail/expiry and depends on ADMIN-002；notifications、reports/appeals、sampling/dry-run metrics and operator-approved production thresholds remain later tasks；MOD-001 protected-head checks and merge are complete

## ADMIN-002 — Listing 审核工作台

Task: ADMIN-002 Listing 审核工作台

Changed: Added the bilingual responsive Admin Listing moderation workspace with priority/SLA queue、immutable submission snapshot、first-submission diff、versioned rule evidence、safe media/publisher context、strict reasons and keyboard navigation/action shortcuts；implemented Admin BFF method/path allowlisting and upstream header filtering；added Controller → application service → store/repository boundaries for priority cursor listing、ETag detail and atomic approve/request-changes/reject/escalate actions；the repository rechecks current MFA session and effective platform role before every read/write and commits Listing、case、immutable action、Audit and Outbox together

Contracts: OpenAPI grows from 45 to 46 paths、54 to 55 operations and 100 to 108 schemas with bounded `GET /admin/moderation/cases`、strong-ETag `GET /admin/moderation/cases/{caseId}` and idempotent/concurrency-controlled `POST /admin/moderation/cases/{caseId}/actions`；strict generated TypeScript and Zod query/action contracts enforce queue/status/risk/limit boundaries、action/reason coupling and safe notes；Prisma grows from 49 to 50 models with immutable `ModerationCaseSnapshot`，case version and actor-scoped action idempotency evidence

Migrations: 有，`20260729150000_admin_moderation_workbench` additively adds case version、action idempotency/request hash、immutable redacted snapshots、constraints/indexes/FKs and UPDATE/DELETE rejection triggers；all 18 migrations replayed from the newly recreated disposable `socal_list004_empty` database；baseline passes 31 negative cases，previous-release upgrade creates a redacted sentinel snapshot，and migration safety passes 10 documented exceptions；application rollback disables the workbench writes while retaining case/action/snapshot evidence，and migration-local `ROLLBACK.md` documents exceptional stopped-writer physical removal

Security: Queue/detail require an ACTIVE MFA-bound current MODERATOR/SENIOR_MODERATOR assignment，while actions additionally require recent step-up and recheck role/session under the transaction；signed cursors bind actor and filters，strong If-Match plus row locks prevent lost moderation decisions，and actor/key advisory locking plus request hashes make exact retries single-write；snapshots omit phone/email/contact/address/coordinates and store only policy-safe submitted fields；unknown/revoked actors fail closed，Admin responses are no-store，the BFF cannot proxy arbitrary methods/paths and strips hop-by-hop/set-cookie upstream headers；Audit/Outbox/logs omit bodies、attributes、PII、notes、idempotency keys and request hashes

Tests run: Root `pnpm ci:quality` passed workflow/governance/config/container/seed/migration/OpenAPI/format/Prisma checks、9 workspace typechecks、9 lints、69 files / 263 tests with 2 explicit service skips、8 production builds and coverage thresholds；API passed 23 files / 122 tests including all four action outcomes、cursor tamper/scope、authorization、reason/step-up/If-Match/idempotency boundaries and runtime OpenAPI validation；Admin passed 3 files / 9 tests including BFF fail-closed paths、bilingual rendering and keyboard behavior；real PostgreSQL passed 21 files / 69 tests including paging/access/redaction、immutable snapshot/actions、atomic state/Audit/Outbox、exact retry/conflict and revoked-role checks；fresh deploy、migration status、baseline 31 negatives、upgrade compatibility and migration safety passed；API observability runtime and production Chromium desktop/mobile passed 8/8；architecture check passed 101 tasks / 50 Prisma models / 46 OpenAPI paths / 108 schemas / 36 JSON files；an initial full parallel run exposed the UI test's 1-second asynchronous assertion bound，so the bounded wait was raised to 5 seconds and both root `pnpm test` and the complete quality gate were repeated successfully；PR #22 / run `30419424360` passed protected real-service Linux quality、runtime/E2E and four non-root image checks

Not run: Local Redis and ClamAV integrations are explicitly skipped because neither service is available and ADMIN-002 only appends PostgreSQL Outbox records；local Docker image smoke is unavailable because this host has no Docker CLI；PR #22 / run `30419424360` supplied real Redis/ClamAV and passed Linux quality、browser and four non-root image checks

Observability: Existing bounded HTTP RED metrics/traces cover queue/detail/action routes；successful actions append queryable `moderation.action.applied` Audit and `listing.moderation.actioned` Outbox evidence with stable case/listing/action/reason/version/requestId fields；the workspace exposes loading、error、conflict and action results through accessible status/live regions；no snapshot content、note、actor identifier or idempotency evidence is added to metric labels or structured request logs

Docs: Updated moderation workflow、domain/data、API/integrations、security/privacy、testing matrix、acceptance criteria、Admin console/keyboard behavior、reference implementation、migration recovery、Gate checklist/status、Backlog、README、SECURITY、changelog、generated architecture book and this worklog

Known gaps: The current diff intentionally represents the first immutable submission as `ADDED` fields；revision-to-revision comparisons arrive with later edit/resubmission lifecycle work；LIST-005 is the next dependency-ordered slice and owns the public Rental list/detail/expiry path；reports/appeals、notifications、sampling/dry-run metrics and operator-approved production thresholds remain later tasks；evidence-head checks and protected merge are pending

## LIST-005 — Rental 公开列表、归档、删除与过期

Task: LIST-005 Rental 提交/发布/公开列表详情/过期

Changed: Added a canonical Rental-only public cursor list with approved、published、unexpired、not-deleted、active-taxonomy and active-publisher filters；implemented signed domain-separated cursors bound to type/category/region and a stable `publishedAt/id` order；added Owner/current organization writer archive and soft-delete transitions with strong ETag concurrency and safe exact retries；added a bounded `FOR UPDATE SKIP LOCKED` expiry repository plus Worker dispatcher；every lifecycle mutation atomically commits Listing state/version、minimized Audit evidence and an Outbox event

Contracts: OpenAPI grows from 46 to 47 paths、55 to 56 operations and 108 to 109 schemas；`GET /listings` now has strict Rental/category/region/cursor/limit query semantics、30-second public cache and a safe summary projection；new `PUT /listings/{listingId}/archive` and completed `DELETE /listings/{listingId}` require `If-Match` and return no-store responses；generated TypeScript and strict Zod contracts were updated；Prisma remains 50 models and adds only a partial due-expiry index

Migrations: 有，`20260729230000_listing_public_lifecycle` additively creates the partial `listings_rental_expiry_due_idx` for due Rental rows；all 19 migrations deploy and report current on the disposable local PostgreSQL database；baseline passes 31 negative cases and verifies four custom Listing indexes；previous-baseline upgrade applies 17 later migrations while preserving its sentinel；application rollback stops archive/delete/expiry callers and retains state/audit evidence，while migration-local `ROLLBACK.md` documents the recoverable index drop and roll-forward recreation

Security: Public responses omit body、created timestamp、exact coordinates/address、contact fields、publisher internals and moderation evidence；invalid、tampered or cross-filter cursors fail closed；archive/delete require ACTIVE server-derived actors and owner or current organization OWNER/ADMIN/EDITOR policy on every path，including exact archive retries，with repository authorization repeated after actor and Listing row locks；Billing retry denial is covered explicitly；outsiders receive generic 404 and stale versions receive 409；delete is soft-only；expiry is limited to approved due Rental rows and duplicate delivery is idempotent；Audit/Outbox/logs omit content、PII、cursor secrets and concurrency tokens

Tests run: Root `pnpm ci:quality` passed workflow/governance/config/container/seed/migration/OpenAPI/format/Prisma checks、9 workspace typechecks、9 lints、72 files / 271 tests with 0 failures and 2 explicit unavailable-service skips、8 production builds and 72.95% statements / 76.34% lines；API passed 23 files / 124 tests including public projection、cursor tamper/filter binding、archive/delete authorization、Billing retry denial、ETag、retry and evidence；real PostgreSQL passed 21 files / 72 tests including stable pagination、projection negatives、atomic lifecycle evidence and duplicate-safe expiry；Worker passed 11 files / 24 tests including expired/idle/error polling and error-detail redaction；fresh deploy、migration status、baseline 31 negatives、upgrade compatibility and migration safety passed；OpenAPI lint/generation checks and API observability runtime passed；production standalone Chromium desktop/mobile passed 8/8 after updating canonical contract counts；architecture check passed 101 tasks / 50 Prisma models / 47 OpenAPI paths / 109 schemas / 36 JSON files；PR #23 / run `30430161567` passed the protected real-service Linux quality、runtime/E2E and four non-root image checks

Not run: Local Redis and ClamAV integration tests are explicitly skipped because neither service is available and LIST-005 writes the PostgreSQL Outbox without consuming it；local Docker image smoke is unavailable because this host has no Docker CLI；PR #23 / run `30430161567` supplied real Redis/ClamAV and passed the Linux quality、browser and four-image non-root runtime checks

Observability: Added bounded `socal_listing_expiry_polls_total{outcome=expired|idle}`、`socal_listings_expired_total` and `socal_listing_expiry_poll_failures_total` metrics plus structured dispatcher start/stop/complete/failure events；labels contain only fixed outcomes and no Listing、actor、content、PII or cursor data；Audit and Outbox provide queryable per-transition evidence

Docs: Updated public lifecycle/data model、moderation workflow、security/privacy threats、testing matrix、acceptance criteria、reference implementation、runtime configuration、migration recovery、Gate checklist/status、Backlog、README、SECURITY、changelog、generated architecture book and this worklog

Known gaps: Public image variant delivery and full Web list/detail pages remain later LIST/WEB slices；search index deletion/expiry consumption begins in Gate 3；Job、Service、Market and Housing verticals remain LIST-006/007/010/011；notifications are the next dependency-ordered task；the evidence-head checks and protected merge remain pending

## NOTIF-001 — 站内通知与模板基线

Task: NOTIF-001 站内通知与模板基线

Changed: Added immutable versioned zh-Hans/en-US Listing status templates；implemented a strict Worker consumer that validates versioned Outbox envelopes and classifies permanent versus transient failures；added a PostgreSQL Notification Repository with canonical Listing recipient/locale resolution、event advisory locking、at-least-once deduplication、risk-aware submitted behavior、static rendered snapshots、stable private paging and idempotent read；added Controller → service → store boundaries with self-service Policy and signed user/filter-bound cursors；added a private bilingual noindex Web notification center with exact method/path BFF allowlisting、unread filter、pagination、read action and accessible loading/error/empty states

Contracts: OpenAPI grows from 47 to 49 paths、56 to 58 operations and 109 to 113 schemas；new `GET /notifications` returns account-private no-store data with unread count and opaque cursor，while `PUT /notifications/{notificationId}/read` is idempotent and maps unknown/foreign IDs to the same 404；strict Zod query contracts and generated TypeScript were updated；Prisma grows from 50 to 51 models with `NotificationTemplate` and extends `Notification` with template/version/locale/rendered/resource/event/version evidence

Migrations: 有，`20260730010000_notification_in_app_baseline` additively creates immutable published templates、backfills legacy notifications、adds safe constraints/indexes/FKs and seeds 16 bilingual version-1 templates；all 20 migrations replayed from a newly recreated disposable database and report current；baseline passed 33 database negative cases，including template mutation rejection，and previous-release upgrade applied 18 later migrations while preserving its sentinel；application rollback stops the consumer/API and retains delivered evidence，while migration-local `ROLLBACK.md` documents roll-forward-first recovery and exceptional stopped-writer removal

Security: Worker input is bounded and rejects malformed UUID/time/type/version/payload combinations；projection obtains recipient and locale only from canonical ACTIVE/LIMITED Listing ownership，drops content/contact/PII and stores only resource ID/version variables；event lock plus `source_event_id + user_id + channel` uniqueness prevents duplicate delivery；published templates reject UPDATE/DELETE；API Policy derives the account from the Session，signed cursors bind account/unread filter，foreign and unknown IDs share 404，mutating cookie requests require same origin，and all responses are no-store；Web rejects malformed/unbounded payloads，persists no notification data，is noindex，and the BFF fails closed on exact method/UUID path

Tests run: Architecture passed 101 tasks / 51 Prisma models / 49 OpenAPI paths / 113 schemas / 36 JSON files；migration safety passed 20 migrations / 12 documented exceptions；fresh deploy/status、baseline 33 negatives and previous-release upgrade passed；real PostgreSQL passed 22 files / 75 tests including two-Repository concurrent duplicate delivery、locale/risk/order/scope/read/immutability cases；root typecheck and lint passed all 9 workspaces；root Vitest passed 75 files / 302 tests with 2 explicit unavailable-service skips and coverage 73.39% statements / 76.72% lines；all 8 production builds and API observability runtime passed；production standalone Chromium desktop/mobile passed 10/10 including the private notification flow；the first lint pass exposed and the implementation fixed a synchronous Effect state-update path before repeating Web and root validation successfully；PR #24 initial run `30433566870` exposed a missing clean-install Vitest alias for `@socal/database/notification`，the alias was added and the entire local quality gate repeated；corrected run `30434003970` then passed 77 files / 304 tests with real Redis/ClamAV、Linux runtime and 10/10 Chromium journeys，plus all four non-root application image builds and health smoke checks；evidence-head run `30434551138` exposed an existing Admin keyboard-listener commit/effect race under parallel load，so the listener now installs synchronously with the rendered queue；the Admin suite passed 10 consecutive targeted runs，then the full local quality gate repeated successfully with all 302 locally available tests and 8 builds

Not run: Local Redis and ClamAV integration tests were explicitly skipped because neither service is available on this host；NOTIF-001 directly unit-tests its Worker consumer and uses PostgreSQL for projection，and PR #24 / run `30434003970` supplied both real services and passed all 304 tests；local Docker image smoke is unavailable because this host has no Docker CLI，while the same hosted run built and health-checked all four non-root images

Observability: Added bounded `socal_notification_events_total{outcome=created|duplicate|ignored|recipient_unavailable|failed}` plus structured Worker outcomes；metric labels and logs exclude event payload、notification body、recipient、resource/event identifiers and provider data；HTTP RED metrics/traces cover list/read and the UI announces bounded status without analytics payloads

Docs: Updated notification data/API/UI/security/testing/acceptance/operations/reference documentation、migration recovery、Backlog/status、README、SECURITY、changelog、generated architecture book and this worklog

Known gaps: Email/SMS/push adapters、preferences、unsubscribe、provider retries/receipts and production OTP/password delivery remain `NOTIF-002`；notification bulk actions and Admin notification operations are not part of this baseline；Job and the remaining Listing verticals continue with LIST-006/007；final run `30435034353` passed after the Admin race repair and PR #24 was protected-squash-merged as `19a6176`

## ORG-002 — 成员邀请、角色变更与 Owner 转移

Task: ORG-002 成员邀请、接受、撤销、Owner 转移

Changed: Added three-day organization invitation creation、self acceptance and Owner/Admin revocation；added conditional member role changes and removal；added current-Owner transfer with target promotion before actor demotion；all successful mutations use organization/member row locking、canonical request hashes、exact idempotent retries and atomic Audit/Outbox evidence；added a strict Worker projection from invitation-created events into bilingual in-app notifications and safe no-op handling for lifecycle events without a notification requirement

Contracts: OpenAPI grows from 49 to 57 paths、58 to 67 operations and 113 to 123 schemas；added invitation create/accept/revoke、member patch/delete、Owner transfer and ordinary account self-MFA enrollment/verify endpoints；member resources now expose version/updatedAt with strong ETags；generated TypeScript and strict Zod contracts、Web BFF allowlists and notification resource parsing were updated；Prisma grows from 51 to 53 models with `OrganizationInvitation` and `OrganizationOwnerTransfer`

Migrations: 有，`20260730020000_organization_membership_lifecycle` additively creates invitation/transfer evidence、membership versions、partial pending-invitation uniqueness、foreign keys/indexes and bilingual immutable invitation templates；two deferred constraint triggers verify every ACTIVE organization still has an Owner at transaction commit；all 21 migrations deploy and report current on the disposable PostgreSQL database；baseline passes 33 negative cases and verifies the new tables/index/columns/triggers；previous-baseline upgrade applies 19 later migrations while preserving its sentinel；application rollback disables lifecycle callers while retaining evidence，and migration-local `ROLLBACK.md` documents roll-forward-first recovery and the exceptional stopped-writer removal order

Security: Create/revoke require current organization Owner/Admin；accept derives the account from the Session and matches canonical email；pending uniqueness and expiry close duplicate/stale invitations；member mutations require ACTIVE actor、current scoped role、strong ETag and repository reauthorization after organization/member locks；unknown/cross-organization resources use generic not-found behavior；the deferred database trigger prevents last-Owner removal even under direct or concurrent writes；Owner transfer requires current Owner、MFA-bound session and recent MFA，and old Owners can only make an exact protected retry；Audit/Outbox/notification variables omit invitation email、organization private fields、tokens and raw request bodies

Tests run: Root `pnpm ci:quality` passed workflow/governance/config/container/seed/migration/OpenAPI/format/Prisma checks、9 workspace typechecks、9 lints、78 files / 318 tests with 0 failures and 2 explicit unavailable-service skips、8 production builds and 73.45% statements / 76.93% lines；real PostgreSQL passed 22 files / 78 tests including invitation expiry/evidence/version、conditional role/removal authorization、Owner transfer exact retry and last-Owner trigger cases；fresh deploy/status、baseline 33 negatives、previous-release upgrade and migration safety passed；API observability runtime passed against the canonical 57-path/123-schema contract；production standalone Chromium desktop/mobile passed 10/10；architecture passed 101 tasks / 53 Prisma models / 57 OpenAPI paths / 123 schemas / 36 JSON files；the first lint run exposed a missing explicit public return type、the first E2E run exposed historical hard-coded contract counts，and final review found then closed missing `If-Match` enforcement on member removal before repeating the full relevant gates；PR #25 initial run `30438316398` exposed a test-only dereferenced OpenAPI helper type that omitted operation parameters，root test typecheck and the API suite passed after correction；run `30438535063` then passed all 78 files / 320 tests with real Redis/ClamAV、Linux runtime、10/10 Chromium and four non-root image builds/health checks

Not run: Local Redis and ClamAV integration tests were explicitly skipped because neither service is available on this host；the invitation projection is directly unit-tested and uses PostgreSQL for durable notification state；local Docker image smoke is unavailable because this host has no Docker CLI；PR #25 / run `30438535063` supplied both services and passed the Linux test/build/browser gate plus all four non-root image checks

Observability: Reused bounded `socal_notification_events_total` outcomes and structured Worker completion/failure events for organization invitation projection；lifecycle events produce immutable Audit/Outbox evidence with identifiers and versions only；HTTP RED metrics/traces cover all new routes without invitation emails、member PII、MFA evidence or request hashes in labels/logs

Docs: Updated roles/permissions、domain/data、API/integrations、UI notification behavior、security/privacy、testing matrix、acceptance criteria、reference implementation、runtime configuration、migration recovery、Gate checklist/status、Backlog、README、SECURITY、changelog、generated architecture book and this worklog

Known gaps: Email/SMS invitation delivery、organization invitation management UI and delegated custom roles remain later slices；membership invitations require an existing platform account because AUTH-006 verification/linking is not yet implemented；final run `30439069763` passed and PR #25 was protected-squash-merged as `0ac0b6e`

## LIST-006 — Job 垂直切片

Task: LIST-006 Job 垂直切片

Changed: Reused the proven Listing draft/submission/moderation/public/expiry chain for Job；added a bilingual responsive `/[locale]/post/job/new` flow with vertical-isolated autosave recovery、employer/employment/experience/remote/wage/schedule/language/visa/benefit fields、explicit employment-policy acknowledgement and save/submit states；persisted coherent `JobDetail` create/update in the Listing transaction；extended public list/detail and due-expiry processing to Job；added conservative `EMPLOYMENT_POLICY_RISK` v2 human-review routing that stores field-only evidence；the application service and Repository both reject missing Job detail or Job detail attached to another vertical

Contracts: OpenAPI remains 57 paths / 67 operations / 123 schemas and changes `GET /listings?type` plus public summary type from Rental-only to the strict `RENTAL|JOB` enum；generated TypeScript and Zod adapters、contract tests and the Web BFF submit allowlist were updated；Prisma remains 53 models and records the Job due-expiry partial index

Migrations: 有，`20260730030000_job_vertical_baseline` additively adds coherent wage-range/nonblank Job-detail constraints and `listings_job_expiry_due_idx`；all 22 migrations deploy and report current on the disposable PostgreSQL database；baseline verifies the new constraints/index and passes 34 negative cases，while previous-baseline upgrade applies 20 later migrations and preserves its sentinel；application rollback disables Job create/public/expiry callers while retaining rows/evidence，and migration-local `ROLLBACK.md` documents recoverable index/constraint removal plus roll-forward recreation

Security: Job writes require the existing ACTIVE actor、object authorization、idempotency and strong ETag boundaries；policy acknowledgement is `OWNER_ONLY` and excluded from public projection；public list/detail continue omitting body、contact、exact location、owner internals and moderation evidence；wage min/max share a validated unit and cannot invert；the v2 policy-risk rule routes to human review without auto-penalty and stores only code/version/severity/field name，not suspected discriminatory text；cursor HMAC domain moved to v2 so old Rental cursors fail closed；duplicate Job expiry is state/version guarded and does not duplicate Audit/Outbox

Tests run: Root `pnpm ci:quality` passed workflow/governance/config/container/seed/migration/OpenAPI/format/Prisma checks、9 workspace typechecks、9 lints、78 files / 324 tests with 0 failures and 2 explicit unavailable-service skips、8 production builds and 73.44% statements / 76.95% lines；API passed 24 files / 137 tests；real PostgreSQL passed 22 files / 80 tests including Job detail type coupling、wage persistence/update、public private-field exclusion and duplicate-safe expiry；fresh deploy/status、migration safety、baseline 34 negatives and previous-release upgrade passed；production Chromium desktop/mobile passed 12/12 including bilingual Job create/save/submit；architecture passed 101 tasks / 53 Prisma models / 57 OpenAPI paths / 123 schemas / 36 JSON files；PR #26 / run `30441538770` passed 326 tests with real Redis/ClamAV、Linux production build/runtime、12/12 Chromium and all four non-root image build/health checks

Not run: Local Redis and ClamAV integration tests were explicitly skipped because neither service is available and LIST-006 only appends PostgreSQL Outbox records；local Docker image smoke is unavailable because this host has no Docker CLI；PR #26 / run `30441538770` supplied both services and passed the Linux quality、browser and four non-root image checks

Observability: Existing bounded HTTP RED metrics/traces cover draft、submit and public routes；the existing Listing expiry metrics now include Job through the same fixed outcome labels；successful mutations retain minimized Audit/Outbox identifiers and versions only；no employer、wage、policy text、body、contact、cursor or idempotency evidence enters metric labels or new structured logs

Docs: Updated content taxonomy、moderation workflow、security/privacy、acceptance criteria、route catalog、migration recovery、Gate checklist/status、Backlog、README、SECURITY、changelog、generated architecture book and this worklog；policy help text links official California Civil Rights Department and Labor Commissioner sources

Known gaps: Transfer/Secondhand/Service verticals remain `LIST-007`；production employment-policy terms、minimum-wage display interpretation、moderation thresholds/SLA and legal review require operator approval；external application tracking and employer verification are later product slices；the evidence-head checks and protected merge remain pending

## LIST-007 — Transfer / Secondhand / Service 垂直切片

Task: LIST-007 Transfer/Secondhand/Service 垂直切片

Changed: Added versioned bilingual dynamic fields and synthetic fixtures for the three remaining MVP verticals；added responsive noindex create pages and homepage quick-publish routes that reuse account/locale/vertical-isolated recovery、READY media upload/binding、autosave and idempotent submit；persisted coherent TransferDetail、SecondhandDetail and ServiceDetail create/update in the Listing transaction while removing mismatched details；extended public list/detail and due-expiry handling to all five Listing types；added conservative high-confidence `PROHIBITED_GOODS_RISK` v3 field-only evidence for Secondhand while preserving always-manual Transfer review

Contracts: OpenAPI remains 57 paths / 67 operations / 123 schemas and changes `GET /listings?type` plus public summary type from `RENTAL|JOB` to all five strict Listing types；generated TypeScript、Zod adapters and contract tests were updated；Prisma remains 53 models and records three additional due-expiry partial indexes

Migrations: 有，`20260730040000_remaining_verticals_baseline` additively adds coherent Transfer core-field、Secondhand JSON/condition/optional-text and Service radius/availability/license constraints plus three rebuildable expiry indexes；all 23 migrations are deployed and current on the local disposable PostgreSQL database；baseline verifies 8 custom Listing indexes and passes 37 negative cases，while previous-baseline upgrade applies 21 later migrations and preserves its sentinel；application rollback disables the three vertical callers while retaining rows/evidence，and migration-local `ROLLBACK.md` documents roll-forward-first recovery and exceptional stopped-writer constraint/index removal

Security: Existing ACTIVE actor、object authorization、idempotency and strong ETag boundaries protect all writes；Transfer requires a fixed positive asking price、bounded lease details、owner-only financial disclaimer and mandatory human review；Secondhand requires legal-source/prohibited-goods acknowledgement and only field-name high-risk evidence without suspected content or auto-penalty；Service radius/availability are bounded，license numbers and policy acknowledgements are owner-only，and public credential/insurance claims remain explicitly provider-reported；public projections exclude body from summaries、contact、exact location、owner-only/unknown attributes and moderation evidence；cursor HMAC domain moved to v3 so older narrower cursors fail closed；type/detail mismatch and duplicate expiry fail closed without duplicate Audit/Outbox

Tests run: Root `pnpm ci:quality` passed workflow/governance/config/container/seed/migration/OpenAPI/format/Prisma checks、9 workspace typechecks、9 lints、76 test files / 329 tests with 0 failures and 2 explicit unavailable-service skips、8 production builds and 73.38% statements / 76.87% lines；API passed 24 files / 139 tests；real PostgreSQL passed 22 files / 82 tests including three detail types、type mismatch、public owner-only exclusion and five-type duplicate-safe expiry；migration status、safety、baseline 37 negatives and previous-release upgrade passed；API observability runtime passed；production Chromium desktop/mobile passed 14/14 including Transfer/Secondhand/Service save and submission；full architecture validation passed 101 tasks / 53 Prisma models / 57 OpenAPI paths / 123 schemas / 36 JSON files with PyYAML duplicate-key and JSON Schema meta-validation enabled；PR #27 / run `30445735838` passed 78 files / 331 tests with real Redis/ClamAV、Linux production build/runtime、14/14 Chromium and all four non-root application image build/health checks

Not run: Local Redis and ClamAV integration tests were explicitly skipped because neither service is available and LIST-007 only appends PostgreSQL Outbox records；local Docker image smoke is unavailable because this host has no Docker CLI；PR #27 / run `30445735838` supplied both real services and passed all four non-root application image build/health checks

Observability: Existing bounded HTTP RED metrics/traces cover all five draft、submit and public routes；the existing Listing expiry metrics now include five types through the same fixed outcome labels；successful mutations retain minimized Audit/Outbox identifiers and versions only；no business financial figures、prohibited text、license number、body、contact、cursor or idempotency evidence enters metric labels or new structured logs

Docs: Updated domain/data、moderation workflow、security/privacy、testing matrix、acceptance criteria、taxonomy、route catalog、reference implementation、migration recovery、Gate checklist/status、Backlog、README、SECURITY、changelog、generated architecture book and this worklog

Known gaps: Production financial-disclaimer wording、prohibited/restricted goods taxonomy、regulated-service credential policy、moderation thresholds/SLA and legal review require operator approval；provider credential verification and marketplace report/appeal handling are later tasks；search indexing/removal begins in Gate 3；the evidence-head checks and protected merge remain pending

## MOD-002 — 举报、处置和申诉

Task: MOD-002 举报、处置和申诉

Changed: Added an ACTIVE-user Listing report flow with actor-scoped exact idempotency、concurrent active-target deduplication、one-hour quota and one immutable redacted evidence snapshot；added signed priority queues and safe detail projections for Listing reports and appeals；added MFA/recent-auth moderator dismissal、removal、escalation、uphold and restore actions with strong ETag concurrency；added a 30-day owner-only single appeal whose reviewer must differ from the removal reviewer；all successful transitions atomically persist Listing/case/report/appeal/action state、Audit evidence and Outbox events；added bilingual immutable removed/upheld/restored notification templates and strict Worker projections

Contracts: OpenAPI grows from 57 to 64 paths、67 to 74 operations and 123 to 137 schemas；new public `POST /reports` and `POST /appeals` routes require same-origin authenticated actors and strict idempotency；six Admin report/appeal queue/detail/action routes require moderator policy、MFA step-up and `If-Match` for mutations；generated TypeScript and strict Zod contracts were updated；Prisma grows from 53 to 54 models with `ModerationAppeal` and adds required report retry evidence plus appeal/case/action relations

Migrations: 有，`20260730050000_report_appeal_workflow` additively backfills and tightens report idempotency fields、adds report target/reason/details/request-hash constraints and active-target uniqueness、creates appeal evidence/indexes/relations、extends moderation case source integrity and seeds versioned bilingual outcome templates；all 24 migrations deploy and report current；fresh baseline passes 42 negative cases；previous-release upgrade applies 22 incremental migrations and validates legacy Report backfill while preserving its sentinel；application rollback disables report/appeal callers and retains safety evidence，while migration-local `ROLLBACK.md` documents roll-forward-first recovery and exceptional stopped-writer removal

Security: Public reporting requires an ACTIVE server-derived actor、same-origin cookie mutation、Listing visibility、self-report denial、bounded reason/details and a 10-per-hour database-enforced quota；advisory locking plus idempotency/request hashes and partial uniqueness prevent races without leaking target existence；snapshots redact contact/location/owner/internal fields and queues never reveal the reporter；Admin reads/actions require current moderator role and MFA，mutations additionally require recent step-up、strong ETag、reason/action coupling and repository reauthorization；appeals require current ownership、eligible removal、30-day window and a different reviewer；Audit/Outbox/notification variables exclude report prose、content、PII、cursor secrets、request hashes and authentication evidence

Tests run: Root PostgreSQL-enabled `pnpm ci:quality` passed workflow/governance/config/container/seed/migration/OpenAPI/format/Prisma checks、9 workspace typechecks、9 lints、79 files / 352 tests with 0 failures and 2 explicit unavailable-service skips、8 production builds and 72.61% statements / 76.29% lines；real PostgreSQL passed 23 files / 85 tests including concurrent deduplication、redaction、quota、atomic removal/appeal/independent restore、exact retry after resolution、four audits and notifications；all 24 migrations report current，fresh baseline passed 42 negatives，previous-release upgrade applied 22 later migrations and migration safety passed 24 migrations / 15 documented exceptions；OpenAPI lint/generation and API observability runtime passed against 64 paths / 137 schemas；production standalone Chromium desktop/mobile passed 14/14；full architecture validation passed 101 tasks / 54 Prisma models / 64 OpenAPI paths / 137 schemas / 36 JSON files；the first E2E pass correctly failed on stale 57/123 contract counts，which were updated before the successful rerun；PR #28 / run `30451684923` then passed 81 files / 354 tests with real PostgreSQL/Redis/ClamAV、Linux production build/runtime、14/14 Chromium and all four non-root application image builds/health checks

Not run: Local Redis and ClamAV integration tests are explicitly skipped because neither service is available on this Windows host；local Docker image build/health smoke is unavailable because Docker CLI is not installed；PR #28 / run `30451684923` supplied real Redis/ClamAV and passed the Linux quality、browser and four-image checks

Observability: Reuses bounded HTTP RED metrics and W3C traces for all report/appeal/Admin routes；each state transition emits queryable immutable Audit and Outbox evidence；report and appeal projections expose deterministic SLA deadlines without reporter or evidence content in metric labels/logs；runtime startup now verifies that the trust-safety repository is present in the production database package

Docs: Updated domain/data、API/integrations、moderation workflow、security/privacy、testing matrix、acceptance criteria、reference implementation、migration recovery、Gate checklist/status、Backlog、README、SECURITY、changelog、generated architecture book and this worklog

Known gaps: Report targets other than Listing are deferred to their owning Message/Review/Profile/User slices；malicious-reporter reputation、holiday/staff-aware SLA dashboards and quality sampling remain `MOD-004`；production reason codes、legal policy text、evidence retention and database encryption configuration require operator/legal/infrastructure approval；the current Prisma PostgreSQL adapter emits a `pg@9` future-deprecation warning for overlapping internal queries；the evidence-head protected checks、merge and final main evidence remain pending

## LIST-008 — Listing revision/diff/重大编辑复审

Task: LIST-008 Listing revision/diff/重大编辑复审

Changed: Added immutable submission、resubmission、minor-edit and major-edit Listing revision history with normalized redacted snapshots、field-level diffs、stable reason codes、risk/rule provenance and original publication windows；added owner-only signed-cursor revision reads plus latest-revision owner projection；published PATCH now requires actor-scoped idempotency and conservatively keeps only bounded text typo edits public while material category/region/price/contact/location/attributes/media/locale/risk changes re-enter human review and disappear from public reads；submission resubmits now compare the prior immutable revision and moderation details render the real previous diff；major-edit approval preserves the original publication/expiry window and expires already-ended windows instead of granting a free renewal

Contracts: OpenAPI grows from 64 to 65 paths、74 to 75 operations and 137 to 143 schemas；adds `GET /listings/{listingId}/revisions`、revision classification/reason/review/diff collection schemas、`ListingOwnerView.latestRevision` and published-PATCH idempotency semantics；moderation snapshot now explicitly carries nullable previous/revision context；generated TypeScript、strict Zod query adapter、BFF allowlist、runtime/E2E contract counts and contract tests were updated

Migrations: 有，`20260730060000_listing_revision_workflow` additively creates `listing_revisions`、previous-state/evaluation linkage、hash/version/risk/actor/publication-window checks、indexes/FKs and an UPDATE/DELETE immutability trigger；all 25 migrations deploy and report current；fresh baseline passes 42 negative cases and verifies the revision table/index/trigger/check contract；previous compatibility baseline applies 23 later migrations and preserves its sentinel；application rollback disables revision/published-edit callers while retaining evidence，and migration-local `ROLLBACK.md` documents roll-forward-first recovery and exceptional stopped-writer removal

Security: Revision collection is ACTIVE owner/organization-reader scoped、`no-store` and uses actor/Listing/limit/boundary-signed cursors；unknown/cross-owner/deleted resources use generic 404；snapshots and diffs exclude contact values、exact location and owner-only/unknown attribute values，and API omits hashes、sessions、request/idempotency evidence and thresholds；strong ETag、advisory/row locks、request hash、unique revision numbers and Case/evaluation/version checks prevent replays and stale overwrites；material-change classification fails closed and low-risk material edits still require human review；database immutability plus original-window approval prevents evidence tampering and free renewal

Tests run: Root PostgreSQL-enabled `pnpm ci:quality` passed workflow/governance/config/container/seed/migration/OpenAPI/format/Prisma checks、9 workspace typechecks、9 lints、80 test files / 356 tests with 0 failures and 2 explicit unavailable-service skips、8 production builds and 72.70% statements / 76.40% lines；API passed 26 files / 156 tests and canonical contract tests passed 18/18；real PostgreSQL passed 24 files / 86 tests including initial/resubmission revision、immutability、minor visibility、major review/public removal、owner isolation and exact retry；all 25 migrations report current，fresh baseline passed 42 negatives，previous-baseline upgrade applied 23 later migrations and migration safety passed 25 migrations / 16 documented exceptions；API observability runtime passed against 65 paths / 143 schemas；production standalone Chromium desktop/mobile passed 14/14；full architecture validation passed 101 tasks / 55 Prisma models / 65 OpenAPI paths / 143 schemas / 36 JSON files；quality and E2E first exposed stale moderation snapshot and 64/137 count assertions，which were corrected before complete green reruns；PR #29 / run `30457140384` then passed 82 files / 358 tests with real PostgreSQL/Redis/ClamAV、72.72% statements / 76.43% lines、Linux production runtime、14/14 Chromium and all four non-root application image builds/health checks

Not run: Local Redis and ClamAV integrations are explicitly skipped because neither service is available on this Windows host and LIST-008 only appends PostgreSQL Outbox events；local Docker image build/health smoke is unavailable because Docker CLI is not installed；PR #29 / run `30457140384` supplied the real services and passed all four non-root image checks

Observability: Existing bounded HTTP RED metrics and W3C traces cover published edits and owner revision reads；each successful state change emits minimized immutable Audit/Outbox evidence with aggregate versions；the runtime contract check now verifies 65 paths / 143 schemas；no snapshot text、diff values、contact/location data、cursor/idempotency evidence or request hashes enter metric labels or new structured logs

Docs: Updated domain/data、API/integrations、moderation workflow、security/privacy、testing matrix、acceptance criteria、data retention、reference implementation、migration recovery、Gate checklist/status、Backlog、README、SECURITY、changelog、generated architecture book and this worklog

Known gaps: `LIST-009` now exposes the latest owner revision summary in the account center，while the complete revision-history interaction remains owned by `WEB-004`；production material-field thresholds、two-year cleanup/legal-hold jobs and encryption configuration require operator/legal/infrastructure approval；search projection removal/version reconciliation begins in Gate 3；the Prisma PostgreSQL adapter still emits its documented `pg@9` future-deprecation warning under parallel integration tests；PR #29 evidence-head run `30457838971`、protected merge `c09c17c` and final main run `30458526726` subsequently passed

## LIST-009 — 用户中心信息管理

Task: LIST-009 用户中心信息管理

Changed: Added private `/me/listings` draft/pending/published/archived management with expiry-aware counts、actor/filter-bound signed cursors、personal plus current-organization reads and minimal latest-revision summaries；added ordered 1–20 item strong-version archive/delete batches with per-item partial outcomes and target-state retry safety；added a bilingual responsive noindex/no-store account center with type filters、bounded selection、delete confirmation、partial-failure feedback and exact DRAFT continuation through owner API/ETag；made the entire Web account route segment force-dynamic so private pages cannot receive shared static-cache headers

Contracts: OpenAPI grows from 65 to 67 paths、75 to 77 operations and 143 to 152 schemas；adds `GET /me/listings` and `POST /me/listings/actions` with owner bucket、minimal summary/count/page、batch item/result schemas and bounded Problem Details；generated TypeScript、strict Zod filters/batch adapters、Session permissions、Web BFF allowlist、runtime/E2E counts and response contract tests were updated

Migrations: 无；Prisma schema is unchanged。The query reuses canonical Listing、membership、taxonomy and immutable revision data plus existing `(owner_id,status,created_at)` / `(organization_id,status,created_at)` indexes；all 25 migrations report current，fresh baseline still passes 42 negatives，the previous-release compatibility run applies 23 later migrations and preserves its sentinel。Rollback removes the new Controller/BFF/UI callers and query methods without data conversion；existing lifecycle data、Audit/Outbox and indexes remain intact

Security: Server-derived actor scope replaces client owner IDs；signed cursors bind actor、bucket、type、organization、limit and stable boundaries；private projections omit body、attributes、contact、exact location、owner IDs、snapshots/hashes and internal thresholds；all responses/BFF/pages use no-store and account metadata noindex/nofollow；batch input is strict、unique and capped at 20，then reuses object Policy、strong versions and row-locked lifecycle transitions per item；cross-owner、deleted、unknown and organization read-only writes return generic NOT_FOUND outcomes without aborting or authorizing another item；restricted users may read but cannot mutate；SUSPENDED content exposes no delete UI action so the appeal path remains available

Tests run: Root PostgreSQL-enabled `pnpm ci:quality` passed workflow/governance/config/container/seed/migration/OpenAPI/format/Prisma checks、9 workspace typechecks、9 lints、81 test files / 364 tests with 0 failures and 2 explicit unavailable-service skips、8 production builds and 72.61% statements / 76.22% lines；API contract/service/HTTP tests passed 38/38 targeted and include guest/owner/outsider/restricted/organization Billing、tampered cursor、batch ordering/version/state/exact-retry cases；contract and Web targeted tests passed 7/7 and 5/5；real PostgreSQL passed 24 files / 87 tests including personal/organization/four-bucket/expiry/filter/cursor/count projections；all 25 migrations report current，fresh baseline passes 42 negatives and previous-release upgrade applies 23 migrations；API observability runtime passes against 67 paths / 152 schemas；production standalone Chromium desktop/mobile passes 16/16，including account and notification no-store/noindex boundaries；the first complete gates correctly exposed and then verified fixes for synchronous effect state、an implicit test-store return type、stale Session permissions、shared static account caching and an incorrect test-only login href；PR #30 / run `30462257981` then passed 83 files / 366 tests with real PostgreSQL/Redis/ClamAV、72.58% statements / 76.19% lines、Linux production runtime、16/16 Chromium and all four non-root application image builds/health checks

Not run: Local Redis and ClamAV integrations are explicitly skipped because neither service is available on this Windows host and LIST-009 creates no new queue consumer；local Docker image build/health smoke is unavailable because Docker CLI is not installed；PR #30 / run `30462257981` supplied real Redis/ClamAV and passed all four non-root image checks

Observability: Existing bounded HTTP RED metrics and W3C traces cover both account-management routes；successful archive/delete items retain existing minimized immutable Audit/Outbox evidence while exact delete retries do not duplicate it；runtime contract validation now verifies 67 paths / 152 schemas；no Listing title、selected IDs、cursor、contact、private summary or object-existence detail is added to metric labels or structured logs

Docs: Updated information architecture、domain/data、API/integrations、UI/design system、moderation workflow、security/privacy、testing matrix、acceptance criteria、route catalog、reference implementation、Gate checklist/status、Backlog、README、SECURITY、changelog、generated architecture book and this worklog

Known gaps: Production organization-scale count/query plans still require Beta-volume EXPLAIN evidence，although the current indexed query is bounded and real PostgreSQL validated；browser tests cover the unauthenticated management boundary while authenticated list/batch behavior is covered at React/API layers；the Prisma PostgreSQL adapter still emits its documented `pg@9` future-deprecation warning under parallel integration tests；search projection reconciliation begins in Gate 3；PR #30 evidence-head run `30462982703`、protected merge `170a731` and final main run `30463612335` subsequently passed

## MOD-003 — 重复文本/图片/联系方式检测

Task: MOD-003 重复文本/图片/联系方式检测

Changed: Added versioned `listing-duplicate` candidate policy with a same-type 365-day/10-result boundary、pg_trgm title/body similarity、deterministic 64-bit media dHash/Hamming distance and historical-schema PHONE/EMAIL domain-separated HMAC fingerprints；added DRY_RUN versus ENFORCE candidate classification and a medium-risk `POSSIBLE_DUPLICATE` rule without automatic punishment；persisted immutable candidate/version/threshold/signal/internal-score evidence with one-way human outcomes in the same submission or major-edit transaction；added minimal moderator projections、bilingual Admin rendering and stable `DUPLICATE_CONTENT` action reasons；added bounded confirmed/false-positive Prometheus feedback whose exact action retries remain metric-idempotent；made the existing READY-media integration fixture use one explicit lifecycle clock so it cannot expire relative to the CI wall clock

Contracts: OpenAPI remains 67 paths / 77 operations and grows from 152 to 153 schemas by adding `ModerationDuplicateCandidate` to the existing no-store moderation detail；the public submit/edit request contract is unchanged；the moderator response exposes only candidate Listing ID/version/type/title/status、threshold version、mode、confidence and signal names，never numeric scores、threshold values、contact fingerprints、raw contacts、media object keys or candidate owner；generated TypeScript、strict Zod reason mappings、runtime and E2E contract counts were updated

Migrations: 有，`20260730070000_listing_duplicate_detection` additively adds nullable READY/DELETED media dHash、Listing contact-fingerprint storage/indexes、a bounded Listing type/time index、validated immutable 64-bit Hamming function and candidate evidence/checks/FKs/indexes/triggers；candidate identity/internal evidence cannot be updated or deleted and the first human review outcome cannot be revised；all 26 migrations deploy and report current；fresh baseline still passes 42 negatives and previous 0.1.0 compatibility applies 24 later migrations while preserving its sentinel；application rollback disables lookup/writes and retains evidence，with exceptional stopped-writer physical recovery documented in migration-local `ROLLBACK.md`

Security: Contact fields come only from the exact historical form schema and are normalized then immediately HMACed under a dedicated domain，with no raw/normalized value stored in detection tables；parameterized queries are bounded by type、one year、20 media/contact inputs and 10 results；low-threshold hits remain dry-run and high-threshold/contact hits only trigger human review，never automatic conviction/removal；only current MFA moderators can read minimal candidates and actions still require recent MFA、strong ETag、actor-scoped idempotency and transaction-time role checks；database immutability、evaluation/Listing/threshold versions and one-way review outcomes prevent evidence tampering/feedback rewriting；API、Admin、Audit、Outbox、metrics、logs and Problem Details exclude PII fingerprints、scores、thresholds and object keys

Tests run: Root PostgreSQL-enabled `pnpm ci:quality` passed workflow/governance/config/container/seed/migration/OpenAPI/format/Prisma checks、9 workspace typechecks、9 lints、84 test files with 82 passed / 2 explicit service skips and 373/375 tests passed、8 production builds and 72.71% statements / 76.36% lines；real PostgreSQL passed 24 files / 88 tests including candidate windows/signals/order、fingerprint non-PII persistence、Hamming distance、READY/DELETED media lifecycle、transactional candidate writes and candidate/review UPDATE/DELETE tamper negatives；all 26 migrations report current，fresh baseline passes 42 negatives，the previous-release upgrade applies 24 later migrations and migration safety passes 26 migrations / 16 documented exceptions；OpenAPI lint/generation、API observability runtime and full architecture semantic validation pass against 57 Prisma models / 67 paths / 153 schemas / 36 JSON files；production standalone Chromium desktop/mobile passes 16/16；PR #31 protected run `30468335925` passed 84 files / 375 tests with real Redis/ClamAV、Linux 16/16 E2E、8 builds and four non-root image health checks；run `30469031523` exposed the existing fixed-time READY-media fixture after its five-minute expiry window，then the same PostgreSQL file passed 6/6 and the complete local quality gate passed after assigning its explicit `createdAt`；the first local runtime/E2E pass correctly failed on stale 152-schema assertions，which were updated before complete green reruns

Not run: Redis and ClamAV integrations remain skipped only on this Windows host because neither service is installed；local Docker image build/health smoke is unavailable because Docker CLI is not installed；PR #31 run `30468335925` supplied and passed both real-service integrations and all four non-root image checks

Observability: Added only `socal_moderation_duplicate_reviews_total{outcome="confirmed|false_positive"}` with a fixed bounded label set and candidate-count increments from first committed human outcomes；exact idempotent retries do not increment；existing HTTP RED metrics/traces cover submit/edit/moderation routes and runtime validation now verifies 67 paths / 153 schemas；Listing/candidate IDs、titles、scores、thresholds、contacts、fingerprints、image hashes/object keys and reviewer identity never enter labels or new structured logs

Docs: Updated domain/data、API/integrations、moderation workflow、security/privacy、observability、testing matrix、acceptance criteria、retention、Admin console、reference implementation、migration recovery、Gate checklist/status、Backlog、README、SECURITY、changelog、generated architecture book and this worklog

Known gaps: Production thresholds and false-positive rate cannot be calibrated without reviewed Beta traffic and must remain versioned/dry-run first；HMAC key rotation and retention deletion require an operator/legal-approved rebuild/dual-read plan；Beta-volume EXPLAIN evidence and production database encryption remain later performance/infrastructure gates；the Prisma PostgreSQL adapter still emits its documented `pg@9` future-deprecation warning under parallel integration tests；PR #31 evidence-head run `30469588802`、protected merge `cdd3c53` and final main run `30470203397` subsequently passed

## WEB-004 — 账户中心壳与权限缓存策略

Task: WEB-004 账户中心壳与权限缓存策略

Changed: Added `apps/web/src/components/account-shell.tsx` as the single account Session/capability boundary、`account-overview.tsx` and the bilingual `/[locale]/account` page；wrapped all account children in the shared Provider/Shell；removed duplicate Session fetching from Listing management and notifications；added responsive accessible styles、strict parser/component tests and production Chromium coverage

Contracts: OpenAPI、generated contracts and public API unchanged；the Web parser consumes the existing `SessionResponse` and fails closed on malformed、duplicated、unbounded or expired data

Migrations: None；Prisma/schema/database facts unchanged；rollback removes the account overview/shared wrapper and restores per-page Session reads，with no persistent data to recover

Security: Session/capabilities exist only in component-tree memory and every fetch is `no-store`；visible pages revalidate at most every 15 seconds plus focus、pageshow、visibility restoration and absolute expiry；401、expired、non-2xx、network or invalid payload clears prior capabilities；no Web Storage/URL/log persistence；navigation is only a UI hint and API Policy/object authorization remains authoritative；minimal organization summaries exclude contact data

Tests run: Target Web typecheck and lint passed；3 targeted Web files / 11 tests passed；production Web build passed and emitted dynamic account routes；production standalone Chromium desktop/mobile passed 18/18 including capability-scoped account navigation、localized organization summary、noindex/no-store and overflow；PostgreSQL-enabled root `pnpm ci:quality` passed workflow/governance/config/container/seed/migration/OpenAPI/format/Prisma checks、9 typechecks、9 lints、85 test files with 83 passed / 2 service skips and 378/380 tests passed、8 production builds and 72.78% statements / 76.50% lines；API runtime RED/trace/OpenAPI check passed；architecture checker passed 101 tasks / 57 Prisma models / 67 OpenAPI paths / 153 schemas / 36 JSON files；PR #32 protected run `30472304542` passed 85 files / 380 tests with real Redis/ClamAV、Linux 18/18 E2E、8 builds and four non-root image health checks

Not run: Local Redis and ClamAV integrations remain explicitly skipped because those services are not installed on this Windows host；local Docker image build/health smoke is unavailable because Docker CLI is not installed；PR #32 run `30472304542` supplied and passed both real-service integrations and all four non-root image checks

Observability: No new metrics or high-cardinality logs；existing HTTP RED metrics cover `/auth/session` and account BFF requests，while focus/expiry refresh failures remain bounded UI states without Session payload logging

Docs: Updated information architecture、roles/permissions、system cache strategy、API consumption boundary、UI system、security/privacy、testing、acceptance criteria、route catalog、reference implementation、Gate checklist/status、Backlog、README、SECURITY、changelog、generated architecture book and this worklog

Known gaps: Message、favorite、orders、wallet、profile/security/privacy and later organization-management pages remain owned by their Backlog tasks and intentionally have no placeholder navigation；cross-tab immediate invalidation is not implemented because no safe server push contract exists，so visible staleness is bounded to 15 seconds and every API action reauthorizes；the Prisma PostgreSQL adapter still emits its documented `pg@9` future-deprecation warning under parallel integration tests；PR #32 evidence-head run `30472954506`、protected merge `1bdcab9` and final main run `30473551979` subsequently passed

## SEARCH-001 — 版本化 Listing index/mapping/analyzers

Task: SEARCH-001 版本化 Listing index/mapping/analyzers

Changed: Added a strict public `ListingSearchDocument`、v1 physical index/read-write aliases、bilingual/CJK/English/prefix analyzers、structured category/region/price/attributes and fuzzy public geo mapping；added create-or-validate manager、official OpenSearch client adapter、safe CLI、Worker runtime config、Compose wiring、real-service integration tests and versioned CI service

Contracts: Public OpenAPI and generated REST contracts unchanged；the new internal OpenSearch contract is versioned by physical index name and mapping `_meta`，and rejects unknown fields

Migrations: None；Prisma/schema/PostgreSQL unchanged；rollback deletes the derived v1 index or restores the prior code/config，with no canonical data loss；mapping changes require a new schema version and later SEARCH-005 alias workflow rather than in-place rollback

Security: TypeScript DTO and `dynamic: strict` mapping both exclude phone/email/exact address/contact policy/moderation/risk/object-key/credential data；only fuzzy public geo is accepted；OpenSearch credentials are paired SecretValue inputs and never logged；mapping/alias drift fails closed

Tests run: Target Worker unit suite passed 12 files / 51 tests with 3 explicitly skipped local service integrations；Worker typecheck and lint passed；Config 8/8 tests、runtime config、CI workflow and container contract checks passed；architecture checker passed 101 tasks / 57 Prisma models / 67 OpenAPI paths / 153 schemas / 36 JSON files；root `pnpm ci:quality` passed workflow/governance/config/container/seed/migration/OpenAPI/format/Prisma checks、9 typechecks、9 lints、65 test files / 311 tests with 22 service integration files / 74 tests explicitly skipped、8 production builds and 54.18% statements / 56.86% lines；PR #33 run `30476171572` passed 87/87 files、385/385 tests including real PostgreSQL/Redis/ClamAV/OpenSearch and `listing-index.integration`、72.75% statements / 76.46% lines、8 builds、API runtime、Linux Chromium 18/18 and four non-root image health checks

Not run: Real OpenSearch、Redis and ClamAV integrations were skipped locally because Docker CLI and those local nodes are unavailable；the installed PostgreSQL service rejects the repository `.env` account and the safety guard correctly refused using the non-test `socal` database as disposable，so 19 PostgreSQL integration files were also skipped on the final successful local run；PR #33 run `30476171572` supplied and passed every skipped real-service suite

Observability: CLI emits only fixed event、outcome、index/alias names and schema version；failure logging contains fixed code/type and excludes node URL、credentials、documents and query text；no new production metric until indexing Worker work in SEARCH-002

Docs: Updated README、search architecture、security/privacy、testing、acceptance criteria、reference implementation、Gate checklist and task status

Known gaps: SEARCH-002 owns Outbox consumption、external-version ordering、deletion priority and reconciliation；SEARCH-003 owns query/facets/cursor/geo API；SEARCH-004 owns synonyms/suggestions/trending privacy；SEARCH-005 owns rebuild and atomic alias switch；production shard/replica sizing still requires Beta capacity evidence；PR #33 evidence-head run `30476886837`、protected merge `8a827bf` and final main run `30477490511` subsequently passed

## SEARCH-002 — 索引 Worker、下架优先和对账

Task: SEARCH-002 索引 Worker、下架优先和对账

Changed: Added a canonical `ListingSearchRepository` that reloads current publishability、historical PUBLIC attributes、taxonomy paths/aliases、public publisher signals and fuzzy geo from PostgreSQL；added strict Listing envelope parsing、integer-minor-unit document construction and OpenSearch `external_gte` upsert/removal adapter；composed search and notification handlers on the same idempotent BullMQ job；added two-stage urgent takedown priority in Outbox claim and BullMQ；added bounded cursor reconciliation and Worker runtime controls

Contracts: Public OpenAPI and generated REST contracts remain 67 paths / 153 schemas；the internal v1 `ListingSearchDocument` mapping is unchanged，while its producer now guarantees canonical contentVersion、PUBLIC-only primitive attributes、USD integer minor units and no exact point；Outbox claim accepts an optional validated/capped priority event allowlist

Migrations: None；Prisma schema and all 26 migrations are unchanged。The repository reads existing Listing/taxonomy/form-schema/actor relations and existing UUID/status indexes；rollback removes the Worker consumer/reconciler and priority options，leaving PostgreSQL facts、Outbox history and the derived index intact；an index version ahead of canonical data requires later SEARCH-005 rebuild rather than destructive in-place lowering

Security: Event payload is only a strict UUID/version/time trigger and never a document source；publishability is re-evaluated from canonical status、moderation、expiry、taxonomy and actor state；historical schema allowlists PUBLIC attributes and complex/private/unknown values are omitted；EXACT coordinates become the Region CITY point and other public coordinates are rounded to three decimals；external version prevents old writes/deletes；logs/metrics exclude IDs、titles、payloads、coordinates and provider detail

Tests run: Target Database/Observability/Worker typecheck and lint passed；target tests passed 78 tests with 76 explicit local service skips；root `pnpm ci:quality` passed workflow/governance/runtime/container/seed/migration/OpenAPI/format/Prisma checks、9 workspace typechecks、9 lints、67 passed / 23 skipped files with 319 passed / 76 skipped tests、8 production builds and 54.17% statements / 56.91% lines；the production Database subpath was directly required after a clean package/Worker build；architecture checker passed 101 tasks / 57 Prisma models / 67 OpenAPI paths / 153 schemas / 36 JSON files；PR #34 run `30480865046` passed 90/90 files and 395/395 tests including real PostgreSQL priority/projection、Redis、ClamAV and OpenSearch external-version coverage，73.20% statements / 76.98% lines，8 production builds、API runtime、Linux Chromium 18/18 and four non-root image health checks；earlier hosted runs correctly exposed and led to fixes for PostgreSQL constant ordering、immutable-fixture cleanup and the missing production subpath build input

Not run: Local real PostgreSQL integration remains unavailable because the installed service rejects the repository `.env` account and the disposable-test guard forbids the non-test database；Redis、ClamAV、OpenSearch and Docker image smoke are unavailable on this Windows host。PR #34 run `30480865046` supplied and passed all corresponding real-service、Linux Chromium and four-image checks

Observability: Added `socal_search_index_events_total{operation,outcome,priority}`、`socal_search_index_freshness_seconds{operation,priority}` with 1/2/5/10/30/60/120/300/900-second buckets and `socal_search_reconciliation_total{outcome}`；the histogram records only successful terminal writes/deletes so failed retries do not distort the SLO，and fixed labels support urgent p95 10-second and normal p95 60-second calculation without resource cardinality；reconciliation logs only counts and cycle completion

Docs: Updated README、search architecture、security/privacy、observability、testing、operations runbook、acceptance criteria、reference implementation、SECURITY、changelog、generated architecture book、Gate status and this worklog

Known gaps: SEARCH-003 owns public query/facets/cursor/geo API，SEARCH-004 owns synonym/suggestion/trending privacy and SEARCH-005 owns full rebuild/atomic alias switching；reconciliation compares Listing versions and presence，while dependency display-name/taxonomy content refresh without Listing version change remains a later event/rebuild concern；production p95 claims require observed Beta traffic and are not inferred from test timing；PR #34 evidence-head run `30481617516`、protected merge `c66d59c` and final-main run `30482212485` subsequently passed

## SEARCH-003 — 搜索查询、facets、cursor、geo

Task: SEARCH-003 搜索查询、facets、cursor、geo

Changed: Added a public Search application/controller boundary and official OpenSearch read adapter over the versioned read alias；added bounded bilingual full-text、category/type/region/price/public-attribute filters、fixed facets、geo distance and five deterministic sort modes；added short-lived PIT plus `search_after` pagination with HMAC-authenticated、query-bound、expiring cursors and best-effort PIT closure；added strict public projection parsing、dependency injection、runtime limits、Problem Details mapping and test stores

Contracts: OpenAPI remains 67 paths and grows from 153 to 160 schemas；`GET /search` now has bounded Unicode/query、paired geo、decimal money、cursor and limit validation plus explicit 400/410/503/504 outcomes；its dedicated strict result excludes body、moderation/risk/internal ranking data、exact contacts and object keys；generated TypeScript and strict Zod input contracts were regenerated and runtime/E2E schema assertions updated

Migrations: None；Prisma schema、PostgreSQL and all existing migrations are unchanged；OpenSearch remains rebuildable derived state；rollback removes the Search module/adapter and restores the prior broad contract without modifying canonical data or the v1 index

Security: Every query is normalized and rejects controls/bidirectional overrides、unpaired geo、unbounded radius/limit/cursor and invalid exact decimal ranges；OpenSearch filters always require current `PUBLISHED` and unexpired documents at one fixed snapshot instant；cursor HMAC binds every filter/sort/limit plus PIT/snapshot/expiry and never contains raw query text；source allowlisting plus fail-closed projection parsing prevents indexed private/internal fields from crossing the API；timeouts、partial results、PIT expiry and projection drift fail closed；metrics/logs exclude query text、cursor、listing IDs、coordinates and filter values

Tests run: Root `pnpm ci:quality` passed workflow/governance/runtime/container/seed/migration/OpenAPI/format/Prisma checks、9 workspace typechecks、9 lints、70 passed / 24 explicitly service-skipped files with 331 passed / 77 skipped tests、8 production builds and 55.09% statements / 57.89% lines；Contracts passed 9 files / 38 tests；API passed 30 files / 178 tests plus one explicit OpenSearch skip；Config passed 8/8 and Observability passed 2/2；OpenAPI lint/generation、runtime config、API RED/trace/OpenAPI runtime and full architecture semantic validation passed against 101 tasks / 57 Prisma models / 67 paths / 160 schemas / 36 JSON files；after the first E2E run correctly exposed the stale 153-schema assertion, the affected 2/2 and complete production standalone Chromium desktop/mobile 18/18 passed；PR #35 run `30485602948` passed 94/94 files and 408/408 tests including real PostgreSQL/Redis/ClamAV/OpenSearch and the new PIT/facets/geo/search-after integration、9 typechecks、9 lints、8 builds、Linux Chromium 18/18 and four non-root image health checks

Not run: Real OpenSearch integration is explicitly skipped on this Windows host because no local node or Docker CLI is available；real PostgreSQL integrations are skipped because the installed service rejects the repository test account and the disposable-test guard forbids the non-test database；Redis、ClamAV and local four-image smoke are unavailable；PR #35 run `30485602948` supplied and passed every corresponding real-service、Linux and non-root image check

Observability: Added `socal_search_queries_total{outcome,sort,geo}` with only fixed bounded outcomes and sort/geo flags；success、empty、invalid/expired cursor、timeout and unavailable paths are counted without query text、cursor、filters、coordinates or resource identifiers；existing HTTP RED metrics/traces cover `/search`

Docs: Updated API/integrations、search/ranking、security/privacy、performance/reliability、observability、testing、operations、acceptance criteria、reference implementation、runtime configuration、README、SECURITY、changelog、Gate checklist/status、Backlog、generated architecture book and this worklog

Known gaps: SEARCH-004 owns versioned synonyms、suggestions and low-frequency-sensitive trending privacy；SEARCH-005 owns rebuild/catch-up/validation/atomic alias rollback；SEARCH-006 owns relevance evaluation and dashboards；WEB-001 owns public list/detail/filter pages；production relevance and latency SLO claims require observed Beta traffic；PR #35 evidence-head run `30486215533` attempt 2、protected merge `4d3b899` and final-main run `30487552179` subsequently passed；attempt 1 was cancelled only after the GitHub runner stalled for more than six minutes in browser download following successful real-service tests/builds，then attempt 2 passed every gate without code changes

## SEARCH-004 — 同义词、建议和热门搜索隐私

Task: SEARCH-004 同义词、建议和热门搜索隐私

Changed: Added one versioned Search dictionary lifecycle with a single optimistic-concurrency draft、different-reviewer publication、immutable published history and rollback-as-reviewed-new-draft；bound immutable dictionary versions into search cursor v2 and expanded at most eight exact reviewed synonyms as OR terms while retaining per-term AND matching；added strict suggestion/trending application and HTTP boundaries over published dictionary、active taxonomy and privacy-thresholded recent queries；added first-page/result-bearing sampling、bot and two-pass PII/sensitive filtering、server-IP-derived HMAC source deduplication、bounded retention pruning、database and production runtime adapters

Contracts: OpenAPI grows from 67 to 68 paths、160 to 163 schemas and 77 to 78 operationIds；`GET /search/suggestions` now has optional bounded q、locale/region/limit、strict no-store responses and 400/503 outcomes；new `GET /search/trending` has bounded 1/7/30-day windows、rank-only output and five-minute public cache；generated TypeScript and strict Zod query/response/dictionary contracts were updated；Prisma grows from 57 to 60 models with `SearchDictionaryState`、`SearchDictionaryVersion` and `SearchQuerySample`

Migrations: Added forward-safe migration `20260730080000_search_discovery_privacy` with singleton/current-version checks、one-draft uniqueness、content/publication checks、published-row update/delete triggers、query/source/day uniqueness、locale/hash/text/region/UTC-day/90-day retention constraints and aggregation/expiry indexes；migration is additive and `ROLLBACK.md` documents application rollback plus delayed table removal after cursor/sample drainage；published history is preserved and rollback appends a reviewed draft/new version instead of rewriting history

Security: Public recent-query output requires at least five distinct server-IP-derived HMAC sources even when a caller requests a lower threshold；one source contributes once per query/UTC day and User-Agent rotation does not inflate anonymity；missing/known-bot User-Agent、email、phone、URL、long number、English/Chinese address、contact handle、control/bidi and published blocked-term inputs are rejected before storage，then screened again before output；raw IP/User-Agent are never stored and query/source/hash never enter logs or metric labels；dictionary publication and rollback require a second reviewer；dependency failures degrade only first-page synonym expansion to version 0 while version-bound cursors fail closed

Tests run: Local root `pnpm ci:quality` passed workflow/governance/runtime/container/seed/migration/OpenAPI/format/Prisma checks、9 workspace typechecks、9 lints、72 passed / 25 service-skipped files with 347 passed / 83 skipped tests、8 production builds and 55.20% statements / 57.92% lines；API targeted suite passed 31 files / 190 tests with only 2 local OpenSearch skips；architecture checker passed 101 tasks / 60 Prisma models / 68 OpenAPI paths / 163 schemas / 36 JSON files；production database subpath require、API observability runtime and standalone Chromium desktop/mobile 18/18 passed；PR #36 run `30490452692` passed 97/97 files and 430/430 tests including 5 Search discovery PostgreSQL tests、2 real synonym/OpenSearch tests、Redis、ClamAV and all prior integrations，27-migration fresh deploy、25-migration upgrade sentinel、42 baseline negatives、73.54% statements coverage、8 Linux production builds、API runtime、Linux Chromium 18/18 and four non-root image health checks

Not run: Local real PostgreSQL/OpenSearch/Redis/ClamAV and four-image smoke were unavailable because this Windows host has no Docker CLI and no disposable `DATABASE_INTEGRATION_URL`；the first plain `bash` lookup also failed because Bash was not on PowerShell PATH，so the unchanged architecture script was rerun successfully through Git Bash with the installed Python 3.13 path。PR #36 run `30490452692` supplied and passed every corresponding real-service、Linux and container check

Observability: Added fixed-cardinality `socal_search_discovery_events_total{operation,outcome}` for dictionary/sample/suggestions/trending/retention and success/empty/recorded/duplicate/rejected_bot/rejected_sensitive/unavailable outcomes；no query、hash、source、IP、User-Agent、region or resource identifier is permitted in labels，and existing HTTP RED/trace coverage applies to both endpoints

Docs: Updated README、API/integrations、data model、search/ranking、security/privacy、observability、testing、operations、acceptance criteria、retention、reference implementation、SECURITY、changelog、Gate checklist/status、Backlog、generated architecture book and this worklog

Known gaps: Admin dictionary authoring/review UI and authenticated mutation endpoints belong to later operations/Admin work；this task intentionally exposes only an internal application service rather than an insecure public write route；SEARCH-005 owns full rebuild/catch-up/validation/atomic alias switching、SEARCH-006 owns relevance evaluation/dashboard and `WEB-001` is next in the mandatory Gate 3 implementation sequence；production popularity and latency claims require observed Beta traffic；PR #36 evidence-head run `30491148630`、protected merge `30be880` and final-main run `30491653244` subsequently passed

## WEB-001 — 公开列表、详情与筛选页面

Task: WEB-001 公开列表、详情与筛选页面

Changed: Added locale-aware SSR list、city landing、detail and search pages for Jobs、Rentals、Transfers、Marketplace and Services；added validated GET filters、taxonomy options、localized status/advertising/verified labels、honest empty/error/cursor-expired states、canonical detail redirects and responsive desktop/mobile presentation；added an anonymous bounded API client with strict public response parsing、no Cookie forwarding、bot-marked SSR search traffic and a safe canonical-list fallback only for compatible first-page requests；added a synthetic test-only API fixture and production standalone desktop/mobile browser journeys

Contracts: Public OpenAPI remains 68 paths / 163 schemas / 78 operationIds and generated REST types are unchanged；added strict Zod runtime response adapters for public Listing、Search and Taxonomy payloads so unknown owner/private fields fail closed；route input continues to use the existing Search contract

Migrations: None；Prisma schema、PostgreSQL and all 27 migrations are unchanged；rollback removes the Web routes/components/adapters and restores the prior navigation targets without changing canonical or derived data

Security: SSR calls are anonymous and never forward browser Cookie or authorization state；API base URLs are restricted to HTTP(S)、redirects are disabled、responses are capped at 1 MiB and time out after five seconds；strict response allowlists reject owner/moderation/contact/object-key extras；body and attributes render as escaped text with bidirectional isolation；invalid/duplicate filters、malformed UUID paths、cursor expiry and dependency failures return bounded generic states without reflecting provider detail；canonical fallback never exposes its incompatible cursor

Tests run: Root `pnpm ci:quality` passed workflow/governance/runtime/container/seed/migration/OpenAPI/format/Prisma checks、9 workspace typechecks、9 lints、73 passed / 25 explicitly service-skipped files with 357 passed / 83 skipped tests、8 production builds and 55.53% statements / 58.27% lines；Contracts passed 10 files / 44 tests and Web passed 7 files / 27 tests；architecture checker passed 101 tasks / 60 Prisma models / 68 OpenAPI paths / 163 schemas / 36 JSON files；API request-ID/W3C trace/RED metric/canonical OpenAPI runtime check passed；production standalone Chromium desktop/mobile passed 22/22 including SSR list/detail/filter、sponsored/status/verified labels、invalid recovery and horizontal-overflow checks；in-app visual QA inspected list and detail layouts；PR #37 run `30494055315` passed 98/98 files and 440/440 tests including real PostgreSQL、OpenSearch、Redis、ClamAV、73.21% statements / 76.90% lines、8 Linux builds、API runtime、Linux Chromium 22/22 and four non-root image health checks

Not run: Real PostgreSQL、OpenSearch、Redis and ClamAV integrations plus four-image smoke were unavailable locally because this Windows host has no Docker CLI and no disposable `DATABASE_INTEGRATION_URL`；the local suites reported all 83 service skips rather than treating them as passes；PR #37 run `30494055315` supplied and passed every corresponding real-service、Linux Chromium and container check

Observability: No new production metric was added；existing API HTTP RED/tracing and Search fixed-cardinality metrics cover the anonymous requests；SSR uses a bot User-Agent so server rendering does not enter popularity samples，and no query、cursor、Listing ID、filter、Cookie or provider detail is logged by the Web adapter

Docs: Updated README、information architecture、SEO/i18n/accessibility、security/privacy、performance/reliability、testing、operations、acceptance criteria、route catalog、reference implementation、changelog、Gate checklist/status、Backlog and generated architecture book

Known gaps: `WEB-002` owns the real-data homepage composition；`SEO-001` owns the complete canonical/hreflang/structured-data/sitemap slice；`SEO-004` owns full automated/manual accessibility certification；`PERF-001` owns production cache and performance budgets；messages、contact reveal、reporting and later commercial actions remain in their ordered Gate tasks；production domain、brand assets and traffic/SLO evidence still require project-owner and Beta inputs；PR #37 evidence-head run `30494632057`、protected merge `6532c81` and final-main run `30495144658` subsequently passed

## TAX-003 — 首页布局配置版本

Task: TAX-003 首页布局配置版本

Changed: Added a strict ten-kind homepage layout definition with per-kind source allowlists、stable unique slot keys、bounded limits/TTL and mandatory enabled-ad disclosure；added locale/region-scoped optimistic drafts、preview、publication and rollback-as-new-version application/Store/Repository boundaries；persisted canonical current state plus immutable version history；made publish/rollback atomically append a minimized `homepage.layout.published` invalidation event；seeded identical structural zh-Hans/en-US version 1 definitions without real content or fabricated business metrics

Contracts: Public OpenAPI remains 68 paths / 163 schemas / 78 operationIds；replaced the loose homepage JSON Schema and matching Zod contract with strict discriminated unions that reject unknown fields、arbitrary HTML/URL/query data、unverified business/provider source flags and undisclosed enabled ads；Prisma grows from 60 to 62 models with `HomepageLayoutState` and `HomepageLayoutVersion`；Database runtime exports the dedicated repository subpath

Migrations: Added forward-safe migration `20260730090000_homepage_layout_versions` with locale/region/current-version checks、one-draft uniqueness、content-hash/publication/provenance constraints、scope/version indexes、restricted FK and published-row update/delete triggers；all 28 migrations pass static safety scanning；`ROLLBACK.md` documents application rollback、append-only content recovery and exceptional physical removal after writers/readers/events are drained。Rollback never moves the canonical pointer backward or rewrites history

Security: Every layout/slot/source object is strict and bounded；arbitrary HTML、script、external URL、SQL/query expression、object key、contact/PII and unknown fields are rejected；enabled ads require disclosure and business/provider modules require verified-only；scope row locks plus expected current version/draft revision prevent lost updates，including stale writes to an absent scope without leaving orphan state；published rows are immutable at the database layer；Outbox events contain only scope/version/hash/operation/time and no configuration body or PII；future Admin mutations still require MFA、recent authentication、Policy、audit and rate limiting

Tests run: Contract targeted typecheck/lint/test passed 11 files / 48 tests；API targeted typecheck/lint/test passed 32 files / 193 tests with 2 explicit OpenSearch skips；Database targeted typecheck/lint/test passed 5 files / 17 tests with 22 integration files / 81 tests explicitly skipped without a disposable local database；seed validation passed 12 strict slots；Prisma validate/generate and migration safety passed 28 migrations；root `pnpm ci:quality` passed workflow/governance/config/container/seed/migration/OpenAPI/format/Prisma checks、9 workspace typechecks、9 lints、75 passed / 26 explicitly service-skipped files with 364 passed / 86 skipped tests、8 production builds and 55.02% statements / 57.70% lines；architecture checker meta-validated JSON Schemas、validated the actual homepage seed against its Draft 2020-12 schema and passed 101 tasks / 62 Prisma models / 68 paths / 163 schemas / 36 JSON files；API request-ID/W3C trace/RED/OpenAPI runtime passed；production standalone Chromium desktop/mobile passed 22/22。The initial targeted run correctly exposed an unsafe matcher lint and an unavailable prebuild Contracts runtime import in Database seed validation；both were fixed before the complete green run

Not run: Real PostgreSQL lifecycle/trigger/outbox tests、Redis、OpenSearch、ClamAV and local four-image smoke are unavailable because this Windows host has no disposable `DATABASE_INTEGRATION_URL` or Docker CLI；the local full suite reports all 86 service skips instead of treating them as passes。The protected GitHub workflow must supply fresh/upgrade PostgreSQL and every real service plus Linux Chromium and four non-root images before merge

Observability: Publication and rollback reuse the durable Outbox dispatcher、retry、terminal failure and oldest-age telemetry with fixed event type `homepage.layout.published`；event payload is deliberately minimized and consumer-safe under duplicate delivery。No new production metric is claimed before `WEB-002` adds the cache consumer；configuration body、content/asset keys、actor IDs、region codes and hashes are excluded from metric labels and application logs

Docs: Updated domain/data、API/integrations、UI/design system、security/privacy、performance/reliability、observability、testing、operations、acceptance criteria、homepage component map、reference implementation、Gate checklist/status、Backlog、README、SECURITY、changelog、generated architecture book and this worklog

Known gaps: `WEB-002` owns the public `GET /v1/homepage` aggregate、per-module canonical readers、module error isolation、cache consumer/invalidation metric and honest no-data rendering；authenticated Admin authoring/review endpoints and UI remain a later operations slice and must use this service rather than exposing the Repository；production TTL/SLO claims require observed Beta traffic；PR #38 run `30496917730` passed 101/101 files and 450/450 tests including the three real PostgreSQL homepage lifecycle/immutability cases、28-migration fresh deploy、26-migration prior-baseline upgrade with sentinel、42 baseline negatives、73.08% statements / 76.77% lines、8 Linux builds、API runtime、22/22 Linux Chromium and four non-root image health checks；evidence-head run `30497442795`、protected squash merge `29a7d06` and final-main run `30497890894` subsequently passed

## WEB-002 — 首页模块化与真实数据 API

Task: WEB-002 首页模块化与真实数据 API

Changed: Added the anonymous `GET /v1/homepage` application/controller boundary and strict public module union；composed only published allowlisted Hero copy、privacy-safe Search trends、active CITY taxonomy and current-region canonical public Listings；isolated dependency failures per module and omitted honest empty/unimplemented modules；replaced homepage mock statistics、business/provider/review/ad/price content with bilingual Server Component rendering and recovery states；registered duplicate-safe Redis layout invalidation in the existing Worker；added contract/API/Web/Worker/E2E coverage and completed the Database runtime build include exposed by production startup

Contracts: OpenAPI grows from 68 paths / 163 schemas / 78 operationIds to 69 / 177 / 79 with strict locale/region/device query、no-store success、400/503 Problem Details and four discriminated module variants；generated TypeScript and Zod runtime contracts are synchronized；Prisma/schema/database tables do not change

Migrations: None；no canonical data structure or historical row changes。The existing 28 migrations and rollback documents remain unchanged and passed safety/Prisma validation

Security: Controller delegates to application and Store ports；Web sends one anonymous bounded request without Cookie forwarding；Homepage Listing reads enforce region scope plus existing PUBLISHED/unexpired canonical policy and remove exact coordinates、body、contact、moderation/risk and internal counts；trending retains the five-source threshold plus read-time sensitive-query filtering；unknown query/module fields fail closed；unimplemented business/provider/ad/metric/commerce kinds stay hidden；module/provider errors and PII are not reflected or logged；Outbox envelopes are validated and Redis invalidation accepts only locale/region/version while remaining safe under duplicate or out-of-order delivery

Tests run: Contract/API/Web/Worker/observability targeted suites passed；homepage/API/OpenAPI targeted run passed 3 files / 27 tests；OpenAPI lint and generated-file check passed；root `pnpm ci:quality` passed 22 workflow commands、18 governance rules、runtime/config/container contracts、seed validation、28-migration safety、OpenAPI/format/Prisma checks、9 workspace typechecks、9 lints、80 passed / 26 explicitly service-skipped files with 381 passed / 86 skipped tests、8 production builds and 56.18% statements / 58.93% lines；built API observability runtime passed request ID、W3C trace、RED and canonical OpenAPI JSON/YAML；architecture check passed 101 tasks / 62 models / 69 paths / 177 schemas / 36 JSON files；production standalone Chromium desktop/mobile passed 22/22。The first complete lint correctly found one obsolete import；the first built runtime then exposed a missing Database `tsconfig.build` include and stale runtime contract counts；the first E2E run found an ambiguous search-role assertion after adding the Hero search。All three were fixed and the corresponding complete checks passed

Not run: Real PostgreSQL、OpenSearch、Redis and ClamAV integration suites plus four-image smoke are unavailable locally because Docker CLI、`DATABASE_INTEGRATION_URL` and `OPENSEARCH_INTEGRATION_URL` are absent；the local suite reports all 86 service skips instead of treating them as passes。Protected GitHub CI must supply fresh/upgrade PostgreSQL、real services、Linux Chromium and four non-root images before merge

Observability: Added `socal_homepage_modules_total{kind,outcome}` with fixed HERO/HOT_SEARCHES/CITY_CHIPS/LISTING_FEED and success/empty/unavailable labels；added `socal_homepage_cache_invalidations_total{outcome}` with invalidated/stale/failed only；HTTP RED continues to cover `/v1/homepage`。No query、scope、layout/module key、version/hash、Listing/user ID、content or provider error enters labels

Docs: Updated README、SECURITY、API/integrations、performance/reliability、observability、operations、acceptance criteria、homepage component map、reference implementation、changelog、Gate checklist/status、Backlog and regenerated the 31-chapter architecture book

Known gaps: `SEO-001`/`SEO-002` own production canonical、hreflang、robots、structured data and sitemap；`PERF-001` owns shared CDN/Redis response caching、request coalescing and measured Web/API budgets，so the current response deliberately remains no-store despite bounded module cache metadata；business/provider/review/ad/price/commerce homepage modules remain hidden until their ordered canonical domains exist；production brand assets、traffic/SLO evidence and provider accounts still require project-owner/Beta inputs；PR #39 run `30500065008` passed 106/106 files and 467/467 tests including real PostgreSQL/OpenSearch/Redis/ClamAV、28-migration fresh deploy、26-migration prior-baseline upgrade with sentinel、42 baseline negatives、73.89% statements / 77.62% lines、8 Linux builds、API runtime、22/22 Linux Chromium and four non-root image health checks；evidence-head run `30500526588`、protected squash merge `f0726df` and final-main run `30500952462` subsequently passed

## SEO-001 — Metadata/canonical/hreflang/robots

Task: SEO-001 Metadata/canonical/hreflang/robots

Changed: Added one bounded bilingual SEO metadata builder and fail-closed locale/origin helpers；made the homepage、five public vertical roots、operator-approved city aggregates and safe public Listing details emit absolute canonical、true `zh-Hans`/`en-US`/`x-default` alternates、Open Graph/Twitter and explicit robots policy；made arbitrary query/filter/cursor URLs canonicalize without query and remain noindex；loaded real city names and public detail title/summary/time through strict anonymous API readers；made placeholder catchall pages bilingual and noindex；added deployment-driven Web robots and all-disallow Admin robots

Contracts: Public OpenAPI remains 69 paths / 177 schemas / 79 operationIds；Prisma remains 62 models；no API、generated contract、JSON Schema or database shape changes。`SEO_INDEXABLE_CITY_ROUTES` is a bounded comma-separated deployment allowlist of exact `<vertical>:<city-slug>` pairs and defaults empty

Migrations: None；no database state changes or data rollback required。Application rollback removes the metadata/robots routes and environment allowlist；removing a city token immediately restores `noindex,follow` after deploy without deleting canonical content

Security: Canonical paths are code-generated same-origin paths；`PUBLIC_WEB_URL` accepts only credential-free HTTP(S) and strips path/query/hash，while invalid production configuration forces otherwise indexable pages to noindex；city allowlist rejects the complete configuration on any invalid/oversized token；metadata text uses NFKC、removes control/bidi and HTML-like tags and applies code-point limits；Listing body、PII、contact、exact location、moderation/risk and unknown fields never enter metadata；search/private/Admin crawler rules do not replace existing backend authentication or authorization

Tests run: Web targeted test/type/lint passed 8 files / 36 tests；Admin targeted test/type/lint passed 4 files / 10 tests；root `pnpm ci:quality` passed workflow/governance/runtime/container/seed/migration/OpenAPI/format/Prisma checks、9 workspace typechecks、9 lints、81 passed / 26 explicitly service-skipped files with 387 passed / 86 skipped tests、8 production builds and 56.48% statements / 59.31% lines；architecture checker passed 101 tasks / 62 Prisma models / 69 paths / 177 schemas / 36 JSON files；built API observability runtime passed request ID、W3C trace、RED and canonical OpenAPI JSON/YAML；production standalone Chromium desktop/mobile passed 24/24 with actual title/canonical/hreflang/robots/Open Graph/Twitter/Web+Admin robots assertions。The first production run correctly exposed that `test:e2e:ci` consumes an existing build；after rebuilding，a second run exposed static robots Host capture，which was fixed by making that route runtime-dynamic；the final complete run passed

Not run: Real PostgreSQL、OpenSearch、Redis and ClamAV integration suites plus four-image smoke are unavailable locally because Docker CLI、`DATABASE_INTEGRATION_URL` and `OPENSEARCH_INTEGRATION_URL` are absent；the local suite reports all 86 service skips instead of treating them as passes。Protected GitHub CI must supply fresh/upgrade PostgreSQL、real services、Linux Chromium and four non-root images before completion

Observability: No new high-cardinality logs or metrics；metadata generation does not log origin、path、query、title、summary、city、Listing/user ID or provider errors。Search Console/index coverage、soft-404、duplicate canonical and structured-data monitoring remain launch/SEO operations work rather than fabricated local evidence

Docs: Updated README、SECURITY、SEO/i18n/accessibility、testing、operations、acceptance criteria、route catalog、changelog、implementation sequence、Gate checklist/status、environment example and regenerated the 31-chapter architecture book

Known gaps: `SEO-002` owns schema.org and real-resource sitemap partitioning；`SEO-003` owns complete message/routing/i18n and document-language baseline；`SEO-004` owns axe/manual WCAG evidence；`PERF-001` owns caching and measured performance budgets。Production brand/domain ownership and the first approved city/content list still require project-owner/Growth/Ops input；the allowlist therefore remains empty outside the synthetic E2E runtime。PR #40 run `30502653322` passed 107/107 files and 473/473 tests including real PostgreSQL/OpenSearch/Redis/ClamAV、28-migration fresh deploy、26-migration prior-baseline upgrade with sentinel、42 baseline negatives、73.95% statements / 77.75% lines、8 Linux builds、API runtime、24/24 Linux Chromium and four non-root image health checks；evidence-head run `30503181356`、protected squash merge `148a547` and final-main run `30503597873` subsequently passed

## PERF-001 — Web/API 缓存与性能预算

Task: PERF-001 Web/API 缓存与性能预算

Changed: Added one strict anonymous homepage Redis response-cache port/adapter with shared deterministic Contracts keys、bounded size/TTL、scope validation、poison deletion and canonical fail-open；coalesced same-scope API and Web SSR misses and cached only complete non-empty public responses；made the Worker invalidator reuse the same encoded cache identity；added bounded shared CDN headers；added sampled first-party Web Vitals reporting through the existing same-origin BFF and one transient rate-limited API collector；enforced production Web chunk、homepage HTML and transferred JavaScript budgets in CI and Chromium

Contracts: Public OpenAPI grows from 69 paths / 177 schemas / 79 operationIds to 70 / 181 / 80 with strict `POST /performance/web-vitals` metric/route/value input、202 no-store acceptance、400 and 429 Problem Details；`GET /homepage` now declares either the exact 30-second anonymous shared-cache policy or `no-store`。Generated TypeScript、strict Zod contracts and contract/runtime count assertions are synchronized；Prisma、JSON Schema and canonical database shape do not change

Migrations: None；no canonical data structure or migration changes。Application rollback removes the reader/writer and restores `no-store` while Worker deletion of `socal:homepage:v1:*` remains safe because Redis is rebuildable derived state；PostgreSQL layout history and Listings are never rewritten

Security: Cache identity binds locale、encoded region and device；values are capped at 1 MB、strictly parsed and rejected on scope mismatch、partial state、invalid TTL or unknown fields；Redis failure never bypasses canonical policy and provider detail is neither reflected nor logged；Web does not forward Cookie and never stores partial/empty responses；RUM accepts only five metric names、six fixed route classes and finite bounded values，omits URL/query/identifier/user agent/cookie/free text，uses a random-process HMAC of the client address only for a 120/minute transient quota and never exports it；telemetry cannot trigger billing、account、ad or risk decisions

Tests run: Targeted Contracts/API/Web/Worker/observability suites passed 9 files / 52 tests；OpenAPI lint/generated check、CI workflow check、format check and architecture checker passed against 101 tasks / 62 Prisma models / 70 paths / 181 schemas / 36 JSON files；root `pnpm ci:quality` passed 23 workflow commands、18 governance rules、runtime/config/container/seed/migration/OpenAPI/format/Prisma checks、9 workspace typechecks、9 lints、84 passed / 27 explicitly service-skipped files with 402 passed / 88 skipped tests、8 production builds and 57.08% statements / 59.90% lines；production build budget passed 16 chunks with largest 84,379 / 100,000 gzip bytes and total 295,459 / 500,000；built API runtime passed request ID、W3C trace、RED/Web Vital and canonical OpenAPI JSON/YAML；production standalone Chromium desktop/mobile passed 26/26 including homepage HTML and transferred-JavaScript budgets。The architecture check correctly exposed the initial stale 180-schema expectation；the actual four new schemas produce 181 and all current assertions/docs were corrected before the complete green run

Not run: Real Redis cache round-trip/expiry/poison integration、PostgreSQL、OpenSearch and ClamAV suites plus four-image smoke are unavailable locally because Docker CLI and disposable service URLs are absent；the local full suite reports all 88 service skips instead of treating them as passes。Protected GitHub CI must supply fresh/upgrade PostgreSQL、real Redis/OpenSearch/ClamAV、Linux Chromium and four non-root images before completion

Observability: Added `socal_homepage_cache_operations_total{outcome}` with fixed hit/miss/coalesced/stored/bypassed/failed outcomes；added `socal_web_vital_duration_seconds{metric,route}` and separate `socal_web_vital_cls_ratio{route}` bounded histograms；existing HTTP RED covers the collector and homepage。No cache key、locale、region、path/query、IP/hash、resource/user identifier、content or provider error enters labels or application logs

Docs: Updated README、SECURITY、API/integrations、performance/reliability、observability/analytics、testing/quality、operations runbook、acceptance criteria、reference implementation、runtime environment example、changelog、CI contract、status and regenerated the 31-chapter architecture book

Known gaps: Production CWV p75 and API p95/SLO claims require a representative Beta traffic window and real dashboards rather than local synthetic evidence；`SEO-002` still owns sitemap/schema.org、`SEO-004` owns full automated/manual accessibility evidence，and later `PERF-002` owns load/endurance/fault-injection validation。PR #41 first run `30505228487` correctly failed only after all quality/Linux E2E checks passed because the new Worker runtime dependency was absent from its image；the Dockerfile and container contract were repaired，then protected run `30505661335` passed 111/111 files and 490/490 tests including real PostgreSQL/Redis/OpenSearch/ClamAV and Redis cache TTL/poison cleanup、28-migration fresh deploy、26-migration prior-baseline upgrade with sentinel、42 baseline negatives、74.25% statements / 78.04% lines、8 Linux builds、16-chunk performance budget、API runtime、Linux Chromium 26/26 and four non-root image health checks；evidence-head run `30506224452`、protected squash merge `b7aa02e` and final-main run `30506611538` subsequently passed

## SEO-002 — 结构化数据与 sitemap 分片

Task: SEO-002 结构化数据与 sitemap 分片

Changed: Added strict same-origin schema.org builders/renderer for canonical homepage `WebSite/SearchAction`、visible `BreadcrumbList` and current complete Job-only `JobPosting`；added dynamic `/sitemap.xml` plus locale static and locale/vertical/published-month Listing shards；paged the existing canonical anonymous Listing projection、removed future/expired rows、deduplicated stable IDs、validated approved active cities、published truthful month `lastmod` and advertised the real index from Web robots

Contracts: Public OpenAPI remains 70 paths / 181 schemas / 80 operationIds；Prisma remains 62 models；generated Contracts、JSON Schema and canonical database shape do not change。The new Web XML routes are crawler representations over the existing strict anonymous `GET /listings`/Region contracts，not a second business API or fact source

Migrations: None；no database、index or durable sitemap state changes。Application rollback removes the JSON-LD/routes and robots declaration；PostgreSQL Listings、Region taxonomy and OpenSearch are untouched。If scale later requires a derived manifest，it must be rebuildable and reviewed before the current 10,000-source-record fail-closed budget is reached

Security: Production structured data requires a trusted credential-free HTTP(S) `PUBLIC_WEB_URL` and clean indexable route；exact-key runtime Schema rejects extra nodes/fields and cross-origin URLs，while script serialization escapes `<`、`>`、`&` and line separators。Job schema uses only visible bounded summary/employer/employment/city fields，never body contacts、exact address、owner-only/unknown attributes、risk/moderation、inferred salary or rating。Sitemap reads only strict PUBLISHED canonical summaries、rechecks `publishedAt <= now < expiresAt`、validates active allowlisted cities and excludes search/query/private/BFF/health/Admin routes；source/URL/XML budget、cursor loop、API/origin failure returns no-store 503 without truncation or provider detail

Tests run: Targeted Web homepage/listing/sitemap/structured-data suites passed 3 files / 28 tests；architecture checker passed 101 tasks / 62 Prisma models / 70 OpenAPI paths / 181 schemas / 36 JSON files；root `pnpm ci:quality` passed 23 workflow commands、18 governance rules、runtime/config/container/seed/migration/OpenAPI/format/Prisma checks、9 workspace typechecks、9 lints、85 passed / 27 explicitly service-skipped files with 411 passed / 88 skipped tests、8 production builds and 57.85% statements / 60.72% lines；16-chunk Web budget passed largest 84,379 / 100,000 and total 295,459 / 500,000 gzip bytes；built API runtime passed request ID、W3C trace、RED/Web Vital and canonical OpenAPI JSON/YAML；production standalone Chromium desktop/mobile passed 26/26 and actually parsed WebSite/Breadcrumb JSON-LD、robots sitemap、12 real fixture partitions and canonical static/Listing XML。The first full quality run correctly failed four E2E `no-unsafe-return` lint findings；the browser parse result was narrowed to `unknown` without weakening lint，then the complete gate passed

Not run: Real PostgreSQL、Redis、OpenSearch and ClamAV integration suites plus four-image smoke are unavailable locally because Docker CLI and disposable service URLs are absent；the local full suite reports all 88 service skips instead of treating them as passes。Protected PR run `30508293320` supplied those checks；the evidence-head and merged-main runs remain pending

Observability: Sitemap responses add bounded `Server-Timing` and entry-count headers；failures log only fixed `seo.sitemap_generation_failed` plus `static|listing|index` scope。No URL、locale、month、cursor、Listing/user ID、content、origin or provider error enters logs/metrics。Search Console rich-result/index coverage remains an operations input，not fabricated local evidence

Docs: Updated README、SECURITY、SEO/i18n/accessibility、testing、operations runbook、acceptance criteria、route catalog、changelog、implementation sequence、Gate checklist/status and regenerated the 31-chapter architecture book

Known gaps: PR #42 protected run `30508293320` passed 112/112 files and 499/499 tests including real PostgreSQL、Redis、OpenSearch and ClamAV；28-migration fresh deploy、26-migration prior-baseline upgrade after 2 prior migrations with sentinel preservation、42 baseline negatives、74.54% statements / 78.39% lines、8 Linux builds、16-chunk performance budget、API runtime、Linux Chromium 26/26 and four non-root image health checks passed。Evidence-head run `30604847032`、protected squash merge `f9507c2` and final-main run `30605241894` subsequently passed the same complete quality and four-image gates。The canonical list API has no date predicate，so the initial generator intentionally fails at 10,000 source records、200 cursor pages or 15 seconds per vertical rather than silently omitting URLs；before that threshold，add a reviewed canonical month query or rebuildable manifest and full reconciliation。Production domain/brand ownership、approved city/content list and Search Console/rich-result results still require project-owner/Growth/Ops inputs；`SEO-004` is now the active Gate 3 P0 exit task

## SEO-004 — 可访问性自动/人工基线（自动化完成，人工证据待补）

Task: SEO-004 可访问性自动/人工基线

Changed: Added fixed `@axe-core/playwright` 4.12.1 production-browser WCAG 2.2 AA coverage for homepage、public list/detail、Rental form initial/error、private account and Admin boundaries；made the locale layout provide one bilingual skip link and every current Web `<main>` provide a unique focusable target；repaired ordinary-text/button contrast、mobile search accessible name、24px error-summary targets、forced-colors focus and reduced-motion behavior；added an explicit AA evidence/gap register

Contracts: Public OpenAPI remains 70 paths / 181 schemas / 80 operationIds；Prisma remains 62 models；generated Contracts、JSON Schema、database and public API shapes do not change。The new `test:a11y`/`test:a11y:ci` scripts are repository test contracts，not runtime endpoints

Migrations: None；no database or durable state changes。Application rollback removes the CSS/landmark/name fixes and test dependency only；there is no data rollback

Security: Tests run only against loopback production standalone apps and synthetic `example.invalid`/fixed UUID fixtures；they do not submit real accounts、PII or provider data。Skip targets and ARIA relationships do not replace backend authorization；private/Admin pages remain noindex/no-store。A Windows Narrator attempt stopped before input because the automation layer could not establish browser-URL confidence，so no unsafe UI action or false pass was recorded

Tests run: Targeted Web test passed 10 files / 50 tests；Web typecheck/lint/build and test TypeScript passed；architecture checker passed 101 tasks / 62 Prisma models / 70 OpenAPI paths / 181 schemas / 36 JSON files；`pnpm test:a11y:ci` passed 8/8 Desktop Chrome + Pixel 7 cases with zero axe WCAG 2.0/2.1/2.2 A/AA violations、skip/focus、form error relationships、24px targets、320 CSS px reflow、forced colors and reduced motion；root `pnpm ci:quality` passed 23 workflow commands、18 governance rules、runtime/config/container/seed/migration/OpenAPI/format/Prisma checks、9 workspace typechecks、9 lints、85 passed / 27 explicitly service-skipped files with 411 passed / 88 skipped tests、8 production builds and 57.85% statements / 60.72% lines；16-chunk Web budget passed largest 84,379 / 100,000 and total 295,481 / 500,000 gzip bytes；built API runtime passed request ID、W3C trace、RED/Web Vital and canonical OpenAPI JSON/YAML；full production standalone Chromium passed 34/34 across desktop/mobile

Not run: Real PostgreSQL、Redis、OpenSearch and ClamAV suites plus four-image smoke remain unavailable locally because Docker CLI and disposable service URLs are absent；the local full suite reports 88 service skips rather than calling them passes。Actual Narrator/Edge speech output and interactive 200% browser zoom were attempted but not completed because Windows Computer Use stopped on browser-URL confidence before applying input；those two human checks remain required

Observability: No runtime logs、metrics or tracing added；axe selectors and failure artifacts remain local/CI test evidence and are not emitted by the product。No URL、query、form value、account or identifier is added to telemetry

Docs: Added `docs/accessibility-baseline.md` with exact tool/scope/result/gap matrix；updated README、SEO/accessibility、testing、acceptance criteria、changelog、status and regenerated the 31-chapter architecture book

Known gaps: PR #43 protected run `30607163890` passed 112/112 files and 499/499 tests with zero skips against real PostgreSQL、Redis、OpenSearch and ClamAV；coverage was 74.55% statements、78.40% lines、77.57% functions and 66.29% branches。Linux Chromium passed 34/34 including the 8 new accessibility checks，and all Web、Admin、API and Worker non-root image readiness checks passed。`A11Y-001` Narrator/Edge speech and `A11Y-002` actual 200% browser zoom remain Gate 3 blockers；`SEO-004` stays todo、the Gate checklist stays unchecked and PR #43 stays draft until both have real results。Future message/payment/video and complete document-language/i18n templates cannot inherit the current zero-violation claim and must enter their own task matrix

## EVT-002 — 队列 DLQ/replay/reconciliation 工具

Task: EVT-002 队列 DLQ/replay/reconciliation 工具

Changed: Added PostgreSQL-backed Admin jobs、job items and terminal queue dead-letter evidence；implemented privacy-minimized union listing for failed Outbox and queue records、actor/type/key-bound replay batches、dry-run reconciliation jobs、bounded worker leases and idempotent item/job completion；made Worker terminal failures store fixed error codes and canonical payload hashes only，and made replay validate the exact queue envelope against the canonical Outbox event before retry or rebuild；added a bilingual Admin recovery workspace with explicit confirmation、stable retry keys and read-only auditor behavior

Contracts: OpenAPI grows from 70 paths / 181 schemas / 80 operationIds to 74 / 188 / 84 with strict dead-letter list、replay batch、reconciliation run and aggregate job-progress endpoints；generated TypeScript and strict Zod contracts are synchronized。Prisma grows from 62 to 65 models with additive `AdminJob`、`AdminJobItem` and `QueueDeadLetter` plus bounded enums and indexes；public controllers still delegate through application services and repository ports

Migrations: Added forward-safe migration `20260801010000_queue_operations_control_plane` with three additive tables、three enums、unique idempotency and scheduling indexes、lifecycle/count/hash/error-code constraints and restrictive actor/item foreign keys。Roll-forward is the preferred recovery；documented rollback first stops Admin queue operations and workers，drains or exports audit evidence as required，then drops only the new tables/enums。No existing canonical Outbox row or Redis/OpenSearch derived state is deleted or rewritten

Security: Read access requires an active MFA-bound `PLATFORM_ADMIN` or `READ_ONLY_AUDITOR` session；replay/reconciliation requires `PLATFORM_ADMIN` plus recent MFA。Idempotency is bound to actor、operation type and key under a PostgreSQL advisory transaction lock；changed payloads conflict and already-pending queue targets fail closed。Responses、logs and audit metadata omit payload、aggregate ID、payload hash、raw provider error and PII；failure codes are allowlisted/fallback-normalized；replay accepts only canonical Outbox data with deterministic envelope/hash verification and remains safe under duplicate delivery、stale lease and retry

Tests run: Targeted Contracts/API/Admin/Worker tests passed locally；root `pnpm ci:quality` passed workflow/governance/runtime/container/seed/migration/OpenAPI/format/Prisma checks、9 workspace typechecks、9 lints、89 passed / 28 explicitly service-skipped files with 433 passed / 91 skipped tests、8 production builds and the 16-chunk performance budget。Architecture checker passed 101 tasks / 65 Prisma models / 74 OpenAPI paths / 188 schemas / 36 JSON files。Protected PR #44 run `30723998056` then passed 117/117 files and 524/524 tests with real PostgreSQL、Redis、OpenSearch and ClamAV，74.34% statements / 78.17% lines / 76.91% functions / 66.19% branches，fresh/upgrade migration and constraint checks，8 Linux builds，built API runtime contracts，Linux Chromium 34/34 and all four non-root Web/Admin/API/Worker images。The prior run `30723552034` correctly failed on two nondeterministic integration fixtures；cleanup was changed to actor-scoped foreign-key-safe deletion and listing transition time now derives from the persisted timestamp。Evidence-head run `30724386396` then exposed that Prisma 7 proxy clients cannot be reliably detected with `instanceof PrismaClient`，so the advisory lock did not always cover the whole replay creation transaction；the repository now uses the same `$transaction` capability detection as the other transactional repositories，and this final head must pass the same protected gate before handoff

Not run: Local real-service integration was not run because disposable PostgreSQL、Redis、OpenSearch and ClamAV endpoints and Docker are unavailable；the local runner reported all 91 service skips instead of treating them as passes。Local production Playwright executed 34/34 browser cases successfully but its Windows process wrapper required forced child cleanup and therefore was not claimed as a clean local command pass；the protected Linux 34/34 result is the completion evidence

Observability: Added `socal_queue_admin_operations_total{operation,outcome}` with fixed bounded labels for listing、replay、reconciliation、claim and completion；Worker terminal failure logs contain only fixed queue/event/error classifications and existing request/trace correlation，never payload、aggregate identity、hash、PII or provider text。Admin actions emit durable AuditLog rows and job progress is exposed only as aggregate counts

Docs: Updated README、SECURITY、domain/data model、performance/reliability、security/privacy、observability、testing、operations runbook、acceptance criteria、Admin console、reference implementation、changelog、implementation sequence、migration rollback guidance、Backlog、Gate checklist、status and this worklog；regenerated the 31-chapter architecture book after chapter changes

Known gaps: PR #44 remains draft and stacked on `codex/seo-004` until its parent is resolved；`SEO-004` still requires real Narrator/Edge speech and interactive 200% zoom evidence，so Gate 3 remains open。`SEARCH-005` owns full index rebuild/alias switching and later `PRIV-001` consumes reconciliation for privacy workflows；neither is silently included in this slice。Production incident ticket conventions、retention approvals and operator staffing remain deployment inputs rather than fabricated code defaults

## SEARCH-005 — 全量重建与 alias 切换

Task: SEARCH-005 全量重建与 alias 切换

Changed: Added a durable PostgreSQL-backed search rebuild control plane with actor/type/key/hash-bound creation、one-active-operation locking、bounded Worker leases and explicit phases；implemented deterministic alias-free candidate creation、canonical Listing backfill、outbox catch-up、exact public ID/version count plus rolling-digest validation、atomic read/write alias switching、observation-window dual writes and retained-source rollback；added recent-MFA Admin rebuild/status/rollback endpoints and strict generated contracts

Contracts: OpenAPI grows from 74 paths / 188 schemas / 84 operationIds to 77 / 192 / 87 with strict Admin rebuild create/status/rollback contracts；generated TypeScript and Zod contracts are synchronized。Prisma grows from 65 to 66 models with additive `SearchIndexOperation`、bounded phase/job enums and operation/lease/idempotency indexes；controllers continue to authorize、validate and delegate without direct Prisma access

Migrations: Added forward-safe migration `20260801030000_search_index_rebuild_control_plane` with one additive operation table、two enum additions、bounded phase/count/hash/index-name constraints and partial active/scheduling indexes。Roll-forward is preferred；documented rollback first stops rebuild dispatch and dual writes、finishes or exports audit evidence as required，then drops only the new operation table/enums。No canonical Listing、Outbox record or physical OpenSearch index is deleted；candidate/source index cleanup remains a separately approved operation

Security: Mutations require active recent-MFA `PLATFORM_ADMIN`，while status read permits only recent-MFA Admin/auditor roles。PostgreSQL advisory locks and request hashes reject conflicting retries or simultaneous rebuilds；leases and phase transitions are duplicate-delivery safe；mapping validation and expected-source alias preconditions fail closed before switch。Responses、logs、metrics and audit fields omit Listing/user IDs、query/cursor、digest、raw provider error and PII；only bounded phase/outcome/error codes and aggregate counts are exposed

Tests run: Targeted database/API/contracts/Worker suites passed during implementation；root `pnpm ci:quality` passed workflow/governance/runtime/container/seed/migration/OpenAPI/format/Prisma checks、9 workspace typechecks、9 lints、92 passed / 30 explicitly service-skipped local test files with 448 passed / 93 skipped tests、8 production builds and the Web performance budget。Architecture checker passed 101 tasks / 66 Prisma models / 77 OpenAPI paths / 192 schemas / 36 JSON files；built API runtime check passed request ID、W3C trace、RED/Web Vital and canonical OpenAPI JSON/YAML。Protected PR #45 run `30727688616` passed 122/122 files and 541/541 tests against real PostgreSQL、Redis、OpenSearch and ClamAV，fresh/upgrade migration and constraints，8 Linux builds，16-chunk Web budget at largest 84,732 / 100,000 and total 295,932 / 500,000 gzip bytes，API runtime，Linux Chromium 34/34 and all four non-root Web/Admin/API/Worker images。Earlier runs correctly exposed and led to fixes for the clean-checkout Vitest database subpath alias and stale API-runtime/Playwright OpenAPI scale assertions

Not run: Local real-service integration and four-image smoke were unavailable because Docker CLI and disposable service URLs are absent；the 93 local service skips were reported rather than treated as passes。A two-case local Playwright retry reached both desktop/mobile cases but its Windows child-service teardown stalled and was explicitly terminated，so only the clean protected Linux 34/34 result is completion evidence。Production-scale shard sizing、Beta-volume duration/SLO claims and a live production alias exercise are not fabricated from CI fixtures

Observability: Added `socal_search_rebuild_operations_total{phase,outcome}` with fixed bounded labels；phase logs preserve request/trace correlation and fixed operation/index/error classifications without payload、query、cursor、digest、Listing/user identity、PII or provider text。Every create/switch/failure/rollback transition emits durable audit evidence and aggregate operation progress is exposed only through the protected Admin status projection

Docs: Updated README、SECURITY、system/search/security/testing/operations/Admin/acceptance/reference chapters、runtime environment example、CHANGELOG、implementation sequence、migration rollback guidance、Backlog、Gate checklist、status and this worklog；regenerated the 31-chapter architecture book after chapter changes

Known gaps: PR #45 remains draft and stacked on `codex/evt-002` until its parent chain is resolved；`SEO-004` still requires real Narrator/Edge speech and interactive 200% zoom evidence，so Gate 3 remains open。Physical stale-index retention/cleanup must follow the documented operator approval window；production index sizing、traffic-derived freshness and rollback timing require Beta evidence。Later `REL-003` consumes this workflow for disaster-recovery automation and `LAUNCH-001` uses it after consented cold-start imports；neither is silently included here

## SEARCH-006 — 相关性评估集和 Dashboard

Task: SEARCH-006 相关性评估集和 Dashboard

Changed: Added a versioned synthetic bilingual corpus with 8 public Listing projections、16 reviewed Chinese/English queries and graded judgments；implemented strict dataset parsing plus NDCG@10、MRR、Recall@10 and zero-result evaluation overall and per locale；wired the same Worker index definition and API OpenSearch adapter into a real-service ranking regression；added bounded locale search metrics and a versioned search-quality Grafana dashboard。The protected run exposed that OpenSearch `_source` subfield filtering omits an empty `attributes` array；the adapter now maps only that omitted `undefined` case to the contract-safe empty object while retaining fail-closed behavior for explicit null or malformed projections

Contracts: Public OpenAPI remains 77 paths / 192 schemas / 87 operationIds；Prisma remains 66 models and no database/API shape changes。The internal Prometheus metric `socal_search_queries_total` adds the fixed `locale=zh-Hans|en-US` label。The new `schemas/search-relevance.schema.json` and `datasets/search-relevance/v1.json` are repository evaluation contracts validated by the architecture checker

Migrations: None；no canonical or derived durable state changed。Rollback removes the evaluator、fixture、dashboard and locale metric label，or reverts the adapter handling；no PostgreSQL/OpenSearch data migration or destructive cleanup is required

Security: The corpus is explicitly synthetic and the runtime/schema validators reject duplicate/unknown references、control/bidi characters and contact-like content。Metrics and dashboard expressions expose only bounded locale/outcome/dependency labels and aggregate counts/latencies；they exclude query text、cursor/PIT、filters、coordinates、amounts、Listing/user identity and provider errors。Search response parsing still rejects explicit null、oversized、duplicate-key or malformed attributes and never expands the public `_source` allowlist

Tests run: Targeted API evaluator/adapter suites passed 10 tests with the one real OpenSearch test explicitly skipped locally。Root `pnpm ci:quality` passed workflow/governance/runtime/container/seed/migration/OpenAPI/format/Prisma checks、9 workspace typechecks、9 lints、94 local files with 457 passed / 94 explicitly service-skipped tests、8 production builds and the 16-chunk Web performance budget at largest 84,734 / 100,000 and total 295,836 / 500,000 gzip bytes。Protected PR #46 run `30729427713` passed architecture checks at 101 tasks / 66 Prisma models / 77 OpenAPI paths / 192 schemas / 39 JSON files；125/125 files and 551/551 tests against real PostgreSQL、Redis、OpenSearch and ClamAV，including the bilingual real OpenSearch threshold test；coverage was 74.51% statements、78.40% lines、77.39% functions and 66.30% branches；8 Linux builds、Web budget at largest 84,732 / 100,000 and total 295,932 / 500,000、built API runtime、Linux Chromium 34/34 and all four non-root Web/Admin/API/Worker image health checks passed

Not run: The local architecture checker could not start because this Windows environment has no Python 3；the equivalent protected checker passed。Local disposable PostgreSQL、Redis、OpenSearch and ClamAV integration plus four-image smoke were unavailable because Docker/service endpoints are absent；all 94 local skips were reported rather than called passes。Production traffic relevance/SLO evidence and a provisioned production dashboard were not fabricated from CI fixtures

Observability: Added `locale` to the bounded search query counter and a versioned dashboard covering zero-result ratio by locale、request p95、query volume、timeout/unavailable outcomes、index freshness and recovery failures。Offline relevance fixture scores deliberately remain test artifacts rather than production metrics，and dashboard contract tests reject query/identifier/contact leakage

Docs: Updated search ranking、observability、testing、acceptance、infrastructure observability and schema validation documentation；updated Backlog、Gate checklist、status and this worklog

Known gaps: PR #46 remains draft and stacked on `codex/search-005` until its parent chain is resolved；`SEO-004` still requires real Narrator/Edge speech and interactive 200% zoom evidence，so Gate 3 remains open。Production Grafana/Prometheus provisioning、data-source permissions、OpenSearch exporter integration、traffic-derived thresholds and alert routing remain `OBS-002`/operations inputs rather than fabricated completion evidence
