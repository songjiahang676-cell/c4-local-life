# 08. API 与外部集成

## 8.1 API 原则

- Base path：`/v1`，HTTPS only。
- 风格：资源导向 REST；复杂行为使用清晰动作子资源，不用含糊 RPC 名称。
- 契约：`openapi/openapi.yaml` 是事实源，生成客户端/测试可由其派生。
- 编码：JSON UTF-8；日期时间 RFC 3339 UTC；货币带 currency。
- 身份：Web 采用安全 Cookie 会话；外部/移动客户端未来可增加受限 OAuth/OIDC token。
- 错误：`application/problem+json`，包含 `type`、`title`、`status`、`detail`、`instance`、`requestId`、可选字段错误。
- 追踪：接受/生成 `traceparent` 和 `X-Request-Id`。

## 8.2 版本策略

`/v1` 只做向后兼容增量：新增可选字段、端点或枚举前必须考虑旧客户端。删除/重命名/改变语义属于破坏性变更，需新版本、迁移窗口和弃用头。数据库版本不直接暴露为 API 版本。

## 8.3 分页、筛选和排序

### Cursor 分页

高变动列表使用不透明 cursor：

```json
{
  "items": [],
  "pageInfo": {
    "nextCursor": "opaque",
    "hasNextPage": true
  }
}
```

cursor 编码稳定排序字段和唯一 ID，需签名/校验，不能接受客户端任意 SQL 片段。

### 过滤

- 使用明确白名单参数，如 `regionId`、`categoryId`、`priceMin`。
- 多值使用重复参数或约定数组格式，并写入 OpenAPI。
- 未知筛选返回 400，不静默忽略造成误解。
- 管理后台报表可用 offset，但必须限制最大页、日期范围和导出大小。

### 排序

公开排序只允许产品定义值：`relevance`、`newest`、`price_asc`、`price_desc`、`distance`。付费权重不伪装成纯自然排序。

## 8.4 并发与幂等

- 可编辑资源返回 `version`/ETag；更新要求 `If-Match` 或版本字段。
- 冲突返回 409，并提供当前版本摘要。
- 订单、付款、退款、推广购买、批量后台任务要求 `Idempotency-Key`。
- 幂等记录绑定 actor、endpoint、request hash；相同 key 不同 payload 返回冲突。
- webhook 以 provider event ID 唯一去重；同步返回不视为支付成功事实。

## 8.5 主要端点组

OpenAPI 已定义核心端点，实施时保持下列模块：

```text
/auth/*
/me, /me/sessions, /me/preferences
/regions, /categories, /homepage
/listings, /listings/{id}, /listings/{id}/submit|publish|archive
/listings/{id}/media, /media/uploads
/search/listings, /search/suggestions
/favorites
/conversations, /conversations/{id}/messages
/businesses, /providers, /reviews
/reports
/notifications
/orders, /payments, /wallet
/ads/campaigns, /ads/placements
/admin/moderation/*, /admin/users/*, /admin/config/*
/webhooks/stripe
```

状态变更尽量用子资源或动作端点清晰表达，不允许客户端直接 PATCH 任意 `status`。

`AUTH-001` 已实现 `GET /auth/session` 与 `DELETE /auth/session`。前者从安全 Cookie 解析认证上下文，
仅返回 OpenAPI `SessionResponse` 并设置 `Cache-Control: no-store`；后者通过应用服务幂等撤销数据库
会话并返回同路径、同安全属性的过期 Cookie。`AUTH-002` 实现 `POST /auth/otp/request` 与
`POST /auth/otp/verify`：请求返回 `challengeId` 和过期时间但不返回验证码或账号状态；验证成功后通过
AUTH-001 的会话服务签发同一安全 Cookie。两个端点要求不含 PII 的 `X-Device-Id`，服务端只保存其
HMAC，用于设备绑定和限频。请求认证 Guard 只附加经过有效期、用户状态和软删除检查的上下文；业务对象
授权继续由 `API-004` 的默认拒绝 Policy 完成。

`AUTH-003` 实现 `GET/PATCH /me`、`GET/DELETE /me/sessions` 与
`DELETE /me/sessions/{sessionId}`。资料响应只包含显示名、简介、locale、首选地区、受控头像引用、
版本和更新时间；邮箱、手机号及内部信任字段不进入 DTO。资料更新只接受
`application/merge-patch+json` 白名单字段，要求强 `If-Match` ETag，并以 profile version 原子检测
并发冲突。会话列表按最近活动时间稳定排序，cursor 用 `SESSION_SECRET` 域分离 HMAC 签名并绑定用户；
投影不含 bearer token、token/IP hash。单会话撤销查询始终绑定 actor user ID，未知/他人 ID 与已撤销
ID 共用幂等 204；注销全部撤销全部会话并清除当前 Cookie。

`API-004` 统一把 Session 投影为最小 Actor/RequestContext，并由显式注册的 Policy 动作控制已保护
Controller。`POST /listings` 的现有 Session 要求现在由 `listing:draft:create` 强制执行；OpenAPI
明确声明未登录 401 和无权限/受限账户 403。`Session.permissions` 是服务端生成的 UI capability hint，
不替代每次请求的 Policy，也不接受客户端回传。对象级 action 必须在 Repository scoped query 后以最小
resource context 评估，未知 action 或规则异常失败关闭。

`ORG-001` 新增 `POST /organizations`、`GET /organizations/{organizationId}` 和
`GET /organizations/{organizationId}/members`。创建仅允许 ACTIVE 用户和可创建的四类外部组织，
服务端原子建立初始 OWNER；`INTERNAL`、状态、验证结论和角色不能由客户端 over-post。详情使用成员范围
Repository，跨组织和未知 ID 共用通用 404。成员列表仅 OWNER/ADMIN 可读，采用 actor + organization
绑定的域分离 HMAC cursor，并排除联系方式、账号状态、验证材料和风险字段。当前切片不提供成员写接口；
邀请、撤销和 Owner 转移保持在 ORG-002。

`TAX-001` 实现公开 `GET /regions` 和 `GET /categories`。默认请求返回稳定 ID/slug、中英名称、
原始受控别名与层级树；父级、type/vertical 与 `q` 提供直接子级或扁平匹配。`q` 最长 80 字符，
拒绝控制/双向字符，Repository 使用参数化查询和受控 NFKC 别名键。公开接口的 `activeOnly` 只能
为 true，响应使用五分钟 public cache 与 stale-while-revalidate；未启用 taxonomy 不通过匿名接口
暴露。

`TAX-002` 实现公开 `GET /categories/{categoryId}/form-schema`。缺省读取当前已发布版本，显式
`version` 只读取不可变历史已发布版本；两者均不返回 draft、actor/audit 字段或内部物化配置。响应
返回强 ETag，历史版本可长期 immutable 缓存。应用层同时提供 draft/preview/publish/rollback 与
按精确版本校验 attributes 的服务端能力。`ADMIN-001` 只交付安全 Admin 壳层和角色导航，不提前开放
taxonomy 写端点；后续管理切片必须复用这些能力并增加 MFA/step-up、原因与审计，不能绕过 Repository
直接写 Prisma。

`ADMIN-001` 新增 `GET /admin/session`。它只接受安全 Cookie Session，由后端从 PostgreSQL 当前
有效的平台角色计算 `admin:console:access` 和工作区导航；客户端不能提交 role、permission 或 scope。
未登录返回通用 401，普通/受限用户返回不泄露角色状态的通用 403。成功响应只含安全用户投影、角色、
导航与安全门状态，所有 `/v1/admin/*` 成功或错误响应统一 `Cache-Control: no-store`。独立 Admin
Next.js app 通过同源 `/v1` BFF 仅代理认证与 Admin session allowlist，过滤 hop-by-hop headers，不把
内部 API 地址或任意代理能力暴露给浏览器。当前 `privilegedActionsAllowed=false`；真实后台数据/写动作
等待 `AUTH-005` MFA/step-up 和对应领域任务。

## 8.6 响应投影

不同场景使用明确 DTO：

- `ListingSummary`：列表安全字段，不含联系方式、内部风险分。
- `ListingDetail`：详情公开字段和授权后视图。
- `ListingOwnerView`：草稿、审核原因、指标和管理动作。
- `ListingModerationView`：快照、规则命中、关联风险，仅审核员可见。

不要直接序列化 Prisma 模型；这样可避免新增数据库字段意外泄漏。

## 8.7 上传 API

1. 客户端请求 upload intent，声明用途、mime、大小、hash。
2. API 校验配额和类型，返回短效预签名 URL/object key。
3. 客户端直传私有 quarantine bucket/prefix。
4. 回调或对象事件进入扫描队列。
5. 扫描、解码、重编码、去 EXIF、生成变体。
6. 状态 `READY` 后才能绑定公开信息；公开使用独立 CDN 域和不可执行 content-type。

服务端不信任扩展名或客户端 MIME。文档/验证材料永不进入公共媒体路径。

`MEDIA-001` 已实现 `POST /media/uploads`：仅 ACTIVE 会话具有 `media:upload:create`，请求必须携带
16–128 字符、仅含字母数字及 `._:-` 的 `Idempotency-Key`，以及安全文件名、白名单 MIME、声明字节数和小写十六进制
SHA-256。API 在 owner 级数据库锁内执行 exact retry、最多 20 个未过期 intent 和滚动 24 小时默认
200 MiB 配额；Avatar/Logo 单文件另限 8 MiB，其余已启用图片限 20 MiB。响应是五分钟 `no-store`
S3/MinIO PUT URL，并把 Content-Type、Content-Length、checksum、hash metadata 和服务端加密作为
签名要求。bucket 与不含文件名的 `quarantine/` key 只由服务端配置/生成。`VERIFICATION` 在
MEDIA-003 独立受限桶、KMS 与访问审批完成前返回 422；PDF 不会回退进入普通媒体隔离区。

当前切片只签发并审计 intent。`POST /media/{mediaId}/complete`、对象 HEAD/magic-byte 复核、
扫描/解码/转码、去 EXIF、变体和 READY/REJECTED 生命周期属于 MEDIA-002，不能把 intent 成功误认为
对象已上传或可公开。

## 8.8 Stripe 集成

- API 创建内部 Order，再创建 Checkout Session/Payment Intent，metadata 只放内部引用，不放敏感数据。
- webhook endpoint 使用原始请求体验证签名。
- 先持久化 receipt，再异步处理；重复事件返回成功但不重复履约。
- 付款成功状态只来自受信 webhook/主动查询，不来自浏览器 return URL。
- 退款与 dispute 更新 Order、Payment、Ledger 和广告/推广履约。
- provider 超时采用幂等 key 和查询恢复，不盲目重复创建支付。

## 8.9 邮件、短信和通知

定义端口：`EmailProvider`、`SmsProvider`、`PushProvider`。模板使用稳定 key、locale、版本和变量 schema。通知记录先写库，再由 Worker 发送；provider message id、attempt、失败分类和退订状态可追踪。

OTP 使用独立的 `OtpDeliveryGateway` 端口，以避免把邮件/短信 SDK 渗透进认证领域。当前未确认生产
供应商时适配器 fail closed 并返回通用 503，不记录或回显验证码；测试通过捕获型适配器覆盖 EMAIL/SMS
两条通道。生产投递适配器、重试和供应商回执仍由已规划的通知/Outbox 切片实现，不能用记录明文验证码
或静默丢弃投递代替。

营销与事务通知分开处理。短信/邮件退订不应阻断安全和订单必要通知，但必须遵守法律和用户偏好。

## 8.10 地图/地理编码

通过 `GeocodingProvider` 隔离供应商。只存完成业务所需的规范化地址和坐标；公开输出按 location precision 模糊。对同一地址做缓存和配额保护；用户输入不能直接作为地图 HTML。

## 8.11 Webhook 安全

所有外部 webhook：

- 专用路由和最小 body limit；
- 签名、时间戳和重放窗口校验；
- provider event id 唯一约束；
- 原始 payload 加密/限时保留；
- 快速 ACK，业务异步；
- 失败可重放，处理器幂等；
- 指标覆盖签名失败、积压、处理延迟和永久失败。

## 8.12 Gate 0 HTTP 基线

- Fastify 通用 JSON 请求体默认限制为 1 MiB，可通过受校验的
  `API_BODY_LIMIT_BYTES` 在 1–10 MiB 范围内调整；上传和 webhook 端点使用后续任务定义的更窄限制。
- `X-Request-Id` 只接受最长 128 字符的安全字符集，不合规值会替换为 UUID；所有响应回传
  `X-Request-Id`。
- DTO 对未知字段和未知 query 参数返回 400；字段错误放在 RFC 9457 Problem Details 的
  `errors` map 中。
- CORS 仅允许配置的 Web/Admin origin 并允许凭据。带会话 Cookie 的修改请求必须同时具有受信
  `Origin`；webhook 路由不使用 Cookie，后续由签名与重放保护负责。
- Problem Details 不返回 stack、provider 原始错误或查询字符串，错误响应设置
  `Cache-Control: no-store`。

## 8.13 Gate 0 OpenAPI 契约基线

- `openapi/openapi.yaml` 是唯一 REST 契约事实源；API 启动时读取该文件，Swagger UI、
  `/docs/openapi.json` 与 `/docs/openapi.yaml` 均从同一文档提供，不再从装饰器生成另一份子集。
- Redocly 在本地 `pnpm openapi:lint` 和 CI 中执行 OpenAPI 3.1、引用、operationId 与结构校验。
  所有 endpoint 都有摘要、Tag 描述和明确响应；结构、语义或未使用组件错误会阻断质量门。
  项目负责人尚未确认软件许可证，因此 `info-license` 暂时关闭；`operation-4xx-response` 不适用于
  liveness 等永远不应返回 4xx 的端点，也不作为全局规则。
- 契约测试解析并解引用文档，校验 38 个 path、75 个 schema、47 个唯一 operationId，
  验证所有 schema 示例，并把已实现的健康检查和 Problem Details 实际响应与契约对照。
- API 生产镜像必须携带 `openapi/` 目录；缺失或不可解析的契约会令 API 在绑定端口前启动失败。

## 8.14 契约生成方向

方向固定为 **OpenAPI → TypeScript 类型 → 运行时适配器**：

1. 只在 `openapi/openapi.yaml` 中定义公共 HTTP 结构；运行 `pnpm openapi:generate` 生成
   `packages/contracts/src/generated/openapi.ts`，该文件禁止手改。
2. `@socal/contracts` 从生成的 `components`/`operations` 导出稳定别名。Zod 仅作为运行时输入
   适配器，并以生成类型作为 `ZodType` 输出约束；不能另写一套独立接口。
3. Nest Controller 对已实现请求直接使用共享 Zod schema 与生成类型，不再维护 Swagger
   装饰器 DTO。Swagger 仍只服务 canonical OpenAPI。
4. `pnpm openapi:check` 在本地与 CI 重新生成到内存并检测提交文件漂移；OpenAPI 改动若未重新
   生成会阻断质量门。

数据库模型和内部领域对象不从 OpenAPI 生成；它们通过显式 application mapping 隔离，避免把
私有字段意外暴露为公共响应。
