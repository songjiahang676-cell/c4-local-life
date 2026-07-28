# Changelog

## Unreleased

- Added shared strict TypeScript, typed ESLint, and Prettier configuration for every workspace.
- Replaced placeholder lint commands in Worker and shared packages with real ESLint checks.
- Added validated API and Worker runtime configuration with fail-fast startup, secret-safe summaries, and recursive log redaction.
- Added runtime configuration documentation, executable validation checks, and API/Worker environment-aware development commands.
- Fixed the production API startup path by adding the Fastify static asset integration required by Swagger UI.
- Added four hardened non-root application container targets, Compose application services, process health endpoints, and CI image-build enforcement.
- Added a shared Vitest 4 project configuration for all eight workspaces, React Testing Library DOM setup, typed/linted foundation tests, V8 coverage, and JUnit/JSON CI reports.
- Added the PostgreSQL/PostGIS baseline migration for all 36 Prisma models, schema-represented spatial/trigram/partial indexes, check constraints, repeatable empty-database verification, and migration recovery notes.
- Added the API HTTP foundation with sanitized request IDs, strict DTO/query validation, RFC 9457 Problem Details, configurable body limits, credentialed CORS allowlisting, and cookie-mutation origin enforcement.
- Added a vendor-neutral observability package with structured PII-redacted logs, bounded Prometheus RED/worker metrics, and W3C OpenTelemetry trace propagation across API requests and Worker jobs.
- Added a validated PostGIS Listing repository with bounded radius queries, safe public projections, extension/trigram checks, and real PostgreSQL integration coverage.
- Added validated, deterministic development seeds and fictional test factories, including idempotent PostgreSQL coverage and a production-environment safety guard.
- Added a guarded PostgreSQL repository integration harness with automatic transaction rollback, no-leak failure tests, and an explicit non-skipping test command.
- Made the canonical OpenAPI 3.1 document the source for Swagger JSON/YAML serving, added Redocly CI linting, schema examples, and implementation response contract tests.
- Added deterministic OpenAPI-to-TypeScript generation with CI drift detection, generated-type-constrained Zod adapters, and removed the duplicate hand-authored Nest request DTOs.
- Added migration destructive-SQL policy checks and a disposable previous-baseline upgrade test that proves synthetic existing data survives all newer migrations.
- Added a pinned Playwright/Chromium desktop-and-mobile baseline that boots production Web/API builds on isolated ports, validates localized homepage and API security smoke behavior, and retains CI reports.
- Expanded CODEOWNERS and the pull request template across contracts, migrations, security, idempotency, tests and observability, with an executable CI governance contract and explicit role-alias mapping requirements.
- Made the architecture checker repeatable after dependency/bootstrap output exists by selecting an available Python 3 runtime, excluding generated/dependency trees, and safely allowing an explicitly ignored local `.env`.
- Fixed clean-checkout Vitest resolution for `@socal/contracts` and prevented an upstream test failure from being obscured by a secondary missing-Playwright-artifact error.
- Accepted a 12-month free launch period and deferred, opt-in automatic wallet top-up behind Gate 5 contracts, safety controls and an explicit commercialization flag.
- Fixed clean-container Prisma generation by supplying a non-secret build-only datasource URL and installing OpenSSL in the build base; the container contract now prevents regression.
- Added hosted runtime-image smoke coverage that verifies the non-root user and readiness of Web, Admin, API and Worker; the API image now includes its contracts workspace dependency.
- Recorded the fully green hosted Gate 0 quality/container run and the verified GitHub Free private-repository branch-protection limitation without weakening the merge policy.
- Published the repository with explicit owner authorization, enforced protected-branch checks for administrators, and proved the policy using a closed failing negative-control PR.
- Added database-backed opaque sessions with domain-separated HMAC storage, atomic rotation/revocation, absolute and idle expiry, request auth context, hardened host-only cookies, and current-session contract coverage.
- Added PostgreSQL-backed email/SMS OTP challenges with one-time consumption, account/IP/device rate limits, device binding, generic anti-enumeration errors, provider isolation, and secure session establishment.
- Added concurrency-safe self-profile management, signed cursor session-device listing, user-scoped single/all-session revocation, and database-enforced revocation after account state changes.
- Added a fail-closed Actor/RequestContext/Policy framework with declarative controller actions, PII-minimized request actors, resource owner/organization rules, and reusable authorization matrix tests.
- Added atomic organization-plus-OWNER creation, membership-scoped organization reads, signed OWNER/ADMIN member pagination, and a fail-closed five-role action matrix.
- Added bilingual Region/Category trees, FK-constrained normalized aliases, active-only public taxonomy filters, and idempotent alias seed/migration coverage.
- Added immutable versioned category form schemas with optimistic drafts, atomic publish/materialization, append-only rollback, historical Listing validation, private contact-field controls, and a cacheable public read contract.

## 0.1.0 — Architecture handoff package

- Added complete product, system, data, API, security, DevOps, testing, and delivery architecture.
- Added Codex execution contract and implementation backlog.
- Added an implementation-ready monorepo scaffold (dynamic build validation remains a Gate 0 task) for web, admin, API, worker, contracts, database, UI, and configuration.
- Added reference homepage concept image, seed taxonomy, OpenAPI contract, JSON Schemas, Mermaid diagrams, and local infrastructure.
