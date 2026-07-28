# ADMIN-001 platform-role migration

## Roll forward

Deploy the additive enum and assignment table before enabling `GET /v1/admin/session`. Existing
users have no platform role and therefore remain denied. Bootstrap assignments must be created
through an audited maintenance procedure with a reason code; this task does not expose a role
mutation API.

## Application rollback

Redeploy the prior API and Admin images. Retain `platform_role_assignments` so grants, revocations,
scope and attribution are not lost. Because the prior application does not read the table, retained
rows are inert.

## Database rollback

Prefer roll forward. If physical removal is unavoidable, first disable Admin access, revoke all
active assignments, export the table to the approved encrypted audit location, verify no later
migration references `PlatformRole`, then drop `platform_role_assignments` and the enum. Never
delete assignment history merely to remove access; revocation is the normal access-removal path.
