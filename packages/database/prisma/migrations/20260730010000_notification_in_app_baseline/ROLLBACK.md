# In-app notification baseline recovery

This additive migration versions bilingual in-app templates and stores immutable rendered notification
snapshots linked to their source Outbox event.

- Roll forward: apply the migration before enabling Listing notification consumers, verify all sixteen
  published template rows, then run duplicate/out-of-order consumer and owner-scope API tests.
- Application rollback: stop Listing notification consumers and redeploy the prior API/Worker. Keep the
  additive tables, columns and notification history; older applications ignore them.
- Physical rollback is exceptional and pre-production only: stop all notification writers, export
  `notifications` and `notification_templates`, drop the template foreign key/indexes/constraints and
  additive notification columns, then drop the immutable trigger/function and template table. Prefer a
  corrective roll-forward migration after any shared-environment deployment.
