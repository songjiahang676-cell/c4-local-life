# Queue operations control-plane rollback

This migration is additive. The safe application rollback is to disable the queue-operations
Admin endpoints and Worker dispatcher, then deploy the previous application version while retaining
`admin_jobs`, `admin_job_items`, and `queue_dead_letters` as audit and incident evidence.

Do not drop these tables during an active queue incident. Before an exceptional physical rollback,
stop API and Worker writers, export the three tables with row counts and checksums, confirm no
`PENDING` or `RUNNING` job remains, then drop foreign keys, tables, and enums in reverse dependency
order. Restore from the evidence export or roll forward with a corrective migration if the rollback
must be reversed.
