# AUTH-004 rollback

Roll forward by deploying the application and this additive migration together. Existing users remain passwordless until
a valid recovery proof explicitly establishes a password.

Application rollback redeploys the previous release, removes the three password routes, and retains the additive columns,
attempt history, recovery hashes, and audit evidence. Revoke sessions for any account whose password changed during the
deployment window; do not clear hashes or recovery evidence to make an old binary appear compatible.

Physical rollback is exceptional: stop all auth writers, export the two AUTH-004 tables and affected user/audit rows,
verify that no password-authenticated session remains, drop the two foreign keys/tables/indexes, remove the user password
state constraints/columns, and finally drop `PasswordAuthAttemptOutcome`. Prefer a corrective forward migration.
