# LIST-003 draft idempotency rollback

This additive migration stores the actor-scoped idempotency key and canonical request hash used by
`POST /listings`. Existing Listings remain valid with both columns null; every draft created through
the LIST-003 application writes both values.

## Roll forward

1. Apply the migration before enabling database-backed Listing draft creation.
2. Verify exact retries return the original draft, while the same owner/key with a changed payload
   returns 409.
3. Verify concurrent same-key requests create exactly one Listing, audit row and Outbox event.
4. Keep the unique index and paired-evidence check enabled for every environment.

## Application rollback

Disable the LIST-003 create/update routes and redeploy the previous application. Retain both columns,
the check and the unique index; the previous application ignores them and retaining evidence is safe.

## Exceptional physical rollback

Physical removal is not part of normal incident response. If it becomes necessary, stop all Listing
writers, back up the Listing plus audit/Outbox evidence, confirm the previous application is deployed,
then drop the unique index and paired-evidence constraint before dropping both columns. This loses
retry provenance, so a corrective roll-forward is preferred.
