# TAX-001 taxonomy alias migration

## Roll forward

This additive migration creates `region_aliases` and `category_aliases`, their lookup/uniqueness
indexes, and cascading foreign keys to the existing canonical taxonomy rows. Deploy the migration
before the TAX-001 application. The seed command then upserts deterministic alias IDs and reconciles
only aliases attached to its development seed taxonomy.

## Application rollback

The previous application does not read or write either table, so it can be redeployed without a
database rollback. Retain the additive tables during incident response; they do not alter existing
Region, Category, Listing, or profile rows.

## Database rollback

Only after all TAX-001 application instances and seed jobs are stopped, take a backup and drop
`category_aliases` followed by `region_aliases`. Both tables contain derived taxonomy lookup terms,
so rebuilding them from the versioned seed/import source is preferred to restoring stale aliases.
The migration does not modify canonical Region or Category data.
