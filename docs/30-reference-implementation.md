# 30. 参考实现说明

## 30.1 当前代码包含什么

### `apps/web`

- Next App Router 基础结构。
- `/` 到 `/zh-Hans` 的入口。
- 响应式首页视觉参考，映射设想图的主要区域。
- 静态模拟数据和纯 CSS，用于让开发者快速理解布局。
- `NOTIF-001` 已增加私有、noindex 的中英文通知中心，具备登录门、未读筛选、稳定分页、已读和严格
  同源 BFF allowlist。

它尚未连接 API、身份、真实图片、i18n 库、无障碍测试、SEO 元数据、缓存和设计系统。因此不得把当前首页直接当作生产完成品。

### `apps/admin`

- Next 后台壳和仪表盘占位。
- 后续按 `docs/28-admin-console.md` 建立鉴权、导航和工作区。

### `apps/api`

- NestJS + Fastify 启动、Swagger、全局验证和 Problem Details 异常过滤器。
- Health 模块。
- Listing HTTP 不再使用进程内数组示例；`LIST-001` 已增加纯领域状态机，覆盖五类
  type-detail、价格、审核/内容双状态、版本和过期不变式。`LIST-002` 已增加 PostgreSQL Repository
  及 public/owner/moderator 显式安全投影，包含对象范围、当前审核角色 scope 和精确历史动态字段
  visibility 过滤；`LIST-003` 已接入数据库草稿创建/owner 读取/条件更新、actor-scoped 幂等、
  API-004 对象 Policy、强 ETag/409，以及同事务最小化 Audit/Outbox。`LIST-004` 已接入 Rental
  中英/移动动态表单、防抖自动保存、user + locale 隔离恢复、同源 allowlist BFF、owner 媒体状态
  轮询及事务化 READY 绑定；`LIST-005` 已接公开安全列表/详情、归档/软删除和批量过期；
  `NOTIF-001` 已接账号私有通知列表/已读 API 与 Policy。

### `apps/worker`

- BullMQ/Redis 队列与 Worker 进程。
- 示例 search/media/notification job 类型。
- `EVT-001` 已接 PostgreSQL Outbox dispatcher、SKIP LOCKED 租约领取、eventId jobId、发布重试和
  oldest-age/结果指标。
- `MEDIA-002` 已接真实媒体消费者：有界 S3/MinIO 读取、内容 hash/magic-byte、ClamAV INSTREAM、
  Sharp 解码/方向校正/去 metadata、三个确定性 WebP 变体和 lifecycleVersion 幂等终态。
- `NOTIF-001` 已接 Listing 状态通知消费者：严格 envelope、eventId 幂等投影、canonical recipient、
  风险分支和有界结果指标。
- 仍需搜索等其他领域真实幂等消费者、通知 provider adapter，以及 `EVT-002` 的
  DLQ/replay/reconciliation 工具。

### `packages/database`

- Prisma 7 配置和 client adapter。
- 覆盖用户、组织、地区、分类、Listing、媒体、消息、商家/师傅、评价、审核、通知、订单、支付、积分、广告、Outbox 和审计的初始 Schema。
- 安全的扩展引导迁移、需合并到首个建表迁移后的 PostGIS/trigram/约束 SQL，以及 fallback SQL。
- Listing 的公开、owner 和 moderator 三类显式读取投影；对象授权条件及动态字段 visibility 在
  Repository 边界失败关闭，不直接返回 Prisma 模型。
- Listing 草稿 Repository 对创建使用 advisory lock + owner/key 唯一证据，对更新使用行锁 +
  version predicate，并在相同事务写 Audit/Outbox。
- Listing 媒体绑定按 UUID 加行锁，只接受 owner 或同一可编辑 Listing 已绑定的 READY 图片；
  `media_assets_listing_binding_check`、外键和稳定 sort order 提供数据库兜底。
- Moderation Case Repository 提供 MFA/current-role 范围队列与安全详情，并以 actor/key advisory
  lock、Case/Listing 行锁和 version predicate 原子提交 Action/Audit/Outbox。快照在 submission
  事务按历史表单 visibility 脱敏，数据库阻止 snapshot/action 改写。
- Notification Repository 以 eventId advisory lock 和复合唯一键投影 Listing Outbox，只从 canonical
  Listing 读取 owner/locale；已发布双语模板不可变，通知保存静态渲染快照并提供账号范围稳定分页/已读。

Schema 是详细起点，不替代首次 `prisma validate`、migration 生成、约束/索引评审和集成测试。

### 契约与数据

- `openapi/openapi.yaml`：当前 49 个 path、58 个 operation 和 113 个 schema 的 REST 契约。
- `schemas/`：Listing 动态表单、首页编排、分析事件。
- `seed/`：分类、地区、首页和示例 Listing。
- `diagrams/`：系统/容器/部署/流程/ER Mermaid 图。

## 30.2 首次实施应做的代码调整

1. 生成并提交 `pnpm-lock.yaml`，锁定依赖。
2. 修复任何在真实 Node 24/pnpm 11 环境暴露的构建问题。
3. 运行 Prisma validate/generate；用 `--create-only` 生成首个建表迁移，并按 `packages/database/prisma/sql/README.md` 合并后置 SQL、补全 relation/constraint。
4. 建立统一 ESLint/Prettier/Vitest/Playwright 配置。
5. 为各 app 添加可构建容器和健康检查。
6. 将 API 模块按领域目录重构，接 database package。
7. 建立 session/auth、policy、request context 和 audit middleware。
8. 选择 OpenAPI 与 Zod/DTO 的生成方向，防止三份契约漂移。
9. 把首页 mock 分解为 Server Components 和 API-backed modules。
10. 逐个 Backlog 任务实现，不一次性大爆炸替换全部代码。

## 30.3 推荐代码目录演进

```text
apps/api/src/modules/listings/
├── domain/
│   ├── listing.ts
│   ├── listing-status.ts
│   └── listing.policy.ts
├── application/
│   ├── commands/create-listing.ts
│   ├── commands/submit-listing.ts
│   └── queries/get-listing.ts
├── infrastructure/
│   ├── prisma-listing.repository.ts
│   └── listing-outbox.publisher.ts
├── http/
│   ├── listings.controller.ts
│   └── listings.dto.ts
└── listings.module.ts
```

不过不要为了目录形式引入过多样板；当模块小、规则简单时可合并文件，但依赖方向不变。

`MOD-001` 保持该依赖方向：`moderation-risk.ts` 是无 I/O 的版本化规则模块，
`ListingsService.submit` 负责 Policy、历史表单策略和领域状态转换，
`ListingSubmissionRepository` 只负责 PostgreSQL 范围复核、幂等锁与原子证据持久化。
Controller 不导入 Prisma，Web/Admin 也不导入数据库 adapter。

`ADMIN-002` 延续相同边界：`ModerationController` 只做严格契约、Policy 和 HTTP 映射；
`ModerationService` 管理签名 cursor、ETag、原因与 Listing 领域转换；数据库 adapter 复核 Session/
角色并持久化。Admin React 组件只调用同源 BFF，不导入 Prisma 或数据库模型。

`LIST-005` 使用同一模块化单体边界：`ListingsController` 只解析严格 query、ETag 和 Problem Details；
`ListingsService` 负责签名 cursor、对象 Policy 与领域状态机；`ListingRepository` 负责 PostgreSQL
公开投影、锁后授权复核、状态/version predicate 和 Audit/Outbox 原子提交。Worker 的
`ListingExpiryDispatcher` 只编排轮询、指标与结构化结果，实际领取/转换仍由 database package 完成。

`NOTIF-001` 继续保持相同方向：Worker 的 `ListingNotificationHandler` 只校验/分派事件并分类永久与
瞬时错误；`NotificationRepository` 持有模板选择、canonical recipient、幂等事务和查询；API 的
`NotificationsService` 持有 Policy 与签名 cursor；Web 只调用同源 BFF。

## 30.4 生成与手写边界

- Prisma client：生成，不手改。
- OpenAPI client/types：确定工具后生成，不把生成文件作为业务逻辑来源。
- JSON Schema/seed：手写并由 CI 校验。
- Migration：Prisma 生成后人工审查；PostGIS/复杂索引可手写。
- Mermaid：手写事实源，可在 CI 渲染检查。

## 30.5 未完成即不能声称完成的事项

本包没有替代：真实品牌资产/版权、用户研究、法律意见、生产云资源、provider 账号、真实测试数据、安全渗透、依赖安装后的完整构建、性能实测和运营团队。Codex 应把这些作为明确 Gate，而不是用占位值默认为已解决。
