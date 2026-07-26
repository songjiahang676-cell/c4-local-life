# ADR-0003：REST-first，OpenAPI 3.1 为对外契约

- 状态：Accepted
- 日期：2026-07-21

## 背景

公开站、后台和未来移动端需要稳定、可测试、可生成客户端的接口。业务资源和状态动作清晰，暂不需要 GraphQL 的自由查询复杂度。

## 决策

API 使用版本化 REST `/v1`，OpenAPI 3.1 为事实源；错误采用 Problem Details；高变动列表使用 cursor；并发编辑使用版本/ETag；可重试写入使用 Idempotency-Key。

## 后果

接口变更必须同步契约和测试。页面组合需求通过 server-side composition/专用聚合 endpoint 解决，而非让浏览器发大量请求。GraphQL 可在未来有明确消费者和查询需求时重新评估。

## 备选

- GraphQL-first：拒绝，权限/缓存/查询成本和团队负担当前不划算。
- tRPC-only：拒绝，外部/多语言客户端和契约治理不足。
- 无契约 REST：拒绝，容易漂移且不适合 Agent 协作。
