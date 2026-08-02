# observability module contract

CloudWatch logs/metrics/alarms/dashboards、OTel collector、SNS/Pager integration。告警绑定 docs/20 runbook。

`SEARCH-006` 的供应商中立搜索质量面板契约位于
[`../../../observability/dashboards/search-quality.json`](../../../observability/dashboards/search-quality.json)；
本模块在 `OBS-002` 才负责生产数据源绑定、权限、SLO 和告警，不把 CI 合成评估分数当作生产指标。

`REL-001` 实现时需要变量验证、outputs、examples、tests、security/cost notes，并保持模块不读取其他模块内部资源。
