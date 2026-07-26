# 07. 系统架构

## 7.1 架构风格

首期采用“模块化单体 + 异步 Worker + 可重建读模型”。目标是在一个团队可控范围内实现强边界、可靠发布和水平扩展，而不是提前承担微服务的一致性、网络和运维成本。

```text
Browser / Search Bot
        │
   CDN + WAF
        │
 ┌──────┴────────┐
 │               │
Next Web      Next Admin
 │               │
 └──────┬────────┘
        │ HTTPS REST
  NestJS API (stateless)
   │     │      │
   │     │      └── Redis (cache/rate limit/queues)
   │     └───────── OpenSearch (read model)
   └─────────────── PostgreSQL/PostGIS (system of record)
        │
      Outbox
        │
   BullMQ Workers ── S3 / Email / SMS / Stripe / Search
```

Mermaid 图见 `diagrams/system-context.mmd`、`containers.mmd`、`deployment.mmd`。

## 7.2 进程边界

### Web

- 公开路由、SSR/ISR、SEO 元数据、结构化数据和用户交互。
- BFF 逻辑仅限页面组合、cookie 转发和视图适配，不承载核心业务规则。
- 静态/缓存页面通过 tag/path 失效与短 TTL 保持新鲜。
- 浏览器只能访问公开 API 和预签名上传地址。

### Admin

- 与 Web 分开构建和部署，独立域名、CSP 和访问策略。
- 后台强制 MFA、细粒度权限和敏感动作二次验证。
- 批量操作先预览影响范围，异步执行并提供作业进度。

### API

- 无状态，可水平扩展。
- Nest 模块对应领域边界；应用服务掌握事务和授权。
- Fastify 承担 HTTP；OpenAPI、Problem Details、请求 ID、验证和日志为横切能力。
- 对第三方使用端口/适配器，不把供应商 SDK 渗透到领域层。

### Worker

建议队列：

- `outbox-dispatch`
- `search-index`
- `media-scan`
- `media-transform`
- `notifications`
- `listing-lifecycle`
- `moderation-enrichment`
- `commerce-fulfillment`
- `analytics-export`
- `maintenance`

不同队列可独立并发和限速；高风险/重任务不能阻塞通知等轻任务。

## 7.3 API 模块依赖方向

```text
HTTP Controller
    ↓
Application Use Case / Policy
    ↓
Domain Rules
    ↓
Repository / Provider Ports
    ↓
Prisma, OpenSearch, Redis, S3, Stripe adapters
```

领域规则不依赖 Nest、Prisma 或第三方 SDK。首期不必追求纯粹 DDD 框架，但要保护“控制器—服务—仓储”边界和模块所有权。

## 7.4 写入流程

以发布信息为例：

1. Controller 验证请求形状和身份。
2. Policy 校验 actor 对草稿的权限。
3. Use case 加载聚合，执行状态与字段不变式。
4. 同一 PostgreSQL 事务写 Listing/Revision/Moderation request/Outbox。
5. API 返回数据库确定的状态，不等待 OpenSearch 或通知。
6. Outbox dispatcher 领取事件并投递 BullMQ。
7. Worker 更新索引、发送通知；失败重试，超过阈值进入 DLQ。

所有消费者以 `eventId` 或业务幂等键去重。

## 7.5 读取流程

- 详情和强一致账户页面从 PostgreSQL 读取，可经过短缓存。
- 搜索、聚合、热门词和地理筛选从 OpenSearch 读取。
- 搜索结果中的关键状态可批量回源校验，尤其在下架传播窗口。
- 首页模块由配置服务 + 聚合 API 组合，使用分块缓存和 stale-while-revalidate。
- 管理报表不得在在线主库执行无边界重查询；使用只读副本/物化视图/分析投影。

## 7.6 缓存策略

缓存只用于可重建数据：

| 数据               | 建议               | 失效                  |
| ------------------ | ------------------ | --------------------- |
| 分类/城市/首页配置 | 5–30 分钟 + 版本键 | 配置发布事件          |
| 公开详情           | 30–120 秒          | Listing 变更事件      |
| 聚合页             | 30–300 秒          | tag + TTL             |
| 会话/权限          | 极短或不缓存       | 账号/角色变更主动失效 |
| 热门搜索           | 5–15 分钟          | 滚动计算              |
| 限流计数           | Redis 原子操作     | 窗口自然过期          |

不得缓存完整私密联系方式到共享公开缓存；缓存 key 必须包含语言、城市、授权范围等维度。

## 7.7 可用性与降级

- OpenSearch 不可用：详情、账户和发布仍可用；搜索返回服务降级提示，可对有限数据使用 PostgreSQL fallback。
- Redis 不可用：关闭非关键缓存；登录/关键写入根据会话实现决定 fail closed；异步副作用积压在 Outbox。
- 邮件/短信不可用：站内通知继续，外部渠道重试。
- S3 上传不可用：保留草稿，禁止提交缺失必要媒体的内容。
- Stripe 不可用：浏览/发布不受影响；商业化入口显示维护，不创建不完整订单。
- Admin 不可用：公开站继续；紧急下架可通过受控运维命令执行并审计。

## 7.8 扩展与拆分触发条件

只有满足至少一个证据条件时考虑拆服务：

- 某模块需要与 API 显著不同的扩缩容曲线，且进程隔离仍不足。
- 独立团队需要自主发布，模块边界和契约已稳定。
- 故障隔离有明确收益，且分布式一致性成本可接受。
- 法律/安全要求需要独立数据或网络边界。
- 性能剖析证明单体内部资源竞争是瓶颈。

可能最先拆出的能力是媒体处理、通知或搜索查询，而不是用户/订单等强一致核心。

## 7.9 技术基线

仓库 pin 住主版本/小版本，升级通过单独任务：Node 24 LTS、Next.js 16.2、React 19.2、NestJS 11、Fastify 5、TypeScript 5.9、Prisma 7、PostgreSQL/PostGIS、Redis 8、OpenSearch 2.19、BullMQ 5。

生产数据库版本以云供应商和 PostGIS 兼容性验证为准；本地 Compose 使用明确的兼容镜像。版本不是永恒决策，升级应有兼容测试、数据迁移和回退。
