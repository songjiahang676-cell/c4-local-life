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
