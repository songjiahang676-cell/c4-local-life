# 17. 可观测性与产品分析

## 17.1 三大信号

- **Logs**：结构化 JSON，事件、级别、service、env、version、requestId、traceId、actor type/hashed id、resource type/id、duration、outcome。
- **Metrics**：RED（rate/errors/duration）、USE（utilization/saturation/errors）、业务与队列指标。
- **Traces**：Web/API/DB/Redis/OpenSearch/worker/provider 关键 span，采样策略保护成本和隐私。

采用 OpenTelemetry 语义与导出接口，后端供应商可替换。

## 17.2 日志规范

不得记录：密码、OTP、session/token、完整 cookie、卡数据、验证材料、消息正文、未脱敏手机号/邮箱/精确地址。必要标识使用稳定但可轮换的 hash 或内部 ID。

错误日志包含错误分类和安全的上下文，不把 provider 原始响应直接返回用户。高频 4xx 采样，安全事件保留必要字段。

## 17.3 核心指标

### 平台

- HTTP 请求率、错误率、p50/p95/p99、实例 CPU/memory、连接池、GC。
- PostgreSQL 连接、CPU、IO、锁、replica lag、慢查询、存储。
- Redis memory、eviction、latency、connections。
- OpenSearch health、heap、disk、search/index latency、rejection。
- S3/媒体扫描失败、CDN hit ratio。

### 业务

- listing draft/submitted/published/rejected/expired 数量和漏斗。
- 审核队列年龄、SLA、误杀/申诉恢复。
- 搜索零结果、有效联系率、索引延迟。
- 会话创建、消息失败、垃圾/举报率。
- 订单/付款/退款/争议、履约延迟、账本 reconciliation。
- 广告库存、活动状态、合格展示/点击。

### Worker

每队列 waiting、active、delayed、failed、oldest age、duration、attempts、DLQ 和吞吐。

Outbox dispatcher 额外暴露：

- `socal_outbox_oldest_pending_age_seconds`：最老 PENDING 事件年龄；
- `socal_outbox_dispatch_total{outcome}`：仅允许 published/retry/failed/stale；
- `socal_outbox_poll_failures_total`：数据库领取或状态写回失败。
- `socal_media_processing_total{outcome}`：仅允许 ready/rejected/stale，区分终态和重复/乱序事件。
- `socal_notification_events_total{outcome}`：仅允许 created/duplicate/ignored/
  recipient_unavailable/failed，不使用 user、Listing、event 或模板 key 作为 label。

事件类型、aggregateId、eventId 和 payload 不作为指标标签；结构日志只保留内部 eventId、attempt、
有界 outcome/errorCode，不序列化 payload 或 provider 原始错误。
媒体指标不使用 mediaId、对象 key、hash、MIME、ClamAV signature 或 rejection code 作为 label；
Worker 的通用 job duration/failure 指标承担依赖超时/重试可见性。

## 17.4 告警

告警必须可操作，绑定 Runbook 和 owner。建议：

- Sev0/1：公开站大面积失败、数据损坏、支付重复、账户接管、RDS 不可用。
- Sev2：错误预算快速消耗、搜索不可用、队列延迟超 SLO、审核高危积压。
- Sev3：单个 provider 失败、成本异常、非关键任务延迟。

避免单点瞬时噪声；使用多窗口 burn-rate、持续时间和依赖关联。告警中不包含 PII。

## 17.5 Dashboard

- Executive：可用性、核心漏斗、内容安全、收入/退款。
- On-call：服务 RED、依赖、队列、近期部署。
- Search：latency、zero-result、freshness、cluster。
- Moderation：队列、SLA、规则、申诉。
- Commerce：订单、webhook、履约、reconciliation。
- Growth/SEO：可索引资源、抓取、CWV、获取与留存。

## 17.6 分析事件

`schemas/analytics-event.schema.json` 定义公共 envelope：event name/version、occurredAt、anonymous/user/session id、locale、region、page、properties 和 consent state。

事件命名示例：

```text
homepage_viewed
search_submitted
search_result_opened
listing_draft_created
listing_submitted
listing_published
contact_revealed
conversation_started
message_sent
report_submitted
promotion_checkout_started
order_paid
ad_impression_qualified
```

属性 schema 版本化，不采集自由文本 query 之外不必要敏感内容；搜索词需做保留与低频隐私控制。

## 17.7 数据质量

- 定义 source of truth 和去重 key。
- 客户端事件可能丢失/重复，关键支付/发布指标以服务端事件为准。
- Bot、员工、测试流量和自交互单独标识。
- 事件发布前有 schema 验证；破坏性字段变化新增版本。
- 每日检查量级突变、空字段、时间漂移和业务对账。

## 17.8 实验

Feature Flag 与实验分开建模，但可关联。实验定义 hypothesis、primary/guardrail metric、targeting、sample、duration、stopping rule 和 owner。严禁只看点击率而忽略举报、有效联系、退款和性能。

## 17.9 隐私与保留

分析标识尊重 consent/opt-out；不跨目的滥用。原始事件短期保留，聚合长期保留；删除请求要能解除/删除用户标识。第三方分析脚本需安全、隐私和性能评审。

## 17.10 当前实施基线

`OBS-001` 的结构日志、Prometheus RED/Worker 指标、W3C Trace 传播、OTLP 导出接口和 PII 脱敏测试记录在 [`observability-baseline.md`](./observability-baseline.md)。Dashboard、SLO、告警、Collector 部署和正式采样策略属于 `OBS-002`/发布 Gate，不在本基础切片中伪造完成。
