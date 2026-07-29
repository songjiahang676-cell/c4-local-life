# Homepage layout version recovery

This additive migration creates scoped homepage layout state and immutable version history. A
publish or rollback appends an Outbox cache-invalidation event in the same transaction.

- Roll forward: deploy the migration before enabling layout authoring. Validate the delivered
  synthetic seed, draft revision conflicts, preview, publish, rollback-as-new-version, immutable
  history and Outbox cache invalidation against a disposable PostgreSQL database.
- Application rollback: stop layout authoring and deploy the prior API/Web versions. Leave the
  two tables and related Outbox events in place; they do not affect prior application reads.
- Correct a bad layout by rolling back through the application service. This copies a previously
  published definition into a new published version and emits a new invalidation event; it never
  moves the state pointer backward or edits history.
- Physical rollback is exceptional. Disable every layout writer and reader, drain
  `homepage.layout.published` events, export all published versions needed for audit/recovery, then
  remove the two triggers and functions, foreign key, version table and state table in dependency
  order. Prefer a corrective roll-forward because deleting history makes prior homepage behavior
  impossible to reproduce.
