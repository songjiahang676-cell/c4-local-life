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
| Admin/Audit   | 后台授权、配置、审计                   | audit_logs, config versions                   |

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

## 6.5 一致性边界

同一数据库事务内完成：

- Listing 状态变更 + 审核快照/Outbox。
- Order 创建 + 库存预留/Outbox。
- Payment webhook 去重 + Payment 状态 + 账本/履约事件。
- Moderation action + 资源状态 + AuditLog。
- Message 写入 + Conversation lastMessageAt + 通知事件。

不得把 OpenSearch、邮件、短信、S3 派生处理或第三方 API 放入数据库事务。事务提交后由 Outbox/Worker 完成。

## 6.6 版本与历史

当前 Schema 包含业务实体的当前快照。实施阶段应增加以下历史能力：

- `listing_revisions`：提交/发布/重大编辑时保存规范化快照、diff、actor、风险结果。
- `moderation_rule_hits`：规则版本、输入摘要和结果。
- `payment_webhook_receipts`：原始事件引用、签名校验结果、处理状态。
- `config_versions`：分类、首页编排、同义词和规则配置版本。
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
