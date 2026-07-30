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
内部 API 地址或任意代理能力暴露给浏览器。

`AUTH-005` 新增三个 no-store、Cookie + same-origin 保护的端点：

- `POST /admin/mfa/enrollment` 幂等返回当前短效 pending TOTP 设置；
- `POST /admin/mfa/enrollment/verify` 激活 TOTP、一次性返回十枚恢复码并轮换 Session；
- `POST /admin/mfa/verify` 使用未重放的 TOTP 时间步或未消费恢复码建立/刷新 MFA 与近期认证。

`GET /admin/session.security` 返回是否已设置 MFA、`PRIMARY|MFA` 认证强度、验证/step-up 到期时间以及
普通特权与敏感动作两个服务端状态。它仍不是业务授权凭证；真实后台 controller 必须声明对应 Policy。
OpenAPI 不提供禁用/重置接口，防止自助降级；人工恢复流程必须由后续审计、身份核验和会话全撤销切片实现。

`AUTH-004` 新增三个公开、`no-store` 的可选密码端点：

- `POST /auth/password/login` 接受 email/E.164 与密码，成功建立普通 PRIMARY Session；
- `POST /auth/password/recovery` 对存在/不存在目的地返回同形 202，恢复证明经 side channel 交付；
- `POST /auth/password/recovery/confirm` 在冷却后单次消费证明、替换密码并撤销全部 Session，不自动登录。

三个端点都要求 16–128 字符的 opaque `X-Device-Id`；登录和恢复分别按 identifier/destination、IP、
device 限流。错误凭据不区分账号存在、账号状态或密码状态；冷却/限流返回 bounded `Retry-After`。
OpenAPI/共享 Zod 契约只暴露请求 ID、恢复请求 ID 和时间窗，不回传 token、hash、联系方式状态或
provider 错误。

## 8.6 响应投影

不同场景使用明确 DTO：

- `ListingSummary`：列表安全字段，不含联系方式、内部风险分。
- `ListingDetail`：详情公开字段和授权后视图。
- `ListingOwnerView`：草稿、审核原因、指标和管理动作。
- `ListingModerationView`：快照、规则命中、关联风险，仅审核员可见。

不要直接序列化 Prisma 模型；这样可避免新增数据库字段意外泄漏。

`LIST-002` 已在数据库包实现内部 `PublicListingProjection`、`OwnerListingProjection` 和
`ModeratorListingProjection`，三者各有显式 Prisma `select`，不共享“读取整行再删除字段”的实现。
公开读取只查询当前已批准、已发布、未过期、未删除且 taxonomy/发布主体可用的内容；owner 读取在同一
查询中绑定直接 owner 或当前 organization member；moderator 读取先验证当前
`MODERATOR|SENIOR_MODERATOR` grant 的撤销/到期状态，再按 region/category scope 匹配资源。缺失资源
和越权读取均返回内部 `null`，由后续 HTTP use case 统一映射通用 404。

动态 `attributes` 不是无条件 JSON：Repository 使用 Listing 固定的精确历史
`formSchemaVersion` 读取已发布 schema，并按 `PUBLIC`、`OWNER_ONLY`、`MODERATOR_ONLY` 分层白名单
投影。schema 缺失/损坏、重复字段和 schema 外属性都失败关闭为空对象。公开层没有精确坐标、
`contactMode`、审核状态、owner/organization 内部关联或 `qualityScore`；owner 层没有审核员字段或内部
评分；moderator 层也不读取账号邮箱/电话、organization legal name 或精确坐标。

`LIST-003` 已把安全投影接入 `POST /listings`、`GET /listings/{listingId}` 和
`PATCH /listings/{listingId}`。创建必须带 16–128 字符 `Idempotency-Key`，成功返回 201、Location、
强 ETag 和 `no-store`；同 actor/key 精确重试返回原资源，不同 payload 返回 409。详情对当前个人
owner/当前组织成员返回 `ListingOwnerView` 和 `no-store`，未发布草稿对 guest/无关 actor 统一 404；
公开详情只返回 `PublicListingView`。更新是严格 merge patch，要求形如 `"listing-vN"` 的强
`If-Match`；版本竞争返回 409 和当前 ETag，不会静默覆盖。组织 `OWNER|ADMIN|EDITOR` 可更新，
`BILLING|ANALYST` 只读；状态/价格/分类/地区/精确历史 attributes 在服务端再次验证。

`LIST-004` 将 `mediaIds` 纳入 owner 投影和创建/更新契约，数组最多 20 个且必须唯一。应用层不信任
客户端上传完成声明；Repository 在事务中锁定并复核 READY、用途、类型、owner/同 Listing 归属，
无效、跨 owner、跨 Listing 和未扫描 ID 统一映射为字段级 422，且不会先递增 Listing version。

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

`MEDIA-002` 已实现 `POST /media/{mediaId}/complete`。API 仅对当前 ACTIVE owner 的 UPLOADING
asset 调用对象存储 HEAD，使用服务端返回的长度、MIME 和 checksum/受签 metadata 与 intent 对比；
跨 owner/未知 ID 统一 404，过期或不一致对象进入 REJECTED 并返回 422，存储不可用返回不泄露 provider
信息的 503。成功仅返回 `202 SCANNING`，重复请求按资源状态幂等返回 SCANNING/READY，绝不把上传完成
误报为 READY。

同事务 Outbox 驱动 Worker 重新读取有界原始字节并独立复算长度/SHA-256，验证 JPEG/PNG/WebP magic
bytes，执行 ClamAV INSTREAM 和 Sharp 解码/像素上限/方向校正，再生成 THUMBNAIL、CARD、FULL 三个
WebP。重编码不复制 EXIF、ICC 或原始 metadata；变体使用确定性安全 key、SSE 和 immutable cache metadata。
永久内容错误进入 REJECTED，ClamAV/S3 等暂时故障抛回 BullMQ 重试；重复/乱序 event 由
`lifecycleVersion` 关闭。只有数据库 READY 和完整三变体集可供后续 Listing 绑定，原始 quarantine
对象及当前 processed bucket 都不直接匿名公开。

`LIST-004` 新增 owner-scoped `GET /media/{mediaId}`，只返回 UUID、四态
`UPLOADING|SCANNING|READY|REJECTED`、稳定拒绝码和更新时间，并强制 `no-store`；未知、删除和跨 owner
标识统一 404，bucket、object key、hash、原图 URL 与 provider 错误不进入响应。Web 通过同源
`/v1` BFF 的 method + UUID path allowlist 调用 session、taxonomy、form schema、Listing 草稿和媒体
生命周期端点；任意 Admin、DELETE、方法混淆或 malformed 路径失败为 404，代理不开放通用 API 穿透。

## 8.8 Stripe 集成

- API 创建内部 Order，再创建 Checkout Session/Payment Intent，metadata 只放内部引用，不放敏感数据。
- webhook endpoint 使用原始请求体验证签名。
- 先持久化 receipt，再异步处理；重复事件返回成功但不重复履约。
- 付款成功状态只来自受信 webhook/主动查询，不来自浏览器 return URL。
- 退款与 dispute 更新 Order、Payment、Ledger 和广告/推广履约。
- provider 超时采用幂等 key 和查询恢复，不盲目重复创建支付。

## 8.9 邮件、短信和通知

定义端口：`EmailProvider`、`SmsProvider`、`PushProvider`。模板使用稳定 key、locale、版本和变量 schema。通知记录先写库，再由 Worker 发送；provider message id、attempt、失败分类和退订状态可追踪。

`NOTIF-001` 已实现站内通知基线：Listing 状态 Outbox 事件由 Worker 严格校验 envelope，并用
`source_event_id + user_id + channel` 唯一键及事件级 advisory lock 幂等投影；中英文已发布模板行
不可修改或删除，Notification 保存模板版本、locale、渲染后的 title/body、资源引用与聚合版本快照。
`GET /notifications` 使用绑定 user 与 unread filter 的 HMAC 游标，`PUT
/notifications/{notificationId}/read` 仅能更新当前用户记录且可安全重试；两个端点均 `no-store`，外部
ID 与未知 ID 共用 404。当前切片只投递 `IN_APP`，邮件/SMS provider、偏好、退订、回执和重试属于
`NOTIF-002`，不得由空适配器伪装为成功。

OTP 使用独立的 `OtpDeliveryGateway` 端口，以避免把邮件/短信 SDK 渗透进认证领域。当前未确认生产
供应商时适配器 fail closed 并返回通用 503，不记录或回显验证码；测试通过捕获型适配器覆盖 EMAIL/SMS
两条通道。生产投递适配器、重试和供应商回执仍由 `NOTIF-002` 实现，不能用记录明文验证码
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
- 契约测试解析并解引用文档，校验 64 个 path、137 个 schema、74 个唯一 operationId，
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

## 8.15 Listing 提交契约

`POST /listings/{listingId}/submit` 无请求体，必须携带强 Listing ETag 的 `If-Match` 和
16–128 字符的 `Idempotency-Key`。成功固定返回 202、`no-store`、新 ETag，以及前后内容/
审核状态、风险层、规则集版本、可空 caseId、发生时间和资源版本。响应不公开命中规则、
阈值或输入摘要。相同 actor/key/Listing 版本返回原结果；同 key 不同请求返回 409。
owner 范围外统一 404，受限账户 403，缺少/错误前置条件 400。

## 8.16 Admin Listing 审核契约

`GET /admin/moderation/cases` 固定 `listing-submission` 队列，默认 OPEN，limit 最大 50；priority、
riskTier 和 cursor 均严格校验。cursor 使用 HMAC 并绑定 actor、队列、状态与筛选，不能跨账号或修改
筛选重放。`GET /admin/moderation/cases/{caseId}` 返回强 ETag、不可变脱敏快照、首提 diff、稳定规则
证据、媒体扫描状态、发布者聚合和可用动作；所有 Admin 响应均 no-store。

`POST /admin/moderation/cases/{caseId}/actions` 要求 `If-Match`、`Idempotency-Key`、recent MFA 和
APPROVE/REQUEST_CHANGES/REJECT/ESCALATE 对应的标准原因码。精确重试返回相同投影；同 key 不同请求、
陈旧版本或并发处置返回 409。401/403/404 均使用通用 Problem Details，不暴露角色、案件或 PII。

## 8.17 ORG-002 成员生命周期契约

- `POST /organizations/{organizationId}/invitations` 要求 OWNER/ADMIN、严格非 Owner 角色和
  `Idempotency-Key`；成功返回 201、Location 和短效邀请投影。
- `PUT /organization-invitations/{invitationId}/accept` 只允许邀请绑定用户接受；过期返回 410，未知、
  撤销或非本人统一 404。`DELETE /organizations/{organizationId}/invitations/{invitationId}` 由
  OWNER/ADMIN 幂等撤销仍处于 PENDING 的邀请。
- `PATCH /organizations/{organizationId}/members/{memberUserId}` 要求强 membership ETag；仅允许
  ADMIN/EDITOR/BILLING/ANALYST，陈旧版本返回 409。同路径 DELETE 不能删除 self 或 Owner。
- `POST /organizations/{organizationId}/owner-transfer` 要求 `Idempotency-Key`、当前 OWNER 和近期
  MFA；响应是不可变 from/to/结果角色/时间凭据。所有写接口均 no-store、同源校验、Repository 再授权，
  且不接受邮箱、手机号、Owner role 或客户端声明的组织角色。

`/auth/mfa/enrollment`、`/auth/mfa/enrollment/verify` 和 `/auth/mfa/verify` 是普通 ACTIVE 用户的
自有 TOTP step-up 别名；不会授予平台角色，仍复用一次性恢复码、重放保护、限频和 Session rotation。

## 8.18 Listing 举报与申诉契约

- `POST /reports` 只接受登录用户对公开 Listing 的稳定原因和可选说明，必须带
  `Idempotency-Key`，返回 202 opaque receipt。精确重试或活动同目标去重返回同一资源并标记
  `deduplicated`；同键不同载荷返回 409，每账号小时配额返回 429。响应不包含举报者、证据正文或内部
  优先级。
- `POST /appeals` 只接受 Listing Owner 针对 30 天内可申诉的下架 Action，必须带
  `Idempotency-Key`，返回 202 receipt 与明确 deadline；同一 Action 只能创建一次。
- `GET /admin/moderation/reports|appeals` 和对应 `{id}` 详情要求 MFA moderator，使用有界签名 cursor、
  `no-store` 与强 Case ETag。详情包含脱敏快照、稳定原因和动作历史，但从契约层移除 reporter identity。
- 两个 `POST /admin/moderation/.../{id}/actions` 端点要求 recent MFA、`If-Match` 和
  `Idempotency-Key`。Report 动作是 DISMISS/REMOVE_CONTENT/ESCALATE；Appeal 动作是 UPHOLD/RESTORE，
  每个动作只接受配套原因码。失效角色、跨资源、原审核员复核、陈旧版本、键冲突和非法状态均返回
  通用 Problem Details，不暴露内部存在性或规则阈值。

## 8.19 Listing 修订与重大编辑契约

- `GET /listings/{listingId}/revisions` 是 owner/组织读取角色专用、`no-store` 的 cursor collection；
  返回 revision number、分类、稳定原因、脱敏字段级 diff、风险/规则版本、审核状态、actor 和发生时间，
  不返回完整 snapshot、哈希、session、幂等证据或私有值。未知/跨 owner/已删除 Listing 统一 404。
- `ListingOwnerView.latestRevision` 返回可空的最近 revision 摘要，使 owner 在草稿详情响应中看到重大
  编辑为什么重审；公共 `PublicListingView` 不增加审核历史。
- 对 `PUBLISHED` Listing 的 `PATCH /listings/{listingId}` 必须同时携带强 `If-Match` 和
  `Idempotency-Key`。精确重试返回原 revision/result；同 key 不同 request 返回 409。minor edit
  仍返回公开 owner view；major edit 返回新的 SUBMITTED/PENDING_REVIEW 或 ESCALATED 状态。
- 这些都是 `/v1` 向后兼容增量：草稿 PATCH 的既有客户端无需幂等键，新增 collection/schema 与
  nullable owner 字段不改变公共响应。OpenAPI 与生成 TypeScript 是唯一 REST 契约事实源。

## 8.20 私有 Listing 管理契约

- `GET /me/listings` 要求当前 Session，接受 `bucket=DRAFT|PENDING|PUBLISHED|ARCHIVED`、可选
  Listing type/organization、1–50 limit 和不透明 cursor。响应只包含最小管理摘要、server-derived
  `availableActions`、四 bucket 计数、分页信息和生成时间，并强制 `no-store`。
- cursor 使用独立 domain 签名并绑定 actor、bucket、type、organization、limit 与稳定
  `(createdAt,id)` 边界；篡改、跨账号或跨筛选重放返回通用 400。
- `POST /me/listings/actions` 仅接受 ARCHIVE/DELETE，以及 1–20 个唯一
  `{listingId,version}`。响应顺序与请求一致，每项为 APPLIED、NOT_FOUND、VERSION_CONFLICT 或
  STATE_CONFLICT；一个对象失败不会授权另一个对象，也不会回滚已经独立成功的对象。
- 批量写要求 ACTIVE actor 和可信同源 Cookie mutation；每项继续使用既有强版本、对象 Policy、
  行锁、Audit/Outbox 与目标状态幂等语义。只读组织角色和跨 owner 对象统一映射 NOT_FOUND。
- 两个端点、生成 TypeScript、Zod 边界、API Controller、Web BFF allowlist 与契约测试同步更新；
  OpenAPI 仍是唯一 REST 事实源。

## 8.21 MOD-003 重复候选契约

- Listing 提交和已发布编辑不新增公共请求字段；服务端按已绑定 READY 媒体和历史表单 schema 自动
  计算候选。候选结果属于审核证据，不返回 Owner 或公共 Listing API。
- 现有 `GET /admin/moderation/listings/{caseId}` 的 `duplicateCandidates` 最多 10 条，只暴露候选
  Listing ID/版本/类型/标题/状态、阈值版本、DRY_RUN/ENFORCE、MEDIUM/HIGH 与 TEXT/IMAGE/CONTACT
  信号。契约不暴露原始联系方式、HMAC、对象 key、相似分值、Hamming 距离或阈值数值。
- `DUPLICATE_CONTENT` 仅在案件已有重复候选时才是 `REQUEST_CHANGES|REJECT` 的稳定原因；没有
  候选证据时服务层与 repository 均 fail closed。批准仍使用 `CONTENT_POLICY_COMPLIANT`。动作继续
  要求当前 MFA moderator、recent step-up、强 ETag 和 actor-scoped `Idempotency-Key`，精确重试
  不得重复记录人工反馈指标。
- OpenAPI、生成 TypeScript、严格 Zod、API 映射和 Admin 双语界面同时更新；没有新增服务、API
  范式或版本边界。

## 8.22 WEB-004 账户会话消费契约

`WEB-004` 不新增或修改公共 API、OpenAPI schema、Prisma model 或 migration。Web 继续消费既有
`GET /auth/session` 的 `SessionResponse`，并在客户端边界严格校验 UUID、ISO 到期时间、有界去重
permission/role、用户状态及最多 50 个最小组织摘要。`permissions` 只决定已实现导航是否出现；
页面数据继续调用各自 no-store owner API，任何 mutation 继续使用服务端 Policy、对象授权、并发和
幂等契约。401 表示未登录；其他失败或 malformed payload 不降级为匿名假数据，也不保留旧能力。

## 8.23 SEARCH-003 公共查询契约

- `GET /search` 是无认证、`no-store` 的 Listing 搜索端点；只接受 OpenAPI 明示的 q/type/category/
  region/price/geo/sort/cursor/limit，limit 最大 50，unknown query key 返回 400。
- `SearchListingResult` 是独立最小 DTO，不复用包含 body、moderation、stats 等字段的 `Listing`。
  `SearchFacets` 固定为 types/categories/regions/priceUnits，不能由 provider 返回任意聚合名。
- `SearchCursorPage.nextCursor` 最长 2048 且必须与全部 query 条件一致；失效 cursor 返回 410。
  OpenSearch 超时返回 504，依赖或投影不可用返回 503，全部使用 RFC 9457 Problem Details。
- 价格输入是最多两位小数的 decimal string，响应复用 `Money`；距离仅在 DISTANCE 排序时返回，
  位置仅来自已经模糊化的公共索引 point。`correctedQuery` 仅在命中已发布同义词的非 canonical
  精确词时返回 canonical 值。

## 8.24 SEARCH-004 发现契约

- `GET /search/suggestions` 的 q 可省略；q 最大 50，regionCode、locale 和 limit 均严格有界，
  unknown key 返回 400。响应是 strict `SearchSuggestionResponse`，类型仅 QUERY/CATEGORY/REGION，
  最多 10 条，使用 `private, no-store`。
- `GET /search/trending` 只接受 DAY_1/DAY_7/DAY_30、可选 region/locale 和 1–10 limit。strict
  `SearchTrendingResponse` 只返回 query/rank/locale，不返回原始计数或来源数，缓存为
  `public, max-age=300`。
- 两个端点无认证但不使用客户端身份决定隐私阈值；依赖不可用返回 503 Problem Details。低于五个
  独立来源、敏感或 bot 流量不会进入公共结果，空结果是真实状态而不是模拟数据。
- 词典维护没有开放匿名/公共 mutation；内部 `SearchDictionaryService` 验证定义、生成 content hash，
  再经 Store/Repository 保存、双人发布或追加式回滚。未来 Admin UI 必须复用该应用服务与 Policy，
  Controller 不得直接调用 Prisma。

## 8.25 TAX-003 首页布局内部契约

`HomepageLayoutService` 是应用层边界，负责严格验证、规范化和内容 hash；Store/Repository 负责
scope 行锁、乐观并发、发布与追加式回滚。TAX-003 不新增公共 HTTP endpoint，因而 OpenAPI 不变；
`WEB-002` 必须复用该服务生成 `GET /v1/homepage` 的公开投影，不得让 Controller 直接访问 Prisma。
发布事件是最小化 cache-invalidation 信号，不携带 layout 正文，消费者须从 PostgreSQL 重读指定版本。

## 8.26 WEB-002 公共首页聚合契约

- `GET /homepage` 是无认证聚合端点；只接受 `locale`、`regionCode` 和 `device`，
  unknown query key 返回 400。未找到对应已发布布局返回 503 Problem Details，不回退到草稿或 seed。
- 响应固定包含布局版本、scope、设备、生成时间、`partial` 和按发布布局顺序排列的模块。当前公开
  discriminated union 只允许 HERO、HOT_SEARCHES、CITY_CHIPS、LISTING_FEED；尚无真实实现的商家、
  师傅、广告、行情、资源产品和角色入口不会被序列化为空壳或占位内容。
- 每个模块包含内容 hash `dataVersion` 与有界 TTL/tag 元数据。热门词沿用至少五个独立来源及读取时
  二次隐私筛查；城市只来自 active CITY taxonomy；Listing feed 只读取当前地区、PUBLISHED 且未过期的
  canonical PostgreSQL 公共投影，并再次移除精确坐标、正文、联系方式、审核和风险字段。
- 单个数据源失败只省略对应模块并令 `partial=true`；真实空集合省略模块但不伪装为故障。Controller
  只做生成契约校验、缓存头和 Problem Details 映射，应用服务编排 Store 端口，数据库 adapter 独占
  Repository/Prisma 访问。

## 8.27 PERF-001 缓存与性能遥测契约

- 完整首页响应为 `public, max-age=0, s-maxage=30, stale-while-revalidate=30`；`partial=true`、
  validation/provider/Redis 错误和 Problem Details 均为 `no-store`。
- API/Worker 通过共享 helper 生成 `socal:homepage:v1:<locale>:<encoded-region>:<device>`；Redis
  内容必须再次通过 `HomepageResponse` strict Schema 且与 key scope 相符，最大 1 MB。TTL 为所有
  返回模块最小 TTL、包含 0 即不缓存、整体封顶 300 秒。
- `POST /performance/web-vitals` 只接受 CLS/FCP/INP/LCP/TTFB、六个固定 route 类别和有限非负数值，
  返回 no-store 202；unknown 字段、URL、标识和自由文本为 400，短窗口超限为 429。
- Controller 只设置缓存/状态并委托应用服务；Redis adapter、请求合并和低基数指标不接触 Prisma，
  CWV 数值不作为可信业务事实。
