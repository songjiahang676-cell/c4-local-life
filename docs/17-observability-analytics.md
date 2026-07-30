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

## 17.11 MOD-003 人工反馈指标

`socal_moderation_duplicate_reviews_total{outcome}` 只允许 `confirmed|false_positive` 两个固定标签，
按一次写定的候选数累加。精确幂等重试不增加计数；Listing ID、候选 ID、标题、分值、联系方式、图片
hash、阈值值和审核员均不得成为标签。运行期误杀率只使用已人工复核样本，必须同时展示样本量、阈值
版本和观察窗口；未复核 dry-run 命中只作为离线候选量，不可混入质量分母或宣称生产准确率。

## 17.12 SEARCH-002 索引时效与对账指标

- `socal_search_index_events_total{operation,outcome,priority}`：operation 仅 upsert/delete，outcome 仅
  applied/stale/missing/failed，priority 仅 urgent/normal。
- `socal_search_index_freshness_seconds{operation,priority}`：从 durable Outbox createdAt 到成功完成
  写入/删除的 histogram；失败尝试只进入事件 counter，不污染 SLO；urgent 以 p95 10 秒、normal
  以 p95 60 秒为设计目标，不能用平均值替代。
- `socal_search_reconciliation_total{outcome}`：仅 current/upserted/deleted/failed，用于发现持续漂移。

所有标签都是固定低基数枚举；Listing/event/owner ID、标题、分类、坐标、payload、provider 错误和
索引文档都不进入标签或结构日志。正式 Dashboard/告警阈值仍由 `OBS-002` 发布 Gate 固化。

## 17.13 SEARCH-003 查询结果指标

`socal_search_queries_total{outcome,sort,geo}` 的 outcome 只允许 success、empty、invalid_cursor、
expired_cursor、timeout、unavailable；sort 只允许公共五种排序，geo 只允许 true/false。HTTP RED
histogram 继续提供 `/v1/search` 路由级 latency/status，不再复制可变 bucket。query、cursor、PIT、
Listing/category/region ID、坐标、价格、命中数和 provider detail 均不能作为标签或结构日志字段。
零结果率、相关性和正式 Dashboard 属于 SEARCH-006/OBS-002，不能用当前测试计数伪造生产指标。

## 17.14 SEARCH-004 发现隐私指标

`socal_search_discovery_events_total{operation,outcome}` 仅允许固定 operation：
dictionary/sample/suggestions/trending/retention，和固定 outcome：
success/empty/recorded/duplicate/rejected_bot/rejected_sensitive/unavailable。不得添加 query、query hash、
source hash、IP、User-Agent、region、locale、dictionary version、count 或资源 ID 标签。HTTP RED
继续覆盖两个公开端点；热门内容、来源数和测试样本数不得作为生产 Dashboard 数据。

## 17.15 TAX-003 首页配置信号

发布/回滚沿用 Outbox 通用 dispatch、retry、oldest-age 和 terminal-failure 指标，event type 固定为
`homepage.layout.published`。允许的诊断字段只有 operation、locale 类别、版本和固定 outcome；配置
正文、content key、region code、actor ID 和内容 hash 不进入指标标签。`WEB-002` 接入消费者时再增加
固定 outcome 的 cache invalidation 指标，TAX-003 不虚构尚未存在的消费端可用性。

## 17.16 WEB-002 首页模块与失效指标

- `socal_homepage_modules_total{kind,outcome}` 的 kind 只允许 HERO/HOT_SEARCHES/CITY_CHIPS/
  LISTING_FEED，outcome 只允许 success/empty/unavailable；用于区分真实空模块与依赖故障。
- `socal_homepage_cache_invalidations_total{outcome}` 只允许 invalidated/stale/failed；重复或乱序版本
  计入 stale，依赖故障计入 failed 后由既有队列重试。
- locale、region、layout/module key、版本、content hash、query、Listing/用户 ID、正文、错误消息和
  provider detail 均不进入指标标签。HTTP RED 继续覆盖 `/v1/homepage`，正式 SLO/告警由 OBS-002
  结合生产流量设定。

## 17.17 PERF-001 缓存与 Web Vitals 指标

- `socal_homepage_cache_operations_total{outcome}` 只允许 hit/miss/coalesced/stored/bypassed/failed；
  key、locale、region、device、版本、tag、内容和依赖错误不作为 label。
- `socal_web_vital_duration_seconds{metric,route}` 的 metric 只允许 FCP/INP/LCP/TTFB，route 只允许
  homepage/listing-list/listing-detail/search/account/other；`socal_web_vital_cls_ratio{route}`
  独立保存无量纲 CLS，避免混合单位。
- 客户端不发送 metric id、URL/query/slug、用户/会话/设备 ID、Cookie 或 User-Agent。服务端地址
  HMAC 仅在内存短时限频且不导出。RUM 可被伪造，正式 Dashboard 必须同时展示样本量、流量过滤与窗口。
- API GET p95/p99 继续从 route-level `socal_http_request_duration_seconds` 计算；不复制资源 ID
  bucket，也不以单元测试或 CI 时延声称生产 SLO。
