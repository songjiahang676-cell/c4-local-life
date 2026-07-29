# Listing revision workflow recovery

This additive migration introduces immutable Listing revision evidence and records the actual
pre-evaluation Listing/moderation state on future moderation evaluations.

- Roll forward: deploy before enabling published edits or resubmission. Verify revision hashes,
  before/after diffs, major-edit review routing, exact retries and immutable-row triggers against a
  disposable PostgreSQL database.
- Application rollback: disable published Listing edits and revision history reads, then redeploy
  the prior API. Existing draft submission remains readable because the evaluation columns have
  safe historical defaults. Retain revisions, evaluations, moderation cases, AuditLog and Outbox as
  review evidence.
- Physical rollback is exceptional and only safe before production revision traffic. Stop API and
  Worker writers; export revisions and affected evaluation/case rows; drop the immutable trigger,
  table foreign keys/indexes/table, added evaluation columns and enum in dependency order. Prefer a
  corrective roll-forward because deleting revision evidence can break moderation and dispute
  history.
