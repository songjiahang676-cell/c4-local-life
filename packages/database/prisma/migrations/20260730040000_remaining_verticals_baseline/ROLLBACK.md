# Transfer, Secondhand, and Service baseline recovery

This additive migration constrains the three remaining vertical detail tables and adds rebuildable
partial expiry indexes. It does not rewrite Listing or detail data.

- Roll forward: deploy before enabling these posting flows, then verify valid detail persistence,
  invalid detail rejection, public projection, and concurrent expiry polling for every vertical.
- Application rollback: disable Transfer, Secondhand, and Service creation/listing and redeploy the
  prior API/Web/Worker while retaining the constraints and indexes. Rental and Job remain available.
- Physical rollback, only before production traffic in a reviewed maintenance window: stop all
  affected writers and expiry pollers; drop the three `listings_*_expiry_due_idx` indexes, then drop
  the five constraints added here. Preserve Listings, details, AuditLog, Outbox, and moderation
  evidence. Prefer a corrective roll-forward after release.
