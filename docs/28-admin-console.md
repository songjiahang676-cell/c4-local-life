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
