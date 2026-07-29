# ORG-002 rollback / roll-forward

This migration is additive but introduces organization membership invariants and durable invitation/transfer evidence.

Preferred recovery is roll forward:

1. stop invitation and membership mutations;
2. leave the deferred owner triggers enabled;
3. repair invalid invitation lifecycle rows or retry the application deployment;
4. resume writers only after every organization has at least one `OWNER`.

Application rollback may stop the new endpoints and Worker consumer while retaining the tables, templates, audit rows and Outbox events. Existing organization reads remain compatible with the additive membership columns.

Physical rollback is exceptional. In a reviewed stopped-writer window, export invitation, transfer, AuditLog, Outbox and notification evidence; remove the two owner triggers and function; delete the two version-1 organization invitation templates only if no notification references them; drop the invitation/transfer tables; remove membership `version`/`updated_at`; then drop `OrganizationInvitationStatus`. Never remove the owner trigger while membership writers are active.
