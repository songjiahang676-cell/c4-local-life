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
  `LIST-006`/`LIST-007` 已把完整链扩展到 Job、Transfer、Secondhand 和 Service；
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

- `openapi/openapi.yaml`：当前 64 个 path、74 个 operation 和 137 个 schema 的 REST 契约。
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

`LIST-006`/`LIST-007` 不新增服务边界：`ListingsService` 按 type 构造并验证五类 detail，
`ListingDraftRepository` 在同一事务 upsert 匹配明细并清理错配明细；公共读与过期仍走共享
`ListingRepository`。Web 五类发布页复用同一个 schema-driven 组件，但保持路由、本地恢复 key 和
动态字段按 vertical 隔离。

`LIST-008` 继续保持模块化单体依赖方向：Controller 只解析 `If-Match`、幂等键与 cursor；
`ListingsService` 负责 owner Policy、脱敏 diff、minor/major 保守分类和风险规则；
`ListingRevisionRepository` 在 PostgreSQL 行锁内重新授权并原子追加 revision/evaluation/case/
snapshot/Audit/Outbox。人工审核仍由 `ModerationService` 发出领域命令，Repository 独立校验 revision
保存的原 publication window，Controller 和 Web BFF 都不导入 Prisma。

`LIST-009` 沿用同一边界：`AccountListingsController` 只验证严格 query/body、应用 Policy 和设置
no-store；`ListingsService` 持有账号绑定 cursor、bucket 映射、最小 DTO 与逐项批量编排；
`ListingRepository` 使用 canonical Listing/membership/taxonomy/revision 和现有索引完成投影。
批量动作重新调用既有 archive/delete use case，不从 Controller 直接访问 Prisma，也不新增跨对象
事务。Web 的账号页面只通过同源 BFF 和生成契约类型通信，设备草稿恢复不能覆盖明确加载的服务器草稿。

`NOTIF-001` 继续保持相同方向：Worker 的 `ListingNotificationHandler` 只校验/分派事件并分类永久与
瞬时错误；`NotificationRepository` 持有模板选择、canonical recipient、幂等事务和查询；API 的
`NotificationsService` 持有 Policy 与签名 cursor；Web 只调用同源 BFF。

`ORG-002` 保持同样边界：`OrganizationsService` 执行 Policy、请求摘要与 DTO 映射；
`OrganizationRepository` 独占行锁、membership/邀请/转移持久化和 Audit/Outbox 原子性；Controller
不导入 Prisma。`OrganizationInvitationNotificationHandler` 只解析最小 envelope，
`NotificationRepository` 从 canonical invitation/invitee 生成私有投影。Owner 转移的最终不变量由
PostgreSQL deferred trigger 兜底，不依赖前端隐藏或单次队列执行假设。

`MOD-002` 使用独立 `trust-safety` 应用模块但不增加进程边界：Controller 解析严格公共/Admin
契约和 Policy，Service 管理 opaque receipt、签名 queue cursor、ETag、原因与 Listing 状态转换，
database adapter 独占 actor/session 复核、advisory/row lock、去重和 Report/Appeal/Case/Action/
Audit/Outbox 原子写入。站内通知继续由既有 Worker 从最小 Listing 事件投影，举报证据或举报者身份
不会进入队列 payload。

`MOD-003` 仍在 Listing/Moderation 模块化单体边界内：Worker 媒体 transformer 只产生确定性 dHash；
`ListingsService` 从版本化表单定义提取联系方式、以域分离 HMAC 生成指纹、调用 Repository 有界候选
查询并执行版本化阈值策略；Repository 独占 pg_trgm/Hamming/指纹 SQL 和 evaluation/candidate 持久化。
`ModerationService` 只把人工动作映射为一次写定反馈并记录固定标签指标。Controller、Web/Admin 不
导入 Prisma，OpenSearch/Redis 不参与 canonical 判定，也没有新增进程、队列或数据库。

## 30.4 生成与手写边界

- Prisma client：生成，不手改。
- OpenAPI client/types：确定工具后生成，不把生成文件作为业务逻辑来源。
- JSON Schema/seed：手写并由 CI 校验。
- Migration：Prisma 生成后人工审查；PostGIS/复杂索引可手写。
- Mermaid：手写事实源，可在 CI 渲染检查。

## 30.5 未完成即不能声称完成的事项

本包没有替代：真实品牌资产/版权、用户研究、法律意见、生产云资源、provider 账号、真实测试数据、安全渗透、依赖安装后的完整构建、性能实测和运营团队。Codex 应把这些作为明确 Gate，而不是用占位值默认为已解决。

## 30.6 WEB-004 账户壳实现

`apps/web/src/components/account-shell.tsx` 是账户页面唯一 Session/能力内存边界，负责严格解析、
并发去重、15 秒可见重验与失效关闭；`account-overview.tsx` 只呈现服务端允许且已经实现的账户入口及
最小组织摘要。`/[locale]/account/layout.tsx` 组合 Provider/Shell，使 Listing 管理与通知中心不再
分别请求或持久化 Session。所有业务数据仍从各自同源 BFF/API 读取，Web 不导入 Prisma、不自行授予
权限，也不新增服务、数据库、契约或架构边界。

## 30.7 SEARCH-001 索引定义边界

`apps/worker/src/search/listing-index-definition.ts` 只定义可序列化的公共 Listing 搜索 DTO、版本化名称、
analyzer、mapping 和 alias；`listing-index-manager.ts` 只负责针对 OpenSearch 的 create-or-validate；
`opensearch-client.ts` 是官方 Node client 和 SecretValue 的 adapter；CLI 只组合配置、client 和
manager。Web/API 不导入这些模块，Worker 不把 OpenSearch 当 canonical store，也不在本切片消费
Outbox 或实现查询 API。事件投影、乱序保护和 reconciliation 由 `SEARCH-002` 实现，公共搜索查询由
`SEARCH-003` 实现，重建和 alias 切换由 `SEARCH-005` 实现。

## 30.8 SEARCH-002 索引 Worker 边界

`ListingSearchRepository` 位于 database package，只读取 canonical Listing、历史 form schema、
taxonomy 和公开主体信号并返回不含 HTTP/OpenSearch 类型的最小投影；`ListingIndexHandler` 位于
Worker，校验 Outbox、构造版本化文档并调用 `OpenSearchListingIndex` adapter；`ListingIndexReconciler`
只编排有界状态扫描和修复。Controller/Web/Admin 不导入 Prisma 或搜索 adapter，OpenSearch 不参与
业务写事务，也没有新增进程、队列、数据库或 API 范式。

同一 BullMQ Listing job 可以顺序执行搜索和通知 handler；失败后整个 job 重试，各 handler 必须保持
幂等。下架优先级通过通用 Outbox claim 配置和 BullMQ priority 传递，不创建第二队列或服务。

## 30.9 SEARCH-003 查询边界

`SearchController` 只做生成契约校验、no-store 与稳定 Problem Details 映射；`SearchService` 持有
query-bound HMAC cursor、PIT 生命周期、分页编排和低基数结果指标；`OpenSearchSearchStore` 是唯一
OpenSearch 查询 adapter，构造固定查询并把 strict v1 source 映射为最小公共 DTO。Controller/Service
不导入 Prisma，adapter 不写 PostgreSQL 或 OpenSearch 文档；Worker 仍独占索引写入。Web/Admin
不导入搜索 adapter，PostgreSQL 始终是 canonical，新增搜索功能没有改变进程、数据库或 REST 版本。

## 30.10 SEARCH-004 发现实现边界

`SearchDiscoveryService` 负责同义词解析、隐私筛查、HMAC 来源、建议/热门编排和固定指标；
`SearchDictionaryService` 是未来受 Policy 保护的运营 mutation 应用边界；Controller 只做生成契约验证、
请求上下文提取、缓存头和 Problem Details。`DatabaseSearchDiscoveryStore` 组合专用
`SearchDiscoveryRepository` 与只读 `TaxonomyRepository`，是唯一 Prisma adapter。

普通 Search Store 只接收已解析且最多八个 `queryTerms`；OpenSearch 仍是可重建只读派生状态。
测试注入 Search Store 时默认使用显式 no-op discovery store，避免单元/HTTP 测试意外访问数据库；
生产未注入时使用 PostgreSQL adapter。没有新增服务、队列、数据库或 API 范式，因此不需要 ADR。

## 30.11 WEB-001 公共页面实现边界

`apps/web/src/lib/public-listings.ts` 是匿名公开读取 adapter：只组合既有 `/search`、`/listings`、
`/categories`、`/regions`，以共享 Contracts 的严格运行时 Schema 映射视图模型，不导入 Prisma、
OpenSearch client 或 API 应用服务。`public-listing-routes.tsx` 只处理 locale/垂类注册表、城市/UUID
路由、canonical redirect 与 Next metadata；`public-listing-pages.tsx` 是无客户端状态的 SSR 展示层。

五个 literal optional-catchall 页面只绑定固定 ListingType，全站搜索另有固定路由；Web 不创建新 API、
事实表、迁移、服务或消息范式。简单首屏降级仍调用 API 的 PostgreSQL 公共 projection，不直接访问
数据库。E2E fixture 是 Playwright 独立进程且只提供虚构数据，不会进入应用 runtime 或生产镜像。因此
该实现保持模块化单体和既有 REST/事实源边界，不需要 ADR。

## 30.12 TAX-003 首页布局实现边界

共享 Contracts 与独立 JSON Schema 描述严格可序列化 layout；Database 包保存状态、不可变版本、种子和
事务 Outbox；API 的 `HomepageLayoutService` 通过 Store 端口调用 Repository。当前模块没有 Controller，
不会提前改变 68-path 公共 REST 契约，也不会让 Web/Admin 导入 Prisma。`WEB-002` 只需装配该应用服务
与各领域公共读模型；未来 Admin 编辑器同样必须通过授权 use case，不能绕过版本与审计边界。
