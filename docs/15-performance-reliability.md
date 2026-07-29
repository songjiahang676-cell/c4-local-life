# 15. 性能、容量与可靠性

## 15.1 规划目标

下列是首期 SLO/预算，Beta 前须压测校准：

| 指标                 | 目标          |
| -------------------- | ------------- |
| 公开 Web/API 可用性  | 99.9% / 月    |
| 后台可用性           | 99.5% / 月    |
| API GET p95/p99      | 300ms / 900ms |
| API mutation p95/p99 | 700ms / 2s    |
| OpenSearch p95       | 450ms         |
| 首页 LCP p75         | 2.5s          |
| INP p75              | 200ms         |
| CLS p75              | 0.1           |
| 下架传播至搜索 p95   | 10s           |
| 一般索引新鲜度 p95   | 60s           |
| 通知入队 p95         | 30s           |
| RPO / RTO            | 15m / 2h      |

SLO 不包含用户网络和明确排除的第三方时延，但用户旅程仍需端到端监控。

## 15.2 容量模型

起始假设：100k 用户、500k Listing、10k DAU、100 RPS 持续/500 峰值、消息和媒体随增长。容量计划至少估算：

- 行数、索引大小、数据库连接和 IOPS。
- 搜索文档大小、分片数、查询/索引速率。
- 媒体原图/变体、带宽和生命周期。
- Redis 内存、queue backlog 和 job payload。
- 日志/指标/追踪/分析事件量。

禁止把大正文、图片二进制、完整 webhook payload 长期塞入 Redis/队列。

## 15.3 Web 性能预算

- 初始 HTML 压缩后尽量 <100KB；首屏 JS 按路由拆分，公开详情避免重客户端框架逻辑。
- 图片用响应式尺寸、现代格式、明确 width/height 和 CDN；Hero 不阻塞关键文本。
- 第三方脚本默认不加载，需同意/性能评审。
- 字体使用系统栈或最少授权 webfont，避免 FOIT。
- 首页分块缓存，非首屏门户模块延迟加载但保持 SEO 关键内容服务端输出。
- 监控真实用户 CWV，不只依赖本地 Lighthouse。

## 15.4 API 性能

- 列表仅选择 DTO 所需列，避免 N+1。
- 每个 endpoint 有最大 page size、body size、日期范围和查询复杂度。
- 使用连接池并按实例数计算总连接，避免扩容压垮数据库。
- 慢查询采样、EXPLAIN 评审和索引预算。
- 外部调用设置 connect/request timeout、有限重试、抖动和 circuit breaker。
- 不在请求中同步发送邮件、重建索引或处理大图。

## 15.5 队列可靠性

- 至少一次投递，所有 job 幂等。
- 指数退避 + jitter，按错误类型区分可重试/永久失败。
- 有限 attempts 后进入 DLQ，保留失败上下文但不包含多余 PII。
- 指标：waiting/active/delayed/failed、oldest age、duration、retry、DLQ。
- backpressure：暂停低优先任务、限制生产速率、水平扩 Worker。
- 定期 reconciliation 修复“数据库成功但副作用缺失”。

`EVT-001` 已实现有界 batch、短租约、`SKIP LOCKED` 多实例并发领取、指数退避 + eventId 确定性 jitter、
最大 attempts 和 BullMQ eventId jobId。每次确认都匹配 claim attempt，避免旧 worker 覆盖新租约；
PENDING 事件年龄和 publish/retry/failed/stale 结果直接进入低基数指标。DLQ 管理、人工重放和跨系统
reconciliation 仍属于 `EVT-002`。

## 15.6 数据库可靠性

- Multi-AZ、PITR、自动备份、存储自动扩展阈值。
- 写主 + 可选只读副本；强一致账户/订单不盲目读副本。
- 所有事务短小，明确隔离级别；并发库存/账本使用约束与锁而非应用猜测。
- 迁移前检查锁和表大小，长变更分阶段。
- 每季度恢复演练，记录实际 RTO/RPO。

## 15.7 搜索可靠性

- 索引 alias、版本、全量重建和回滚。
- 分片大小目标基于实测，首期避免过度分片。
- 查询 timeout、terminate/结果窗口限制、昂贵聚合白名单。
- 当前公共查询默认 1500 ms、最长 5000 ms，limit 最大 50；使用最长 300 秒（默认 120 秒）的 PIT
  与 search_after，不开放 offset/deep pagination、任意脚本、字段或聚合。
- 索引写入与查询可分优先级；下架事件最高优先。
- 监控 cluster health、heap、磁盘水位、rejections、latency、refresh lag。

## 15.8 灾难与故障演练

至少演练：

- RDS 主故障/恢复；
- OpenSearch 整体不可用与重建；
- Redis 数据丢失、队列恢复、Outbox 重投；
- S3 误删/版本恢复；
- ClamAV 不可用/超时、重复媒体事件和对象在 HEAD 后被替换；暂时故障重试，内容 hash 不一致永久拒绝；
- Stripe webhook 延迟/重复/乱序；
- DNS/CDN/WAF 配置错误；
- 错误迁移和应用回滚；
- 密钥泄露与会话全局撤销。

## 15.9 Error Budget

99.9% 月可用性约对应约 43 分钟不可用预算。消耗过快时冻结非必要发布，优先可靠性任务。错误预算策略需在运营成熟后细化，但从首日记录 SLI。

## 15.10 性能测试

- k6/等价工具覆盖：首页/API 列表、详情、搜索、登录、发布、消息和 webhook。
- 数据规模接近目标，避免空数据库压测。
- 逐步负载、突发、耐久、队列积压和依赖故障测试。
- 记录版本、数据集、环境、阈值和瓶颈；性能结果可重复。
