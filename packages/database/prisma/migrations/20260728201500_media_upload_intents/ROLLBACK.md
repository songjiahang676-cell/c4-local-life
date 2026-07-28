# MEDIA-001 upload-intent migration

## Roll forward

This additive migration creates the private-media metadata and idempotency boundary used before an
object is uploaded to quarantine. Deploy it before enabling `POST /media/uploads`. The application
serializes quota checks per owner and writes only opaque quarantine keys; object-store bucket
policies remain infrastructure controls.

## Application rollback

Disable the media upload route or redeploy the prior application. Retain `media_assets` and the
`MediaPurpose` enum so already-issued presigned URLs and their audit metadata remain attributable.
Expire or revoke outstanding upload credentials through object-store policy if the rollback is
security-related.

## Database rollback

After all MEDIA-001 writers are stopped and outstanding presigned URLs have expired, back up
`media_assets`, delete any corresponding quarantine objects through the controlled object cleanup
workflow, then drop the table and `MediaPurpose` enum. Dropping the table first loses ownership,
hash and idempotency evidence, so a corrective roll-forward is preferred.
