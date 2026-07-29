# Listing duplicate detection recovery

This additive migration stores keyed contact fingerprints, media perceptual hashes and immutable
duplicate-candidate evidence. It does not remove or rewrite Listing content.

- Roll forward: deploy before enabling duplicate detection, run the media processing and Listing
  submission integration suites, verify the Hamming-distance function, and confirm that candidate
  responses never expose contact fingerprints, raw contacts, object keys, scores or thresholds.
- Application rollback: disable candidate lookup and stop writing duplicate evidence, then redeploy
  the previous API and Worker. Existing media and Listing workflows ignore the nullable perceptual
  hash and additive tables. Retain candidate evidence and review outcomes for audit and false-positive
  analysis.
- Physical rollback is exceptional and only safe before production candidate traffic. Stop API and
  Worker writers; export evidence; drop the candidate triggers/functions, foreign keys, indexes and
  tables; drop the contact fingerprints table; drop the media check and nullable column. Prefer a
  corrective roll-forward because deleting review evidence weakens moderation auditability.
