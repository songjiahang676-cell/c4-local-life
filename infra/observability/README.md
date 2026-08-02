# Observability assets

`dashboards/search-quality.json` is the versioned Grafana dashboard contract for `SEARCH-006`.
It uses only metrics emitted by the modular monolith and fixed, low-cardinality labels. It does not
contain production data, alert thresholds, credentials, data-source identifiers, or cloud resource
configuration.

The dashboard distinguishes two kinds of evidence:

- runtime panels show observed request volume, zero-result share, route latency, dependency errors,
  index freshness, and recovery failures;
- the offline relevance report is produced from the synthetic bilingual dataset and is deliberately
  not exported as a production metric.

`OBS-002` owns authenticated production provisioning, data-source binding, Beta-derived SLO/alert
thresholds, and the OpenSearch cluster/exporter panels. Do not infer production quality or latency
from CI fixture scores.
