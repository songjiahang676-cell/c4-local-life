# Listing submission moderation rollback

This migration is forward-safe and additive. Deploy the application version that does not write submission
evaluations before any physical rollback.

Preferred roll-forward: correct rules or repository behavior in a new migration while preserving the immutable
evaluation and rule-hit evidence.

Physical rollback, only before production evidence exists:

1. Drop the two immutability triggers and `reject_moderation_evidence_mutation()`.
2. Drop `moderation_cases_evaluation_id_fkey`, its unique index, and `evaluation_id`.
3. Drop `moderation_rule_hits`, then `moderation_evaluations`.
4. Drop the `ModerationRiskTier` enum.

Never discard production moderation evidence merely to roll back application code. Export and retain it under
the audit retention policy first.
