# EVT-001 rollback

Roll forward by deploying the dispatcher after this additive constraint/index migration. Existing baseline outbox rows
must already satisfy the documented PENDING/PUBLISHED/FAILED state model; migration failure is a signal to quarantine and
repair inconsistent evidence rather than deleting it.

Application rollback stops the dispatcher and consumers first. PENDING events remain canonical PostgreSQL evidence and
can be dispatched after the corrected release; do not clear the table or mark events PUBLISHED by hand.

Physical rollback is exceptional: stop all outbox writers/dispatchers, export the affected rows, verify no repair depends
on the partial claim index, then drop `outbox_events_pending_available_id_idx` and the three EVT-001 check constraints.
The data and existing baseline columns remain intact. Prefer a corrective forward migration.
