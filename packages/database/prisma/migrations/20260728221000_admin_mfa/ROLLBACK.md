# AUTH-005 MFA migration rollback / roll-forward

This migration is additive. Deploy it before enabling the Admin MFA endpoints. Existing sessions are
backfilled as `PRIMARY`, so deployment never grants MFA or privileged access.

Roll forward by disabling the new endpoints, correcting application code, and applying another
additive migration. If an application rollback is required, the old application safely ignores the
new tables and columns.

A destructive database rollback is only safe after the AUTH-005 application has been removed and
all MFA sessions have been revoked. In a reviewed maintenance window, drop
`mfa_recovery_codes`, then `mfa_credentials`, remove `auth_sessions.mfa_verified_at` and
`auth_sessions.authentication_strength`, and finally drop the two enums. Export encrypted
credential metadata and audit evidence first; never export decrypted TOTP secrets or plaintext
recovery codes.
