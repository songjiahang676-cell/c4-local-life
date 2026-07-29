# Job vertical baseline recovery

This additive migration adds Job wage coherence checks, nonblank optional text checks, and a
rebuildable partial expiry index. It does not rewrite Listing or Job data.

- Roll forward: deploy before accepting Job drafts, then verify Job draft persistence, invalid wage
  range rejection, public visibility, and concurrent expiry polling.
- Application rollback: disable Job creation/listing and redeploy the prior API/Web/Worker while
  retaining the constraints and index. Rental behavior is unchanged.
- Physical rollback, only before production Job traffic in a reviewed maintenance window: stop Job
  writers and expiry pollers, drop `listings_job_expiry_due_idx`, then drop
  `job_details_text_fields_nonblank` and `job_details_wage_range_coherent`. Preserve Listings,
  Job details, AuditLog, Outbox, and moderation evidence. A corrective roll-forward is preferred
  after release.
