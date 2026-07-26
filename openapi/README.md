# OpenAPI Contract

`openapi.yaml` 是 REST `/v1` 契约初稿。实施时：

- 使用 OpenAPI 3.1 lint/validation；
- 为每个 endpoint 增加实际 security、errors、examples、pagination 和 idempotency；
- 实现与契约做 CI contract test；
- 破坏性变化通过新版本/弃用流程；
- 不直接把 Prisma model 作为 response schema。
