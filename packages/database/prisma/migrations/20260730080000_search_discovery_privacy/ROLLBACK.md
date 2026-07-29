# Search discovery privacy recovery

This additive migration introduces a singleton, append-only search dictionary lifecycle and
short-lived internal query samples. Samples contain only application-screened text and
HMAC-derived source identifiers; public reads still require the application anonymity threshold.

- Roll forward: deploy before enabling synonym expansion, suggestions, or trending searches.
  Verify dictionary publication/rollback, the five-source privacy threshold, daily source
  deduplication, bot/sensitive-query rejection, and retention pruning against disposable
  PostgreSQL and OpenSearch instances.
- Application rollback: disable discovery sampling and suggestion/trending routes, then redeploy
  the prior API. Leave both tables in place. Dictionary history remains useful audit evidence and
  sample rows will be removed by the bounded retention job.
- Physical rollback is exceptional. First disable every API/Worker writer and export published
  dictionary versions needed for recovery. Wait for or securely delete expired samples, remove the
  dictionary/sample triggers and foreign keys, then drop the three tables and trigger functions in
  dependency order. Prefer a corrective roll-forward because deleting published dictionary
  provenance makes prior search behavior harder to reproduce.
