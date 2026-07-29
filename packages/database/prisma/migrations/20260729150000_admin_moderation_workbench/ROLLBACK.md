# ADMIN-002 migration recovery

This migration is forward-safe: it adds a case version, immutable listing-review snapshots and nullable
idempotency evidence on existing moderation actions. Existing listing-submission cases are backfilled from
canonical PostgreSQL data; sensitive dynamic attributes are intentionally redacted in that compatibility
snapshot.

## Application rollback

1. Stop Admin moderation action writes.
2. Roll the API/Admin applications back to the previous release.
3. Keep the new table, columns, indexes, constraints and triggers in place. The previous release ignores them,
   while retained snapshots/actions remain useful audit evidence.
4. Roll forward with a corrected build. Do not delete or rewrite moderation evidence as an operational rollback.

## Exceptional pre-production physical removal

Only when the environment has no retained moderation cases/actions and has been explicitly approved for reset:

1. Drop triggers `moderation_actions_immutable` and `moderation_case_snapshots_immutable`.
2. Drop `moderation_case_snapshots`, its foreign key/indexes, and
   `reject_moderation_workbench_evidence_mutation()`.
3. Drop the moderation-action unique index/check, then remove `idempotency_key` and `request_hash`.
4. Drop the moderation-case version check and `version`.

Production recovery is roll-forward only because snapshots and actions are security/audit evidence.
