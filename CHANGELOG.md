# Changelog

## Unreleased

- Added a bilingual private account overview and shared capability-aware account shell with one
  bounded in-memory no-store Session snapshot, focus/visibility/expiry revalidation, fail-closed
  invalidation, localized minimal organization summaries, and responsive accessible navigation
  that exposes only implemented server-advertised capabilities while leaving API authorization
  authoritative.
- Added versioned, bounded Listing duplicate detection for pg_trgm text, deterministic media dHash
  and domain-separated contact fingerprints, with dry-run/enforcement modes, immutable candidate
  evidence, minimal bilingual moderator review, and idempotent confirmed/false-positive metrics.
- Added a private bilingual Listing management center with draft/pending/published/archived
  buckets, expiry-aware counts, account-bound signed cursors, organization-aware reads, strong
  versioned archive/delete batches capped at 20, partial-failure feedback, noindex/no-store
  boundaries, and safe draft editing from the exact account resource.
- Added immutable Listing submission/edit revisions with normalized redacted snapshots and diffs,
  owner-only revision history, exact-retry published edits, conservative minor-versus-major
  classification, mandatory re-review for material changes, and original publication-window
  preservation so approval cannot grant a free renewal.
- Added Listing-only abuse reports with per-user quotas, concurrent active-target deduplication,
  immutable redacted evidence, MFA/recent-auth moderator decisions, 30-day owner appeals,
  independent-reviewer enforcement, atomic removal/restoration evidence and bilingual in-app
  outcome notifications.
- Added the Transfer, Secondhand and Service verticals from bilingual/mobile schema-driven drafts
  through coherent detail persistence, submission/moderation, safe public reads and duplicate-safe
  expiry, including financial disclaimers, prohibited-goods routing and owner-only license data.
- Added the Job vertical from bilingual/mobile schema-driven draft through submit/moderation,
  approved public list/detail and duplicate-safe expiry, with coherent wage persistence, explicit
  employment-policy acknowledgement, conservative policy-risk routing and PII-minimized evidence.
- Added short-lived organization invitations, canonical recipient notifications, conditional member
  role/removal APIs, deferred database enforcement of at least one Owner, and MFA recent-auth Owner
  transfer with atomic Audit/Outbox evidence and exact retry behavior.
- Added immutable bilingual in-app notification templates, strict idempotent Listing-event
  projection, private cursor-paginated read APIs, bounded observability, and a responsive
  bilingual noindex notification center with account isolation and idempotent read state.
- Added the complete public Rental lifecycle: approved-only safe list/detail projections, signed
  filter-bound compound cursors, conditional idempotent archive/soft-delete, transactional
  Audit/Outbox evidence, and a bounded `SKIP LOCKED` expiry Worker with metrics.
- Added the bilingual, keyboard-efficient Listing moderation workbench with priority/SLA queue,
  immutable redacted submission snapshots, first-submission diffs, rule/media/publisher evidence,
  current moderator-role and MFA enforcement, recent-auth actions, strong ETags, actor-scoped
  idempotency, and atomic immutable Action/Audit/Outbox writes.
- Added versioned Listing submission risk rules, owner-scoped conditional/idempotent submission,
  low-risk auto-publication, medium/high moderation queues, immutable rule-hit evidence, and
  transactional Audit/Outbox state changes.
- Added the bilingual/mobile Rental dynamic form, debounced account-scoped autosave recovery,
  strict same-origin Web BFF, owner-safe media status polling, and atomic READY media binding.
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
- Added owner-scoped, idempotent media upload intents with serialized count/byte quotas, checksum-bound five-minute S3/MinIO PUTs, opaque private quarantine keys, and verification-document fail-closed handling.
- Added an independent no-store Admin shell, same-origin allowlist BFF, auditable expiring platform-role grants, server-computed RBAC navigation, generic 401/403 boundaries, and a fail-closed MFA gate that exposes no privileged data or writes.
- Added Admin TOTP enrollment, one-time recovery codes, replay-resistant verification, failure lockouts, short MFA sessions, recent-auth step-up policy, and an accessible bilingual MFA gate.
- Added optional scrypt password authentication with dedicated peppering, generic anti-enumeration failures, persisted lockouts, cooldown recovery, one-time hashed proofs, all-session revocation, audit evidence, and notification ports.
- Added a transactional PostgreSQL outbox dispatcher with atomic `SKIP LOCKED` claims, leases, bounded exponential retries, event-id BullMQ idempotency, terminal failure state, queue-envelope limits, graceful shutdown, oldest-age metrics, and real database/Redis integration coverage.
- Added owner-verified media completion and a lifecycle-versioned processing Worker with bounded S3 reads, exact hash/magic-byte verification, real ClamAV streaming, Sharp decode/orientation/metadata stripping, three deterministic encrypted WebP variants, transactional READY/REJECTED Outbox events, and clean-signature hosted integration enforcement.
- Added a pure five-type Listing domain model with discriminated detail invariants, integer-minor-unit price rules, separate content/moderation states, optimistic-versioned transitions, bounded publication expiry, and exhaustive illegal-transition tests.
- Added PostgreSQL-backed public, owner and scoped-moderator Listing projections with query-bound object authorization, exact historical form-schema visibility filtering, fail-closed malformed JSON handling, and PII leakage integration tests.
- Added database-backed Listing draft create/owner-read/conditional-update APIs with actor-scoped exact idempotency, current organization-role authorization, strong ETags, exact historical attribute validation, and atomic minimized Audit/Outbox evidence.

## 0.1.0 — Architecture handoff package

- Added complete product, system, data, API, security, DevOps, testing, and delivery architecture.
- Added Codex execution contract and implementation backlog.
- Added an implementation-ready monorepo scaffold (dynamic build validation remains a Gate 0 task) for web, admin, API, worker, contracts, database, UI, and configuration.
- Added reference homepage concept image, seed taxonomy, OpenAPI contract, JSON Schemas, Mermaid diagrams, and local infrastructure.
