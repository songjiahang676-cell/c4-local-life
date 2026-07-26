## Task

- Backlog ID:
- User/business outcome:
- Dependencies completed:
- Scope intentionally excluded:

## Change

- Main files/modules:
- API/contract impact:
- Database schema/migration/backfill:
- Feature flag:
- Localized/mobile/SEO/accessibility impact:

## Risk

- Authorization/object ownership/tenant boundary:
- PII/privacy/upload/security abuse:
- Failure/idempotency/concurrency:
- Payment/ledger/webhook impact:
- Rollback or roll-forward:

## Verification

Check only commands that actually ran. Put unavailable or intentionally omitted checks under **Not run**.

- [ ] `bash scripts/check-architecture.sh`
- [ ] `pnpm install --frozen-lockfile --strict-peer-dependencies`
- [ ] `pnpm openapi:lint` and `pnpm openapi:check`
- [ ] `pnpm format:check`
- [ ] `pnpm db:validate`
- [ ] `pnpm db:migrate:safety`, deploy/upgrade/baseline checks when migrations change
- [ ] `pnpm typecheck`
- [ ] `pnpm lint`
- [ ] `pnpm test`
- [ ] `pnpm build`
- [ ] Targeted authorization/abuse/contract/repository tests
- [ ] Targeted E2E/accessibility/performance tests when applicable
- [ ] Required `Quality Gate` check is green
- [ ] Required `Build non-root application images` check is green

Actual commands/results:

Not run and reason:

## Screenshots / API examples / migration evidence

## Documentation and observability

- Docs/ADR updated:
- Logs/metrics/traces/alerts:
- Known gaps:

## Reviewer gates

- [ ] API changes update OpenAPI first and include contract/drift coverage, or API is unchanged.
- [ ] Data changes include Prisma, forward-safe migration, tests and rollback/roll-forward notes, or data is unchanged.
- [ ] Security/privacy/authorization and abuse cases were reviewed at the backend boundary.
- [ ] Queue/payment/refund/promotion/webhook writes are idempotent and auditable, or are not in scope.
- [ ] User-visible changes cover Chinese/English, mobile, accessibility, SEO, empty and error states, or are not in scope.
- [ ] No `.env`, secret, real PII, production data, build output or fabricated production metrics were added.
