# MEDIA-002 rollback

Roll forward by deploying the completion endpoint and Worker only after this additive lifecycle/variant migration is
applied. Existing `UPLOADING` rows remain valid with lifecycle version zero.

Application rollback disables `POST /media/{mediaId}/complete` and the `media.upload.completed` consumer first. Retain
`media_assets`, `media_variants`, lifecycle timestamps and rejection evidence. READY variants remain safe re-encoded
objects; SCANNING rows can be retried after the corrected Worker is deployed.

Physical rollback is exceptional. Stop upload completion, media consumers and all readers, export lifecycle/variant
rows, and remove processed objects through the controlled object manifest. Then drop the processing index and
`media_variants`, remove the eight additive `media_assets` columns and five checks, and finally drop
`MediaVariantKind`. Prefer a corrective forward migration because removing these fields destroys security evidence.
