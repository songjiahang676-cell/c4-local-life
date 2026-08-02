# 28. 管理后台架构

## 28.1 目标

后台是平台安全和运营能力的一部分，不是简单 CRUD。它需要把最小权限、证据、批量安全、作业进度、审计和恢复设计到每个动作。

## 28.2 工作区

### Moderation

- Listing 提交队列、举报、申诉、规则命中、重复候选。
- 快照/diff、发布者历史、关联风险、媒体扫描。
- 标准动作/原因、内部备注、升级、SLA 和抽检。

### Users & Organizations

- 账户状态、验证结论、组织成员、风险事件、会话撤销。
- 敏感 PII 按需 reveal，记录理由和审计；默认遮罩。
- 封禁/限制可设范围、期限、原因和申诉。

### Taxonomy & Homepage

- 城市、分类、翻译、表单 schema、SEO、默认有效期。
- 首页模块 draft/preview/publish/rollback。
- 配置 diff、schema 校验、影响预览。

### Commerce & Ads

- 订单、付款、退款、dispute、账本 reconciliation。
- SKU/价格版本、广告库存、活动、素材、排期、履约。
- Finance 与 Ad Ops 权限分开；账本调整双人复核。

### Support

- 工单、用户可见事件、通知重发、登录/会话协助。
- 默认不能浏览消息正文、验证原件和完整财务信息。
- 临时提升访问需工单、理由、到期。

### System

- 队列、DLQ、Outbox、索引版本、rebuild、通知 provider、Feature Flag。
- 操作以受控 command/job 执行，禁止任意 SQL shell。

## 28.3 后台安全

- 独立 Admin app/domain、严格 CSP、MFA/SSO、短会话。
- RBAC + scope（城市、类别、队列）+ step-up。
- 高风险动作确认目标数量和影响；批量操作先 dry-run。
- 导出异步生成、最小字段、加密/短效链接、水印和审计。
- 禁止在列表一次加载大量 PII；敏感字段按需读取。
- 生产 impersonation 默认禁止；如必须，使用只读/明确 banner/审计和用户通知政策。

## 28.4 审计

每个写动作记录：actor、role、auth strength、target、action、reason code、ticket、before/after hash或安全 diff、requestId、IP/设备摘要、时间、审批人。审计不能由普通 Admin 修改/删除。

## 28.5 批量作业

后台请求创建 `AdminJob`：query snapshot、estimated count、requested action、dry-run result、approval、status、progress、error sample、rollback/compensation reference。Worker 分批执行，逐项幂等；用户可暂停/取消尚未处理部分。

## 28.6 UX 要求

- 队列优先按风险/SLA，不只按创建时间。
- 处置按钮与原因/政策绑定，防止随意备注。
- 明确展示数据新鲜度和索引/缓存延迟。
- 表格支持保存视图，但筛选参数有边界。
- 破坏性动作不依赖普通 confirm 文案；需要重认证/二人批准时明确流程。
- 无障碍同样适用后台，尤其键盘审核效率。

## 28.7 Admin API

使用 `/v1/admin/*`，与普通 endpoint 共用领域 use case 或专用 command，不能直接绕过业务不变式。批量查询/导出限制日期、记录数和字段。所有 Admin response 设置 `Cache-Control: no-store`。

## 28.8 ADMIN-001 实施基线

- `apps/admin` 是独立 Next.js app/domain；`/` 跳转 `/admin`，已知工作区路径只渲染同一个安全壳层，
  未知路径 404。页面声明 noindex/nofollow，所有 Admin 页面设置 no-store、nonce-based script CSP、
  frame denial、no-referrer 和最小 Permissions-Policy。
- Admin browser 只访问同源 `/v1` BFF。BFF allowlist 仅包含 `auth/session`、
  `auth/otp/request`、`auth/otp/verify` 与 `admin/session`，过滤请求/响应 headers、禁止开放代理并把
  上游失败清理为通用 503。
- `GET /v1/admin/session` 由普通会话认证、`admin:console:access` Policy 与 PostgreSQL 当前有效
  `PlatformRoleAssignment` 共同决定。平台角色与组织角色不混用；过期/撤销授权在下一请求即失效。
- 导航完全来自 API 的角色映射，前端不推断权限。响应不包含 email、phone、token、scope、trust score
  或操作数据；guest 401、普通/受限用户 403，成功/失败全部 no-store。
- 本切片的登录表单复用 EMAIL OTP，但 OTP 不是 Admin MFA。API 明确返回
  `mfaRequired=true`、`privilegedActionsAllowed=false`，因此工作区仅显示安全占位/空态。AUTH-005
  完成 MFA、step-up 与近期认证前，禁止接入任何特权数据、写动作、PII reveal 或导出。

## 28.9 AUTH-005 MFA / step-up 实施基线

- Admin BFF allowlist 增加三个固定 MFA 路径，但仍不允许任意 `/admin/*` 代理。所有写请求受
  Cookie、same-origin、严格 DTO、no-store 和通用 Problem Details 保护。
- 未设置账号显示双语 TOTP 设置页；pending 设置十分钟有效且重试稳定返回同一 secret。验证成功后
  恢复码显示一次，用户明确确认保存后才进入工作区。已设置账号必须先完成 TOTP/恢复码验证，前端在
  `PRIMARY` 状态完全不渲染角色导航。
- TOTP secret 使用 AES-256-GCM 加密；恢复码只存域分离哈希；TOTP 时间步与恢复码均一次消费。
  五次失败锁定五分钟，不能通过重启进程绕过。
- MFA 验证原子轮换 Session；旧 token 失效。MFA Admin Session 默认绝对 8 小时、闲置 30 分钟，
  敏感动作的近期认证窗口为 10 分钟。后台页可重新 step-up，但领域 controller 仍必须声明
  `admin:console:privileged` 或 `admin:sensitive:access`。
- enrollment、TOTP 验证和恢复码消费写最小审计事件。审计与 HTTP 日志不得包含 secret、明文
  recovery code、token、联系方式或 IP 原文。当前不提供自助禁用/重置以避免降级绕过。

## 28.10 ADMIN-002 Listing 审核工作台

- `/admin/moderation/listings` 只有 API 返回 moderation navigation 时才挂载真实工作台。Admin BFF
  只增加 queue GET、UUID detail GET 和 UUID action POST；路径穿越、方法混淆及其他 Admin 资源 404。
- 队列固定使用 PostgreSQL canonical Case，按 priority、createdAt、UUID 排序；高风险 15 分钟、
  中风险 4 小时的计划 SLA 与数据时间可见。列表 limit 最大 50，cursor 对 actor 和全部筛选签名。
- 详情来自提交时不可变快照；动态联系方式/地址和精确坐标已移除。界面展示首提 ADDED diff、
  非 LOW 规则证据、媒体状态和发布者聚合，不加载 email/phone、原图 key、内部 hash 或假指标。
- 读取要求当前 MODERATOR/SENIOR_MODERATOR + MFA；动作另要求 recent MFA。批准、要求修改、拒绝、
  升级与稳定原因码绑定，并携带强 `If-Match` 和 actor-scoped `Idempotency-Key`。
- 写事务同时更新 Listing/Case version，追加 immutable ModerationAction、最小 Audit 和 Outbox。
  客户端 409 后重新加载当前案件，不静默覆盖另一审核员的决定。
- 中文/英文与移动布局共用语义结构；队列可用 J/K/方向键切换，R 刷新，Alt+A 聚焦动作，状态/错误
  使用 live region，focus 保持可见。

## 28.11 MOD-003 重复候选工作台增量

Listing 案件详情增加最多 10 条候选摘要，按稳定列表展示候选类型、标题、状态、阈值版本、
DRY_RUN/ENFORCE、MEDIUM/HIGH 和 TEXT/IMAGE/CONTACT 信号。UI 不计算阈值、不拉取候选 owner/联系方式/
图片、不显示内部相似分值或对象 key。仅当案件已有候选时，审核员可使用稳定
`DUPLICATE_CONTENT` 原因要求修改或拒绝；没有候选时界面隐藏该选项，服务端仍独立拒绝伪造原因。
批准继续使用 `CONTENT_POLICY_COMPLIANT`。所有读取、键盘/焦点、中英移动布局、MFA/recent-auth、
ETag、幂等、no-store 与通用错误边界沿用 ADMIN-002，不新增前端权限推断。

## 28.12 EVT-002 队列恢复工作台

System 工作区显示 Outbox/Queue 最小失败证据，可按固定来源、事件类型和失败码筛选并稳定翻页；不显示
payload、内容、用户、原始错误、request hash 或内部审计字段。READ_ONLY_AUDITOR 只能查看，只有当前
PLATFORM_ADMIN + recent-MFA 可提交重放/对账。

重放要求选择明确目标、填写稳定 reasonCode 并显式确认已核对原因与代码版本；对账默认 dry-run，repair
另有确认。所有写入经同源精确 BFF、后端 Policy、strict DTO 与新 `Idempotency-Key` 创建异步 Admin job，
页面只轮询聚合进度；失败不会在浏览器展开原始 provider/handler detail。中英文共用语义表格、可见
label/focus、移动横向容器和明确 loading/error/empty 状态，前端禁用不替代后端授权。

## 28.13 SEARCH-005 索引恢复控制面

Admin API 提供精确的重建创建、operation 读取和父 operation 回滚路径。PLATFORM_ADMIN + recent-MFA
提交新的 Idempotency-Key、reasonCode、可选 ticketRef/回滚窗口；READ_ONLY_AUDITOR 仅能读取 phase、
source/target、数量、窗口和固定失败码。响应不返回 cursor、摘要、Listing 内容、actor 或 provider 错误。

当前可通过受控 API/运行手册操作；后续若增加可视化面板，必须只调用同一 BFF/API、保留显式确认和
双语/键盘/移动状态，不新增直连 OpenSearch/Prisma 的快捷路径，也不能以 UI 禁用替代 Policy。
