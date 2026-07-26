# ADR-0004：使用 Transactional Outbox 与至少一次投递

- 状态：Accepted
- 日期：2026-07-21

## 背景

发布信息后需更新搜索、发送通知、处理媒体和分析。数据库事务无法与 Redis/OpenSearch/第三方形成可靠原子提交；直接在请求中调用会出现“数据库成功但副作用丢失”或长延迟。

## 决策

业务状态和 Outbox event 在同一 PostgreSQL 事务写入。Dispatcher 使用 `FOR UPDATE SKIP LOCKED` 领取、投递 BullMQ，并记录状态/重试。消费者按 eventId/业务版本幂等，接受重复和乱序。定期 reconciliation 修复漂移。

## 后果

系统是最终一致，需监控 oldest outbox/queue age、DLQ 和索引新鲜度。不能假设 exactly-once；账本和履约必须有数据库唯一约束/幂等记录。

## 备选

- 请求内同步调用：拒绝，故障耦合和一致性风险高。
- 分布式事务/2PC：拒绝，第三方和 OpenSearch 不适配，复杂度高。
- Kafka 从首期引入：拒绝，当前吞吐和运维需求不足；未来可替换 transport 而保留 Outbox。
