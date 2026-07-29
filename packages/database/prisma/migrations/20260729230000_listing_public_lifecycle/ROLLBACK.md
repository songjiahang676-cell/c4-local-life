# Listing public lifecycle recovery

This additive migration creates only the partial Rental expiry polling index.

- Roll forward: apply the migration before starting the `LISTING_EXPIRY_*` Worker poller, then
  verify the index is selected for due published Rentals and run the lifecycle integration tests.
- Application rollback: stop the expiry poller and redeploy the prior API/Worker. Retain the index;
  it does not alter canonical Listing data or constrain prior writers.
- Physical rollback, only in a reviewed maintenance window: stop expiry pollers and execute
  `DROP INDEX CONCURRENTLY IF EXISTS "listings_rental_expiry_due_idx"`. The index is rebuildable
  from canonical PostgreSQL rows. A corrective forward migration is preferred after release.
