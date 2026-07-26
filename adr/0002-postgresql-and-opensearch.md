# ADR-0002：PostgreSQL 为事实源，OpenSearch 为搜索读模型

- 状态：Accepted
- 日期：2026-07-21

## 背景

平台需要强一致状态、事务、地理查询和复杂双语搜索。单独依赖关系数据库难以长期满足相关性/facet；把 OpenSearch 当主库则会削弱事务、约束和恢复能力。

## 决策

PostgreSQL + PostGIS 保存所有业务主数据。OpenSearch 保存公开可搜索投影，由数据库 Outbox 事件异步更新。索引可从 PostgreSQL 全量重建；不在索引中保存私密联系方式、精确地址、风险备注或唯一副本。

## 后果

搜索是最终一致，必须设计索引版本、下架快速传播、reconciliation 和故障降级。写入路径不依赖 OpenSearch，核心发布/编辑在其不可用时仍可工作。

## 备选

- PostgreSQL-only：MVP 极简可行，但双语、同义词、facet、地理排序和规模能力有限；保留作为降级。
- OpenSearch primary：拒绝，事务/约束/恢复不适合核心订单和身份数据。
- 商业 SaaS Search：可作为未来替代 adapter，但当前选择自控 OpenSearch。
