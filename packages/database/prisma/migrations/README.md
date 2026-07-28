# Migration operations

## Baseline order

1. `0000_extensions` installs `pg_trgm` and `postgis` before any schema references their types or
   operators.
2. `20260725044311_baseline` creates the Prisma-managed tables, relations, and indexes, then applies
   the reviewed PostGIS generated column, spatial/trigram/partial indexes, and check constraints.
3. `20260725051500_region_group_type` adds the taxonomy region-group enum value.
4. `20260726041310_auth_session_lifecycle` adds required idle-expiry and last-seen timestamps.
5. `20260726044453_otp_challenges` adds short-lived, single-consumption OTP challenges and abuse
   indexes.
6. `20260728090000_account_management` adds optimistic profile versions and enforces session
   revocation after user status/deletion changes.
7. `20260728184415_taxonomy_aliases` adds FK-constrained, normalized lookup aliases for Regions and
   Categories.

The unsupported geography field and custom indexes are also represented in `schema.prisma`.
`prisma migrate diff --from-migrations ... --to-schema ... --exit-code` must remain empty so a later
development migration cannot silently remove them.

## Apply and verify

Use a dedicated empty database:

```bash
pnpm db:validate
pnpm db:generate
pnpm db:migrate:safety
pnpm --filter @socal/database exec prisma migrate deploy
pnpm --filter @socal/database exec prisma migrate status
pnpm db:upgrade:check
pnpm db:baseline:check
```

`db:baseline:check` verifies the completed migration records, extensions, generated geography,
custom indexes, check-constraint failures, and a foreign-key failure. Its fixture transaction is
always rolled back.

`db:migrate:safety` scans every migration for destructive schema/data operations. A reviewed
exception must use the exact form below and must describe both intent and recovery:

```sql
-- migration-safety: allow DROP_COLUMN reason="contract completed after two releases" rollback="restore from retained shadow column"
```

The directive does not make a migration safe by itself; it makes the risk visible to code review.
Unannotated drops, truncates, data updates/deletes, renames, `SET NOT NULL`, and required-column
additions fail CI.

`db:upgrade:check` creates a disposable database, applies migrations through
`prisma/compatibility/previous-release.json`, inserts a synthetic sentinel, applies every newer
migration, verifies the sentinel and current schema expectation, and drops the database. Update
the compatibility baseline only when a version is actually promoted; do not move it forward merely
to make a failing migration pass.

## `20260725051500_region_group_type`

Adds `REGION_GROUP` to `RegionType` so the delivered `US-CA-SOCAL` taxonomy node is represented
without misclassifying it as a county or city.

- Roll forward: deploy the additive enum migration before running `db:seed`.
- Rollback: application code can stop writing/reading `REGION_GROUP`, but PostgreSQL enum values
  are not removed in place. If removal ever becomes necessary, first migrate all affected rows to
  another reviewed type, then replace the enum in a separate maintenance migration. Do not attempt
  an unsafe down migration during an incident.

## `20260726041310_auth_session_lifecycle`

Adds `idle_expires_at` and `last_seen_at` as required fields. Existing sessions receive the
migration timestamp and intentionally become idle-expired, forcing one reauthentication after the
security-boundary deployment instead of silently granting a new idle lifetime.

- Roll forward: apply the additive migration before deploying the API that reads and refreshes the
  fields; verify current-session, rotation and logout integration tests.
- Rollback: the previous application ignores both columns, so roll back only the application and
  retain the additive schema. Do not drop columns during incident response. The one-time session
  invalidation is not reversed; users authenticate again, while user/profile data is unaffected.

## `20260726044453_otp_challenges`

Adds the OTP channel/purpose enums and an additive `otp_challenges` table. The code, IP, device and
destination lookup values use domain-separated keyed hashes; the contact destination remains
Confidential PII only for delivery and verified account binding. Challenges expire after ten
minutes and must be deleted or aggregated within 24 hours by the maintenance retention workflow.

- Roll forward: apply the additive migration before enabling `/auth/otp/request` and
  `/auth/otp/verify`; verify account/IP/device limits, failed-attempt caps, device binding and
  one-time consumption against PostgreSQL.
- Rollback: disable the OTP routes and retain the additive table/enums through the retention
  window. Do not drop the table during incident response. Existing sessions and user records are
  independent and remain valid.

## `20260728090000_account_management`

Adds a required profile `version` with a constant default and an `AFTER UPDATE` trigger that revokes
all unrevoked sessions whenever a user's status or soft-deletion marker changes. The trigger keeps
the authentication invariant intact even when a later Admin/deletion workflow owns the state
transition; it never exposes or copies token/IP hashes.

- Roll forward: apply before enabling `/me` profile updates or session-device management; verify
  stale ETags conflict, session identifiers stay user-scoped, and direct status/deletion changes set
  `revoked_at`.
- Rollback: roll back the application while retaining the additive version column and trigger. The
  previous application ignores `version`, and conservative session revocation remains safe. Do not
  drop either during incident response.

## `20260728184415_taxonomy_aliases`

Adds `region_aliases` and `category_aliases` with canonical-parent foreign keys, cascade cleanup,
per-parent/locale normalized uniqueness, and lookup indexes. Canonical names, IDs and slugs remain
on Region/Category; normalized alias values are derived lookup state.

- Roll forward: apply before the TAX-001 API or the versioned seed writes aliases; verify alias
  uniqueness, parent FK behavior, bilingual queries and idempotent seed reconciliation.
- Rollback: redeploy the previous application and retain the additive tables. If a later maintenance
  window requires physical removal, stop alias writers, back up, drop category aliases before region
  aliases, and rebuild them from the versioned source when rolling forward. See the migration-local
  `ROLLBACK.md`.

## Roll-forward and recovery

- Production migrations are forward-only. Correct a released migration with a new reviewed
  migration; never edit an already-applied production file.
- Back up and test restore before the first production baseline and before destructive changes.
- If deployment fails before application traffic, fix the cause and use Prisma's documented
  `migrate resolve` flow only after comparing the actual database state and migration logs.
- Do not drop `postgis` or `pg_trgm` during application rollback; extensions can be shared and their
  removal is destructive.
- For an empty disposable development database only, rollback means dropping and recreating that
  dedicated database, then replaying the migrations. Never apply that procedure to a database with
  user or audit data.
