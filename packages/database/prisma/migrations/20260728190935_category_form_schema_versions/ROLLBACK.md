# TAX-002 category form schema version migration

## Roll forward

This additive migration creates immutable category form schema version records, adds conservative
search/visibility metadata to materialized category fields, and stamps every existing Listing with
baseline schema version `1`. Deploy it before the TAX-002 application and run the versioned seed so
every development category receives a published version `1`.

## Application rollback

Redeploy the previous application and retain the additive table and columns. The previous
application ignores form schema history and the Listing version stamp; the published-row trigger
only protects the new table. Do not remove the trigger or history during incident response.

## Database rollback

Physical rollback is intentionally not an online operation. After all new application instances,
seed jobs, and taxonomy writers are stopped, back up `category_form_schema_versions` and
`category_fields`, then remove the trigger/function, version table, and only the newly added
columns. Dropping `listings.form_schema_version` loses the link needed to validate old drafts, so
prefer a corrective roll-forward migration. Restoring the feature requires replaying version
history from the backup; seed data can reconstruct development version `1` only, not production
operator edits.
