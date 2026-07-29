# LIST-004 media binding rollback

## Roll forward

Keep the additive nullable `media_assets.listing_id` and `sort_order` columns, disable media
selection in the Listing application service, and deploy a corrected binding implementation.
Existing private assets remain owner-scoped and READY variants remain private.

## Exceptional physical rollback

Only while Listing writes and media workers are stopped:

1. verify no release depends on Listing media bindings;
2. export `media_assets.id`, `listing_id`, and `sort_order` for recovery;
3. drop `media_assets_listing_binding_check`;
4. drop `media_assets_listing_id_sort_order_idx`;
5. drop `media_assets_listing_id_fkey`;
6. drop `listing_id` and `sort_order`.

Never delete media objects or variants as part of this rollback. Restore by reapplying the
migration and replaying the exported bindings after verifying every asset is owner-authorized,
`LISTING_MEDIA`, `IMAGE`, and `READY`.
