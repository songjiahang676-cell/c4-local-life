# 06. 领域与数据模型

## 6.1 领域边界

模块化单体按业务能力而不是技术层划分。建议 API 内部模块如下：

| 模块          | 责任                                   | 拥有的核心数据                                |
| ------------- | -------------------------------------- | --------------------------------------------- |
| Identity      | 用户、身份提供方、会话、验证、账户状态 | users, identities, auth_sessions              |
| Organizations | 商家/服务商/供应商组织与成员           | organizations, memberships                    |
| Taxonomy      | 地区、分类、动态表单、别名             | regions, categories                           |
| Listings      | 五类信息、详情扩展、版本、生命周期     | listings, *_details, listing_media            |
| Media         | 预签名上传、扫描、变体、访问策略       | media metadata / object keys                  |
| Search        | 索引投影、查询、同义词、热词           | OpenSearch indices, search config             |
| Messaging     | 会话、参与者、消息、屏蔽               | conversations, participants, messages         |
| Trust         | 商家/师傅档案、验证、评价              | business_profiles, provider_profiles, reviews |
| Moderation    | 规则命中、举报、案件、动作、申诉       | reports, moderation_cases/actions             |
| Notifications | 模板、偏好、站内/邮件/短信投递         | notifications, delivery attempts              |
| Commerce      | SKU、订单、支付、退款、积分账本        | orders, payments, wallet_entries              |
| Advertising   | 活动、素材、库存、排期、履约           | ad_campaigns, creatives, placements           |
| Analytics     | 事件契约、聚合指标、实验               | event stream / warehouse projections          |
| Admin/Audit   | 后台授权、配置、审计                   | platform_role_assignments, audit_logs         |

模块可在同一数据库中使用独立 repository 和 service 边界。禁止把“同库”理解为可任意跨表写入。

## 6.2 核心聚合

### Listing 聚合

根实体 `Listing` 存放跨类型共享字段，类型特有字段放在一对一 detail 表：

- `JobDetail`：雇主、雇佣类型、薪资、经验、远程、签证支持。
- `RentalDetail`：房型、卧室/浴室、面积、押金、可入住日、租期、家具、宠物、停车。
- `TransferDetail`：业务类型、要价、租金、剩余租期、转让原因、库存。
- `SecondhandDetail`：成色、品牌、型号、交付方式。
- `ServiceDetail`：服务半径、执照、保险、紧急服务和时间。

不变式：

1. 一个 Listing 只能有与 `type` 匹配的一个 detail。
2. `PUBLISHED` 必须有 `publishedAt`，并已通过适用审核。
3. 公开查询只返回 `status=PUBLISHED`、未删除、未过期且地区/分类有效的数据。
4. 价格与货币组合合法；`FREE/NEGOTIABLE` 不应要求固定金额。
5. 精确地点只对获授权方返回；公开坐标按精度策略模糊化。
6. 每次更新递增 `version`，并用乐观并发控制。
7. 重大字段变化产生新的审核快照，而不是覆盖审核证据。

`LIST-001` 将这些规则实现为不依赖 Nest/Prisma 的纯领域边界
`apps/api/src/modules/listings/listing-domain.ts`。五类 detail 使用 `kind` 判别联合并在运行时再次校验
必须与 Listing `type` 一致；金额只接受 `bigint` 最小货币单位和 `USD`，`FREE/NEGOTIABLE`
必须没有金额，其余价格必须为正数且不超过数据库精度。Job 薪资上下限、Rental 房间/押金、
Transfer 要价/租金/剩余租期、Secondhand 成色和 Service 半径都有有界规则。

内容状态和审核状态保持正交但受组合矩阵约束：草稿只能 `NOT_REVIEWED|REJECTED`，提交态只能
`PENDING_REVIEW|ESCALATED`，公开/过期/归档只能 `AUTO_APPROVED|APPROVED`，暂停态记录
`REJECTED`。所有转换要求当前 `expectedVersion`、非倒退 UTC 时间、actor 和稳定原因码，成功后
只生成新聚合与前后状态事件并递增版本；发布期限由调用方显式传入 1–365 天，过期动作不能早于
`expiresAt`。`LIST-002` 已由 `packages/database` 的 Listing Repository 接入只读持久化边界；
`LIST-003` 已接入草稿创建与条件更新写事务。领域规则本身不直接操作 Prisma，也不自行决定运营发布期限。

`LIST-002` 使用三套显式 Prisma `select` 和独立返回类型，而不是序列化完整 Listing。公开读取在 SQL
条件中同时要求已发布、已批准、发布时间已到、尚未过期、未删除、有效地区/分类，以及可用 owner/
organization；owner 读取把直接 owner 或当前 organization membership 与 actor 状态放进查询；
moderator 读取只接受当前未撤销、未过期且 region/category scope 匹配的 `MODERATOR`/
`SENIOR_MODERATOR`。不同权限层的动态 attributes 始终按 Listing 保存的精确
`formSchemaVersion` 重新读取已发布定义并投影；定义缺失、损坏、字段重复或未知 attribute 时失败关闭，
绝不返回原始 JSON。公开投影不含精确坐标、联系方式、审核状态和内部评分；owner 可读取自己的精确点和
审核状态但不含审核员字段；moderator 可读取受控内部状态和三层动态字段，但仍不读取邮箱、手机号、
组织 legal name 或精确坐标。

`LIST-003` 的草稿创建把 `owner + Idempotency-Key` 和 canonical request hash 保存为配对证据；同一
actor/key 的精确重试返回原草稿，不同 payload 返回 409，事务级 advisory lock 防止并发重复插入。
更新先锁定 Listing，再要求当前 `DRAFT`、当前个人 owner 或组织 `OWNER|ADMIN|EDITOR`、精确历史表单
schema 和 `expectedVersion`；条件更新只允许一个并发请求成功。每次成功创建/更新在同一 PostgreSQL
事务追加最小化 `AuditLog` 与版本化 Outbox，事件不含标题、正文、attributes、联系方式或幂等证据。
组织 Listing 的创建者不享有永久旁路；移除 membership 后即失去 owner 投影视图和写权限。

### Organization 聚合

Organization 是可多人管理的商业主体。商家、师傅团队和供应商共享成员模型，但对应 profile/verification 能力不同。

不变式：至少一名 Owner；slug 唯一；被暂停组织不能创建新公开内容；删除组织前必须处理信息、订单和 Owner 关系。

`ORG-001` 的创建 Repository 在单一 PostgreSQL 事务中验证 ACTIVE actor、插入 Organization 并插入
初始 OWNER membership；任何一步失败都不留下无 Owner 组织。slug 是全局唯一的稳定重试句柄：同一 Owner
以完全相同的 payload 重试返回原资源，换 Owner 或不同 payload 返回冲突。成员范围读取把
`actorUserId + organizationId` 放入查询条件；成员列表还在 SQL 中要求当前角色为 OWNER/ADMIN，并只投影
display name、受控头像、角色和加入时间，不读取邮箱、手机号或内部风险字段。邀请、移除、角色变更、
至少一名 Owner 的并发维护及 step-up Owner 转移属于 ORG-002。

### Identity 聚合

`User`、`UserProfile` 与 `AuthSession` 构成认证后的账户管理边界。资料通过递增 `version` 做乐观并发，
避免多端编辑静默覆盖；联系方式和内部信任状态不属于自助资料 DTO。会话只保存 bearer token 的域分离
HMAC，设备管理投影不暴露 token/IP hash。`users.status` 或 `deleted_at` 变化时数据库 trigger 撤销该
用户全部未撤销 session，确保 Admin、删除编排或后续 application service 都不能绕过账户状态不变量。

`PlatformRoleAssignment` 是与组织 Membership 分离的平台员工授权历史。它保存显式角色、可选最小范围、
reason code、grant/revoke actor、授予/到期/撤销时间；数据库要求 scope 为 JSON object、到期晚于授予、
撤销时间/操作者同时存在，并禁止同一用户/角色出现两个未撤销 grant。过期授权仍保留为审计历史，并须由
后续受控授权工作流显式撤销后再授予。认证 Repository 每次解析 Session 时按当前时间过滤过期/撤销行，
所以降权不依赖客户端 token 刷新；`ADMIN-001` 不提供角色写 API，bootstrap 只能走受审计维护流程。

`AUTH-005` 为 `AuthSession` 增加 `PRIMARY|MFA` 强度与 `mfa_verified_at`，MFA 换发时在同一事务撤销
旧 Session。每个 User 最多一个 `MfaCredential`；pending/active/disabled 时间状态由数据库 check
约束，TOTP secret 只保存 AES-256-GCM 密文、key version、最后消费时间步和失败锁定元数据。
`MfaRecoveryCode` 只保存域分离 hash 与消费时间，`credential + hash` 唯一。激活、时间步消费和恢复码
消费均在事务内追加最小化 `AuditLog`，并用条件更新使并发重放最多一个成功。

`AUTH-004` 在 User 上增加可空版本化 `password_hash`、`password_changed_at`、有界失败计数与锁定时间。
`PasswordAuthAttempt` 只保存 identifier/IP/device 的域分离 hash、可空 user 关联和
PENDING/SUCCESS/FAILURE 结果，用于三维限流和安全诊断，不保存凭据或 PII 原文。
`PasswordRecoveryRequest` 保存可空 user、channel、destination/token/IP/device hash、冷却/到期、
失败次数、消费/取代时间；窗口、终态与失败次数由数据库 check 约束。成功恢复在同一事务更新 User、
撤销全部 `AuthSession`、消费请求并追加 `auth.password.recovered` 审计，保证重放和部分提交失败关闭。

### Media 聚合

`MediaAsset` 在任何业务资源绑定前记录上传所有权、用途、类型、声明字节数、SHA-256、私有 bucket/key、
短效过期时间和 owner 范围幂等键。对象键只能是服务端生成的
`quarantine/<两位分片>/<media UUID>/original`，不包含原始文件名或用户标识。创建 intent 在 owner
advisory transaction lock 内依次处理 exact retry、ACTIVE actor 复核、未过期活动数量和滚动 24 小时
字节配额，再插入元数据；同一 `owner + Idempotency-Key` 的不同 payload 冲突。`ListingMedia` 仍是现有
公开变体投影；`LIST-004` 在 `MediaAsset` 上增加 nullable `listingId` 和稳定 `sortOrder` 作为私有草稿
绑定证据。Repository 先按 UUID 顺序锁定候选 asset，要求 `LISTING_MEDIA + IMAGE + READY`、当前
actor 所有或已经绑定到同一可编辑 Listing，随后才在同一 Listing 写事务中绑定/解绑。数据库 check
同时禁止把未扫描、非图片或非 Listing 用途的 asset 绑定，跨 Listing 复用由锁和外键失败关闭。

`MEDIA-002` 把生命周期扩展为 `UPLOADING → SCANNING → READY/REJECTED`。API 只根据受信 `HeadObject`
元数据完成 owner 范围的对象确认，并在同一事务递增 `lifecycleVersion`、写入状态和
`media.upload.completed` Outbox；Worker 再重新读取原始对象、计算精确字节数/SHA-256、检查
JPEG/PNG/WebP magic bytes、调用 ClamAV、使用 Sharp 解码与自动旋转，并生成不携带 EXIF/ICC 的
THUMBNAIL/CARD/FULL WebP。`MediaVariant` 以 `(mediaAssetId, kind)` 唯一，key 固定为
`processed/<两位分片>/<media UUID>/<kind>.webp`。READY/REJECTED 终态与对应 Outbox 事件在一个
PostgreSQL 事务内提交；重复或过期 lifecycleVersion 只能返回 existing/stale，不能覆盖新状态。

### Conversation 聚合

会话可关联一个 Listing，参与者集合固定受控；消息追加写入，编辑/删除保留时间戳。阻塞状态影响发送权限，不泄露封禁策略细节。

### Order/Wallet 聚合

订单表示购买意图和履约；支付表示外部资金状态；钱包条目表示积分/信用的不可变变动。当前余额是条目求和或经过校验的投影，不允许直接 `UPDATE balance = ...`。

## 6.3 数据库设计原则

- 主键：内部 UUID；高写入表可后续评估 UUIDv7，但需统一迁移策略。
- 时间：`timestamptz`，数据库/服务统一 UTC。
- 金额：`numeric(14,2)` 或以 minor units 存储；明确币种。
- 文本：标题等有长度上限；正文保留纯文本/受控富文本源，不存未清洗 HTML。
- 软删除：公开内容、用户、组织采用 `deletedAt`；财务记录不可物理覆盖。
- JSON：仅用于可演进、非关键查询属性；关键筛选和约束字段使用列/表。
- 多语言：分类/地区可使用翻译表或受控 JSON；用户内容不自动生成权威翻译。
- 地理：PostGIS geometry/geography 用于半径和边界查询；Prisma 不支持部分能力时通过 SQL repository 封装。
- 审计：业务表的 `updatedAt` 不替代审计日志。

当前 `ListingGeoRepository` 是地理读取的唯一基础封装：它查询由公开模糊经纬度生成的 `geography(Point, 4326)`，使用 `ST_DWithin`（米）筛选、`ST_Distance`（英里）返回距离，并限制最大 250 英里/100 条。Repository 不返回经纬度或私有地址，且对状态、审核、过期、删除、地区与分类有效性做防御性过滤。调用方不得绕过该边界直接拼接地理 SQL。

`TAX-001` 的 `TaxonomyRepository` 是 Region/Category 公共读取边界。主表保留稳定 ID、父级、
slug 和中英名称；`region_aliases` / `category_aliases` 保存可重建查询词，不复制主节点。
Repository 参数化名称/slug/code/归一化别名查询，API 应用层组树并仅公开原始别名、公开区域
中心点和 active 状态。匿名 API 固定 active-only；未启用节点留给后续受权后台预览。

## 6.4 索引策略

基础索引在 Prisma Schema 与 `packages/database/prisma/sql/post_schema_constraints.sql` 中给出。扩展迁移只安装 `pg_trgm`/`postgis`；后置 SQL 必须合并到首个建表迁移之后，再根据查询计划验证：

- Listing：类型/状态/发布时间、分类、地区、owner、organization。
- 搜索 fallback：标题/正文 trigram/全文索引。
- 地理：公开模糊位置 GiST。
- Message：conversation + createdAt。
- Notification：user + status + createdAt。
- Moderation：status + priority + createdAt。
- Order/Payment：customer/organization + status + createdAt；provider event id 唯一。
- Outbox：status + availableAt + id，支持 `SKIP LOCKED` 批量领取。

不要为猜测中的查询建立大量索引。每个新索引应有目标查询、Explain 证据、写入成本和删除条件。

`EVT-001` 将该索引合同实现为部分 claim 索引和原子 CTE：单条
`UPDATE ... FROM (SELECT ... FOR UPDATE SKIP LOCKED)` 按 `availableAt,id` 领取事件、增加 attempt 并把
`availableAt` 推进到租约到期时间。Dispatcher 不持有数据库事务调用 Redis；发布确认和失败记录必须同时
匹配 `id + attempt`，因此过期 dispatcher 不能覆盖后续领取结果。PENDING、PUBLISHED、FAILED 的
`publishedAt/lastError` 组合和 attempts 上限由数据库 check 约束。

## 6.5 一致性边界

同一数据库事务内完成：

- Listing 状态变更 + 审核快照/Outbox。
- Order 创建 + 库存预留/Outbox。
- Payment webhook 去重 + Payment 状态 + 账本/履约事件。
- Moderation action + 资源状态 + AuditLog。
- Message 写入 + Conversation lastMessageAt + 通知事件。

不得把 OpenSearch、邮件、短信、S3 派生处理或第三方 API 放入数据库事务。事务提交后由 Outbox/Worker 完成。

Outbox 进入 BullMQ 后即标记 PUBLISHED，而不是等待消费者完成。`eventId` 同时作为 BullMQ `jobId` 和
消费者幂等键；Redis 或进程故障窗口允许重复投递，消费者必须用 eventId/业务版本做条件更新，不能假设
exactly-once。Redis 不可用时事件保留 PENDING 并在租约/指数退避后重试；达到上限或无效事件进入 FAILED。

`EVT-002` 增加 `admin_jobs`、`admin_job_items` 与 `queue_dead_letters`。Admin job 以
`actor + type + Idempotency-Key + request hash` 去重，短租约领取，逐项结果一次写定；进程恢复后从逐项
结果重算批次汇总，避免重复执行已完成目标。DLQ 只保存 event/aggregate 标识、队列名、固定失败码、
attempt、时间和 canonical payload hash，不复制 payload 或原始异常。Outbox 重放只把 canonical FAILED
事件恢复为 PENDING；BullMQ job 丢失时也必须从 PostgreSQL Outbox 重建并校验 type/aggregate/hash，
不能把 DLQ/Redis 提升为事实源。

## 6.6 版本与历史

当前 Schema 包含业务实体的当前快照。`TAX-002` 已增加
`category_form_schema_versions`：一个 Category 最多一个 draft、已发布记录由数据库保护为不可变，
回滚追加新版本；`listings.form_schema_version` 固定旧草稿的校验事实源，`category_fields` 只是当前
发布版本的可重建查询投影。后续仍应增加以下历史能力：

`LIST-008` 已增加 `listing_revisions`：提交、重新提交和已发布编辑保存规范化脱敏快照、字段级 diff、
actor、风险结果、稳定原因、审核关联与原发布期限；数据库触发器阻止 UPDATE/DELETE，应用只追加新
版本。后续仍应增加：

- `moderation_rule_hits`：规则版本、输入摘要和结果。
- `payment_webhook_receipts`：原始事件引用、签名校验结果、处理状态。
- 首页编排、同义词和规则的专用版本表（分类表单不再使用泛化 `config_versions`）。
- `deletion_requests`：账户删除工作流。

历史表应设置分区/保留，而不是无限增长。

## 6.7 数据迁移策略

1. Expand：先新增 nullable 列/表/索引。
2. Dual read/write（必要时）：应用兼容新旧结构。
3. Backfill：分批、幂等、有进度和失败恢复。
4. Switch：切换读取，验证指标。
5. Contract：至少一个稳定发布周期后删除旧结构。

大表 `CREATE INDEX CONCURRENTLY`、长事务和锁风险需在迁移 Runbook 中说明。Prisma migration 可结合手写 SQL，但必须保留可审查文件。首个迁移的推荐步骤是：先用 `--create-only` 生成建表 SQL，再把 `post_schema_constraints.sql` 放到相关表创建之后；不得在表存在前运行后置约束。

Gate 0 CI 同时执行两类迁移保护：

- `pnpm db:migrate:safety` 静态阻断未说明的 drop/truncate/update/delete/rename、收紧非空和新增
  required column；例外必须在 SQL 中给出原因与恢复方案，供审核追踪。
- `pnpm db:upgrade:check` 从版本化的上一兼容基线重放到当前状态，并用合成 sentinel 验证已有
  数据未丢失。空库 `prisma migrate deploy` 仍单独执行，二者不能互相替代。

## 6.8 备份与恢复

- RDS 自动备份与 PITR；生产建议至少 15 分钟恢复点目标。
- S3 开启版本控制和生命周期；私有验证材料使用独立桶/KMS key。
- OpenSearch、Redis 不作为备份事实源；定义全量重建任务。
- 每季度做恢复演练，验证不仅能恢复数据库，还能重新索引、重放任务并恢复应用密钥依赖。

### MOD-001 审核证据模型

`moderation_evaluations` 以 Listing + 提交版本唯一，并以 actor +
`Idempotency-Key` 唯一；保存规则集版本、风险层、输入哈希和最终状态/版本。
`moderation_rule_hits` 只保存稳定规则代码、规则版本、严重度和证据字段名。
两表由数据库触发器阻止 UPDATE/DELETE。中高风险 evaluation 与
`moderation_cases` 一对一；Listing 状态、evaluation、case、Audit 和 Outbox 在同一事务提交。

### ADMIN-002 人工审核证据模型

`moderation_case_snapshots` 与 Listing submission Case 一对一，保存提交时 Listing 版本、canonical
SHA-256、抓取时间和已脱敏 JSON。动态 PHONE/EMAIL/contact/address 字段与精确坐标不会进入快照；
快照和 `moderation_actions` 均由数据库触发器禁止 UPDATE/DELETE。`moderation_cases.version` 提供
强 ETag 并发控制，`moderation_actions(actor_id,idempotency_key)` 保证 actor 范围精确重试；历史动作
允许两个证据字段均为空，新工作台动作必须同时写入 key 与 request hash。

批准/要求修改/拒绝/升级在一个事务内更新 Listing 与 Case version，追加 ModerationAction、
最小 AuditLog 和 OutboxEvent。Case 快照外键使用 RESTRICT，因此动作或资源处置不能顺带删除审核
事实；事故恢复优先停用工作台并保留证据，再通过新迁移 roll forward。

### MOD-002 举报与申诉证据模型

`reports` 增加必填 actor-scoped `idempotency_key/request_hash`；部分唯一索引约束同一举报者、目标和
`OPEN|TRIAGED` 状态只有一条活动举报。当前 `target_type` 由数据库约束为 `LISTING`，原因码、补充
说明和请求摘要均有有界 check。接收事务同时创建 `listing-report` Case 和一份不可变脱敏
`moderation_case_snapshots`，但公共或 Admin DTO 都不投影 `reporter_id`。

`moderation_appeals` 与产生下架决定的 `moderation_actions` 一对一，保存 appellant-scoped 幂等证据、
20–2000 字申诉陈述及 OPEN/UPHELD/RESTORED/CLOSED 决策证据；状态、decision code 和 resolved time
由数据库 check 配对。每条申诉拥有独立 `listing-appeal` Case，`moderation_cases_source_check`
强制 submission/report/appeal 三类队列恰好绑定一个来源。举报处置或申诉决定均在 Listing/Case 行锁
内复核 actor/session/版本，并原子追加不可变 Action、最小 Audit 和 Outbox；申诉审核事务还会拒绝
原下架 Action 的 actor。

### LIST-005/LIST-007 公共生命周期持久化

五类 Listing 公开查询仍以 `listings` 为事实源，使用 `(published_at DESC, id DESC)` 复合游标，并要求
PUBLISHED + AUTO_APPROVED/APPROVED、未到期、未删除、active taxonomy 与可公开主体。新增部分索引
分别只覆盖可过期的 Rental、Job、Transfer、Secondhand 和 Service；它们是可重建索引，不是第二份数据。

Owner 归档/软删除在 Listing 行锁内复核 ACTIVE actor、个人 owner 或组织 OWNER/ADMIN/EDITOR、
状态、时间和 version。成功更新与 `AuditLog`、`OutboxEvent` 同事务；DELETE 写 `deleted_at` 而不物理
级联。过期 Worker 通过 `FOR UPDATE SKIP LOCKED` 领取到期行，状态/version predicate 保证同一
Listing 只产生一次 `listing.expired` 审计和事件。

Transfer/Secondhand/Service 明细与对应 Listing 在创建/更新事务内 upsert，并删除不属于当前类型的
其他垂直明细。数据库 check 分别约束转让核心字段、二手成色/交付数组和服务半径/可用时间；应用层
在进入 Repository 前继续执行价格单位、政策确认和有界业务规则，形成双层失败关闭。

### LIST-008 不可变修订与复审证据

`listing_revisions` 以 `(listing_id, revision_number)` 唯一，保存产生该修订的 Listing version、
`SUBMISSION|MINOR_EDIT|MAJOR_EDIT` 分类、稳定原因码、规范化脱敏快照及 SHA-256、字段级 diff 及
SHA-256、风险层/规则集、actor/session、可选 evaluation、幂等键/请求摘要和原发布/到期时间。
数据库 check 约束哈希、版本、风险/规则配对、actor/session 与期限一致性，并由触发器阻止
UPDATE/DELETE；两年保留策略见 `docs/24-data-retention.md`。

首次提交和被要求修改后的重新提交均在 submission 事务追加修订；重新提交必须与上一修订存在有效
差异，审核快照记录 `previous` 与 revision metadata，使 Admin diff 使用真实前后版本。已发布编辑在
Listing 行锁内分类：小型 title/summary/body 文字修正保持 `PUBLISHED` 与现有审核/期限；分类、地区、
价格、联系方式、精确位置、attributes、媒体、locale 或新的风险信号成为重大编辑，转回
`SUBMITTED/PENDING_REVIEW|ESCALATED` 并从公共查询立即消失。重大编辑的新 evaluation、rule hits、
case/snapshot、revision、Audit 与 Outbox 同事务提交。

人工批准重大编辑使用修订中保存的原始 publication window，而不是审批时间重新计算。窗口已过期时
结果为 `EXPIRED`；未过期时恢复原 `published_at/expires_at`。审批事务同时核对 Case、Listing、
evaluation 和 revision 的版本，旧事件或陈旧 Case 不能覆盖更新的 Listing。

### NOTIF-001 站内通知投影

`notification_templates` 以稳定 key、channel、locale、version 唯一，已发布版本由数据库触发器禁止
UPDATE/DELETE。`notifications` 保存渲染快照及 `template_id/template_version`、Listing 资源引用、
`source_event_id/aggregate_version`；同一事件对同一用户和 channel 只能产生一行。Worker 可以接收
重复或乱序事件，但按事件发生时间生成通知并通过 advisory lock/唯一键收敛。读取只返回当前用户的
IN_APP 投影，按 `(created_at DESC,id DESC)` 稳定分页；已读更新绑定 user，外部标识不会越权改变状态。

### ORG-002 成员生命周期与 Owner 不变量

`organization_invitations` 保存 actor/org 范围的幂等键与请求摘要、非 Owner 角色、到期时间和
PENDING/ACCEPTED/REVOKED/EXPIRED 单向状态证据；部分唯一索引禁止同一组织和受邀人并存两个 PENDING
邀请。接受在组织/邀请锁内写 membership、邀请状态、AuditLog 和 OutboxEvent。

`organization_memberships.version/updated_at` 为角色变更提供强 ETag 并发控制。Owner 转移凭据写入
`organization_owner_transfers`，包含 from/to、精确幂等摘要、结果角色与发生时间。两个 deferred
constraint trigger 在事务结束时检查组织至少保留一名 Owner，使先提升后降级的转移可原子提交，同时
拒绝直接删除或降级最后一名 Owner。

### LIST-009 用户中心查询投影

用户中心不新增业务表或派生事实源。Repository 从 canonical `listings`、当前组织 membership、
taxonomy 与最近不可变 revision 生成最小摘要，并复用 `(owner_id,status,created_at)` 和
`(organization_id,status,created_at)` 索引。DRAFT 映射草稿，SUBMITTED 映射审核中；仍标记为
PUBLISHED 但 `expires_at <= now()` 的行在查询时直接映射已归档，避免依赖异步过期 Worker 的时序。
ARCHIVED/EXPIRED/SUSPENDED 也归入已归档，DELETED 永不返回。

分页使用 `(created_at DESC,id DESC)`，签名 cursor 绑定 actor、bucket、type、organization、limit
和边界。计数和列表共享相同 actor/组织可见谓词；组织读取角色可以查看管理摘要，所有写操作仍由对象
级生命周期 Policy 与 Repository 版本条件独立复核。批量端点只是最多 20 次有界应用层编排，不创建
跨 Listing 大事务，也不改变既有 Audit/Outbox 与软删除幂等模型。

### MOD-003 重复候选证据

`media_assets.perceptual_hash` 保存 Worker 在解码、纠正方向和去元数据后计算的 64-bit dHash；只有
READY 或已经软删除的媒体可保留合法小写十六进制值。`listing_contact_fingerprints` 只保存按历史
表单 schema 识别并规范化的 PHONE/EMAIL 域分离 HMAC，不保存原始联系方式。Listing 每次提交或已发布
编辑时在同一事务替换自己的当前联系方式指纹，指纹只用于候选匹配。

`moderation_duplicate_candidates` 关联精确 moderation evaluation 和候选 Listing，冻结候选版本、
类型、标题、状态、阈值版本、DRY_RUN/ENFORCE 模式、置信级别、命中信号与内部数值证据。每个
evaluation/candidate 只有一行；数据库 check 约束有界分值、Hamming 距离和信号集合，触发器禁止修改
候选身份/证据或删除，并使第一次人工复核结果不可二次改写。候选与审核历史属于 PostgreSQL canonical
证据；媒体 hash 可以从 canonical 对象重新生成，但人工判定不能从派生索引恢复。

候选查询固定为同一 Listing type、过去 365 天、排除自身与 DELETED，使用 pg_trgm 标题/正文相似度、
联系方式指纹精确匹配和图片 Hamming 距离，最多返回 10 条。`(type,created_at DESC)`、指纹反向索引及
候选审核索引支持有界访问；OpenSearch 不参与审核写事务，也不是重复证据事实源。

## 6.9 SEARCH-004 词典与查询样本

`search_dictionary_states` 是 singleton 当前版本指针，`search_dictionary_versions` 保存 JSON 定义、
content hash、revision、创建/编辑/发布 actor 和追加回滚来源。每个 version 唯一、每个 dictionary
最多一个未发布草稿；发布行由 trigger 禁止更新/删除，当前指针和发布在 Serializable 事务内一起推进。
定义由 API 应用服务的共享 Zod 契约验证，Repository 只负责并发和持久化。

`search_query_samples` 保存经过应用层 bot/PII 筛查的内部 query、locale/可选 region、query hash、
独立 HMAC source hash、UTC window date 和到期时间。`(query_hash,source_hash,window_date)` 防止同源
每日重复贡献；查询按 locale/region/time、query/time 和 expiresAt 有界索引。数据库约束 hash、locale、
region、UTC date 与 90 天保留上限，公开聚合仍在 SQL 中强制 `COUNT(DISTINCT source_hash) >= 5`。

## 6.10 TAX-003 首页布局版本

`homepage_layout_states` 以 locale 与可选 region code 唯一标识一个 scope，保存当前发布版本、草稿版本
和单调递增 revision。`homepage_layout_versions` 保存规范化配置、SHA-256 内容 hash、创建者、发布时间
和可选回滚来源版本；每个 scope 同时最多一个草稿。发布版本通过 trigger 禁止 UPDATE/DELETE，回滚会
复制历史配置并追加更高版本，绝不改写历史。发布/回滚和 `homepage.layout.published` Outbox 事件在同一
事务提交，PostgreSQL 继续是唯一事实源。

## 6.11 SEARCH-005 索引操作状态

`search_index_operations` 与 `admin_jobs` 一对一保存重建/回滚类型、phase、schema version、source/
target 物理索引名、稳定 Listing UUID cursor、全量校验数量/摘要和观察窗口。它不保存搜索文档、query、
Listing 内容或 PII。actor/type/idempotency key 的唯一性由 AdminJob 提供；全局 PostgreSQL advisory lock
防止并行重建，短租约和条件 phase 更新允许 Worker 崩溃恢复。回滚 operation 通过自引用父 operation
保留完整因果链，父记录和 AuditLog 不级联删除。

OpenSearch 仍是派生状态：候选/旧索引名称只是恢复证据，业务版本和是否公开始终从 PostgreSQL Listing
计算。切换成功不会删除 source；观察窗口后的物理清理属于单独审批任务，不能由 migration cascade。
