# Report and appeal workflow recovery

This additive migration introduces report retry evidence, one active report per reporter/resource,
appeals, independent appeal cases, and bilingual notification-template versions.

- Roll forward: deploy before enabling report or appeal routes. Verify report deduplication,
  immutable snapshot hashes, moderator MFA checks, different-reviewer enforcement, and notification
  consumption against a disposable PostgreSQL database.
- Application rollback: disable report/appeal routes and their worker event handlers, then redeploy
  the prior API/Worker. Retain reports, appeals, moderation actions, snapshots, AuditLog, Outbox and
  delivered notifications as security evidence.
- Physical rollback is exceptional and only safe before production traffic. Stop API and Worker
  writers; export all new tables and affected moderation/report rows; drop the new foreign keys,
  indexes, columns, table and enum in dependency order. Published notification templates are
  intentionally immutable, so do not delete them in a live system. Prefer a corrective roll-forward.
