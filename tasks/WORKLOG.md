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
