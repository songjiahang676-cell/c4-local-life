# Search index rebuild control-plane rollback

This migration is additive. The safe application rollback is to stop the search rebuild dispatcher,
disable the search-operation Admin endpoints, and deploy the previous application while retaining
`search_index_operations` and its `admin_jobs` rows as audit evidence. Existing OpenSearch aliases
must be inspected before any application rollback; this migration does not change aliases itself.

Do not delete a physical OpenSearch index as part of a database rollback. If a rebuild already
switched aliases, use the recorded `source_index` and `target_index` to perform the documented atomic
rollback first, then verify PostgreSQL-to-index versions. For an exceptional physical database
rollback, confirm there are no `PENDING` or `RUNNING` search jobs, export both control-plane tables,
drop the two foreign keys and `search_index_operations`, then remove the added enum values only by
creating replacement PostgreSQL enum types during a maintenance window. Prefer a corrective
roll-forward migration because PostgreSQL enum value removal is not an online operation.
