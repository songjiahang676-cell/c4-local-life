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
8. `20260728190935_category_form_schema_versions` adds append-only dynamic form history,
   materialized field metadata, and the Listing schema-version stamp.
9. `20260728201500_media_upload_intents` adds owner-scoped, idempotent quarantine upload intents.
10. `20260728203000_admin_platform_roles` adds auditable, expiring platform-role grants for the
    independent Admin boundary.
11. `20260728221000_admin_mfa` adds encrypted TOTP enrollment, one-time recovery evidence, and
    MFA-bound sessions.
12. `20260728223000_password_recovery` adds optional password authentication, bounded attempts,
    and one-time recovery proofs.
13. `20260728234500_outbox_dispatcher_constraints` hardens Outbox state, attempts, and claim
    indexing.
14. `20260729003000_media_processing_lifecycle` adds scan/processing lifecycle evidence and safe
    variants.
15. `20260729010000_listing_draft_idempotency` adds owner-scoped Listing create retry evidence.
16. `20260729020000_listing_media_binding` adds atomic READY-media binding and stable order.
17. `20260729130000_listing_submission_moderation` adds versioned submission evaluations and rule
    hits.
18. `20260729150000_admin_moderation_workbench` adds immutable redacted Case snapshots, Case
    versions, and actor-scoped action idempotency.

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

## `20260728190935_category_form_schema_versions`

Adds one draft plus append-only published versions per Category. PostgreSQL enforces positive
versions/revisions, one unpublished draft, content-hash shape, and blocks direct update/delete of a
published row. Publishing or rollback changes `categories.form_schema_version` and replaces the
materialized `category_fields` in the same transaction. Existing Listings receive version `1`,
which is the only truthful baseline for pre-versioning drafts.

- Roll forward: deploy before the TAX-002 application, seed published version `1`, then verify
  draft revision conflicts, atomic publish/materialization, rollback provenance, immutable-row
  negative cases, and old-draft validation against its exact saved version.
- Rollback: redeploy the previous application and retain the additive schema/history. A physical
  rollback would sever old Listing validation provenance and therefore requires a backup,
  stopped writers, and a reviewed maintenance plan. See the migration-local `ROLLBACK.md`.

## `20260728201500_media_upload_intents`

Adds owner-scoped `media_assets` metadata for private quarantine upload intents. PostgreSQL enforces
opaque `quarantine/<shard>/<uuid>/original` keys, lowercase SHA-256/request hashes, positive bounded
size, owner foreign keys and unique `owner + idempotency_key`. The application holds an owner
advisory transaction lock while evaluating exact retry and quotas.

- Roll forward: deploy before enabling `POST /media/uploads`, provision the configured bucket with
  public access blocked, and verify signed checksum/length/MIME headers plus concurrent quota tests.
- Rollback: disable the route and let outstanding five-minute URLs expire while retaining metadata.
  Physical removal requires stopped writers, object cleanup from a backed-up manifest, and the
  migration-local `ROLLBACK.md`; corrective roll-forward is preferred.

## `20260728203000_admin_platform_roles`

Adds eight explicit platform roles and an append-only assignment table with grant/revocation
provenance, optional JSON-object scope, expiry and revocation coherence checks, and one current
grant per user/role. Session resolution reads only unrevoked, unexpired grants on every request;
role history is never copied into client-managed claims.

- Roll forward: apply before enabling `/admin/session`; grant roles only through a reviewed
  administrative workflow with a reason code and least-privilege scope. Verify ordinary users and
  inactive accounts receive 403 even if they present a valid session.
- Rollback: disable the Admin route and redeploy the previous application while retaining the
  additive enum/table. Do not drop grant history during incident response. See the migration-local
  `ROLLBACK.md` for the stopped-writer physical recovery sequence.

## `20260728221000_admin_mfa`

Adds explicit `PRIMARY` / `MFA` authentication strength to sessions, one encrypted TOTP credential
per user, and one-time recovery-code hashes. Database checks keep pending/active/disabled timestamps
coherent and bound failed attempts; repository transactions prevent replay of a TOTP time step or
recovery code and append minimized audit events.

- Roll forward: deploy before the Admin MFA routes, configure a dedicated `MFA_SECRET`, then verify
  primary-to-MFA session rotation, old-token rejection, replay races, lockout, audit minimization,
  and current platform-role enforcement.
- Rollback: disable the MFA routes and privileged Admin workspaces, redeploy the prior application,
  and retain additive credential/session metadata. Do not decrypt/export secrets or drop recovery
  evidence during incident response. See the migration-local `ROLLBACK.md`.

## `20260729010000_listing_draft_idempotency`

Adds nullable, paired `create_idempotency_key` and lowercase SHA-256 `create_request_hash` evidence
to Listing. Existing rows remain compatible with both values null; LIST-003-created drafts always
write both. PostgreSQL enforces the pair/shape and one key per creating owner, while an actor-scoped
advisory transaction lock serializes concurrent exact retries.

- Roll forward: apply before enabling database-backed `POST /listings`; verify exact retry,
  changed-payload conflict and same-key concurrency, including one audit and Outbox record.
- Rollback: disable the LIST-003 routes and retain the additive evidence. Physical removal loses
  retry provenance and requires stopped writers plus backup; see the migration-local `ROLLBACK.md`.

## `20260729020000_listing_media_binding`

Adds a nullable, single-Listing binding and stable order to private `media_assets`. The database
constraint permits a binding only for `LISTING_MEDIA` image assets already in `READY`; application
transactions additionally require current owner authorization, lock selected assets in UUID order,
reject cross-Listing reuse, and atomically synchronize the ordered set with the Listing version
write. Original and derivative object locations remain private and are not copied into Listing
payloads.

- Roll forward: apply before enabling media selection in draft create/update; verify owner READY
  attach, ordered replacement/removal, unready/foreign rejection and concurrent reuse.
- Rollback: disable media selection and retain nullable binding evidence. Exceptional stopped-writer
  physical removal is documented in the migration-local `ROLLBACK.md`.

## `20260729130000_listing_submission_moderation`

Adds immutable `moderation_evaluations` and `moderation_rule_hits` evidence, the versioned
`ModerationRiskTier` decision, actor-scoped submission idempotency, and a one-to-one link from a
medium/high-risk evaluation to its moderation case. Checks bind every risk tier to the only valid
resulting content/moderation state and keep hashes, rule codes and versions bounded.

- Roll forward: apply before enabling `POST /listings/{listingId}/submit`; verify exact retry,
  changed-request conflict, low-risk publication, high-risk escalation, case priority, immutable
  evidence, Audit and Outbox atomicity.
- Rollback: disable submission writes and retain evidence. Do not remove production moderation
  history; the migration-local `ROLLBACK.md` documents exceptional pre-production physical removal.

## `20260729150000_admin_moderation_workbench`

Adds a positive Case version, one immutable redacted snapshot per Listing submission Case, and
nullable paired idempotency/request-hash evidence for historical compatibility. Existing
medium/high Cases are backfilled from canonical Listings while dynamic attributes are replaced by
an empty object and exact coordinates are omitted. New Cases write a schema-aware redacted snapshot
inside the submission transaction. Snapshot/action triggers prevent UPDATE/DELETE; Case deletion is
restricted by snapshot evidence.

- Roll forward: apply before enabling moderation queue/detail/actions; verify the backfilled
  snapshot contains no dynamic contact fields or coordinates, then verify current-role/MFA access,
  exact retry/conflict, Case/Listing concurrency, Audit/Outbox atomicity, and immutable evidence.
- Rollback: disable the workbench and retain additive evidence. Do not remove moderation history in
  an incident; exceptional pre-production physical recovery is documented in the migration-local
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
