# 30. 参考实现说明

## 30.1 当前代码包含什么

### `apps/web`

- Next App Router 基础结构。
- `/` 到 `/zh-Hans` 的入口。
- 响应式首页视觉参考，映射设想图的主要区域。
- 静态模拟数据和纯 CSS，用于让开发者快速理解布局。

它尚未连接 API、身份、真实图片、i18n 库、无障碍测试、SEO 元数据、缓存和设计系统。因此不得把当前首页直接当作生产完成品。

### `apps/admin`

- Next 后台壳和仪表盘占位。
- 后续按 `docs/28-admin-console.md` 建立鉴权、导航和工作区。

### `apps/api`

- NestJS + Fastify 启动、Swagger、全局验证和 Problem Details 异常过滤器。
- Health 模块。
- Listing 示例模块，当前主要用于说明 Controller/DTO/Service 边界；需要替换为真实 repository、policy 和状态机。

### `apps/worker`

- BullMQ/Redis 队列与 Worker 启动骨架。
- 示例 search/media/notification job 类型。
- 需要接 Outbox dispatcher、真实 adapter、幂等存储、metrics 和 DLQ 工具。

### `packages/database`

- Prisma 7 配置和 client adapter。
- 覆盖用户、组织、地区、分类、Listing、媒体、消息、商家/师傅、评价、审核、通知、订单、支付、积分、广告、Outbox 和审计的初始 Schema。
- 安全的扩展引导迁移、需合并到首个建表迁移后的 PostGIS/trigram/约束 SQL，以及 fallback SQL。

Schema 是详细起点，不替代首次 `prisma validate`、migration 生成、约束/索引评审和集成测试。

### 契约与数据

- `openapi/openapi.yaml`：31 个主要 path 的初始 API 契约。
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

## 30.4 生成与手写边界

- Prisma client：生成，不手改。
- OpenAPI client/types：确定工具后生成，不把生成文件作为业务逻辑来源。
- JSON Schema/seed：手写并由 CI 校验。
- Migration：Prisma 生成后人工审查；PostGIS/复杂索引可手写。
- Mermaid：手写事实源，可在 CI 渲染检查。

## 30.5 未完成即不能声称完成的事项

本包没有替代：真实品牌资产/版权、用户研究、法律意见、生产云资源、provider 账号、真实测试数据、安全渗透、依赖安装后的完整构建、性能实测和运营团队。Codex 应把这些作为明确 Gate，而不是用占位值默认为已解决。
