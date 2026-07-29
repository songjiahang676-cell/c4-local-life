# 11. 内容工作流、风控与审核

## 11.1 内容状态机

```text
DRAFT
  └─ submit → SUBMITTED
                 ├─ auto approve / moderator approve → PUBLISHED
                 ├─ reject → DRAFT (with reasons) or SUSPENDED
                 └─ escalate → SUBMITTED/PENDING_REVIEW
PUBLISHED
  ├─ expire → EXPIRED
  ├─ owner archive → ARCHIVED
  ├─ violation → SUSPENDED
  └─ delete request/policy → DELETED
```

`ContentStatus` 表达用户可见生命周期，`ModerationStatus` 表达审核决策；两者不可混为一个字段。状态变更只通过明确 use case，记录 actor、原因、版本和审计。

`LIST-001` 的可执行状态机覆盖 `SUBMIT`、自动/人工批准、升级、退回草稿、暂停、到期、owner
归档和软删除。自动批准只接受尚未升级的 `PENDING_REVIEW`；升级后的提交只能由 moderator 批准或
退回。发布会同时写入 UTC `publishedAt` 和基于显式 1–365 天策略计算的 `expiresAt`，到期前调用
`EXPIRE` 必须失败。删除以 `DELETED + deletedAt` 表达且不可重复执行；过期、归档和暂停保留原发布
证据。每次转换先验证重建快照的不变式和 `expectedVersion`，再返回包含 actor、原因码、前后双状态
与前后版本的事件；持久化和 Outbox 原子提交由后续 Listing application/repository 切片完成。

## 11.2 风险分层

### 低风险

完整资料、历史良好、无外链/异常联系方式、价格合理、图片原创度高。可自动批准并抽检。

### 中风险

新账号、敏感分类、文本触发、联系方式频繁变化、疑似重复。进入常规人工队列。

### 高风险

已知诈骗模式、绕过平台付款、违法商品、身份/执照伪造、批量账号、恶意链接、被多次可信举报。可先隐藏/阻断并进入高优先级队列。

风险分只用于辅助，不直接向用户公开；模型/规则版本、输入摘要和结果需可审计，人工可覆盖并写原因。

## 11.3 自动规则

- 字段完整性、长度、格式和禁止类别。
- URL/域名信誉、手机号/邮箱复用、联系方式变体。
- 标题/正文相似度、图片 perceptual hash、重复地点/价格。
- 发布频率、设备/IP/会话异常、账号年龄和历史处置。
- 不合理价格、外部押金/礼品卡/加密货币引导。
- 就业和住房歧视关键词与政策提示。
- 执照类服务声明与验证状态不一致。
- 图片恶意文件、二维码/文本风险、EXIF。

规则按类别、城市、语言配置，版本化并支持 dry-run。新规则先观察命中与误杀，再启用阻断。

## 11.4 审核工作台

队列卡片至少显示：资源快照、差异、发布者历史、组织/设备关联摘要、规则命中、重复候选、举报、媒体扫描、地域/分类政策和 SLA。审核员可：

- 批准、拒绝、要求修改、下架、降权、升级；
- 限制发布/消息/联系方式曝光；
- 暂停用户/组织；
- 添加标准原因码和内部备注；
- 创建后续任务或申诉入口。

不允许审核员直接编辑用户正文后悄悄发布；若平台做规范化编辑，应保留 diff 并通知用户。

## 11.5 举报

举报对象支持 Listing、Message、Review、Business/Profile、User。原因码按对象定义，用户可补充说明但不能看到内部处理细节。

防滥用：登录、速率、去重、恶意举报信誉；但不得因举报者新用户而完全忽略高危证据。多条举报不是自动定罪，需要可信度、独立性和内容证据。

## 11.6 申诉

- 明确哪些动作可申诉和截止时间。
- 申诉由不同审核员或高级审核员处理。
- 展示足够原因让用户修正，同时不公开检测阈值或举报者。
- 结果：维持、修改、恢复、部分恢复；记录依据。
- 误杀率、恢复率和处理时长纳入审核质量指标。

## 11.7 消息治理

- 新账号消息速率、并发会话和外链受限。
- 使用安全提示识别押金、验证码、礼品卡等模式。
- 举报后可保存必要消息快照；普通客服默认无权随意浏览消息正文。
- 用户屏蔽、静音、退出会话；严重风险可冻结发送。
- 端到端加密不是首期承诺，隐私政策必须如实说明平台处理方式。

## 11.8 内容政策接口

代码中使用稳定 `policyReasonCode`，文案按 locale 映射。政策版本与用户提交时间关联。分类配置可声明：

- required verification level；
- prohibited/conditional fields；
- default expiry；
- required media；
- moderation tier；
- legal notice；
- contact exposure policy。

## 11.9 SLA 与抽检

规划目标：高危队列 15 分钟内首响、普通提交工作时段 4 小时内、举报 24 小时内、申诉 3 个工作日内。实际 SLA 应按人员和法律义务确认。自动批准内容按风险分层抽检；审核员一致性通过双盲样本和复核率衡量。

## 11.10 审计与隐私

审计日志包含 who/what/when/target/reason/requestId/before-after hash，不保存超过必要范围的敏感原文。验证材料和举报证据独立授权、加密、定期清理。任何导出有水印/审计/时限和最小字段。

## 11.11 MOD-001 已实现的提交风险基线

`POST /listings/{listingId}/submit` 要求 ACTIVE actor、当前 owner 或组织
OWNER/ADMIN/EDITOR、强 `If-Match` 与 actor-scoped `Idempotency-Key`。风险规则集当前为
`listing-submission` v2；当前规则覆盖新账户、分类强制人工审核、缺失发布期限、外部联系方式、
平台外付款诱导，以及 Job 中保守匹配的疑似歧视性招聘措辞。低风险按提交时绑定的历史表单发布
策略自动发布；中风险创建普通审核案件；
高风险进入优先队列并标记 `ESCALATED`。

一次事务同时写 Listing 状态/版本、不可变 `ModerationEvaluation`、仅含规则代码/版本/证据字段名
的 `ModerationRuleHit`、可选 `ModerationCase`、最小 Audit 和逐状态 Outbox。命中原文、阈值、
手机号、邮箱和风险输入不进入公开响应或日志；输入仅保存 canonical SHA-256。后续调整规则必须
增加规则集/规则版本，不能改写历史证据。

Job 规则只保存 `EMPLOYMENT_POLICY_RISK`、规则版本、严重度和 title/summary/body 字段名，不保存
命中词或正文片段，也不自动拒绝/处罚；它仅将内容送人工复核。薪资完整性在草稿写入时先由
versioned schema 与 Job 应用规则校验，再由 `job_details_wage_range_coherent` 防止旁路写入不一致
范围。

## 11.12 ADMIN-002 已实现的人工审核闭环

- 队列按 priority 降序、createdAt/UUID 升序稳定分页；高风险 15 分钟、普通提交 4 小时的计划 SLA
  在响应和双语界面明确展示。cursor 与 actor/筛选 HMAC 绑定，limit 最大 50。
- 每个案件读取提交事务生成的不可变脱敏快照。当前仅存在首次提交历史，因此 diff 明确把字段标记为
  ADDED；后续 `listing_revisions` 上线后可在不改变当前契约的情况下增加 previous published diff。
- 详情同时展示非 LOW 规则代码/版本/严重度/字段名、媒体扫描结果和发布者状态聚合；不展示规则阈值、
  命中原文、联系方式、精确坐标、原始对象 key 或请求 hash。
- 审核员可批准、要求修改、拒绝或升级，动作与稳定原因码绑定。读取要求 MFA + 当前
  MODERATOR/SENIOR_MODERATOR；写入再要求十分钟内 step-up、强 ETag 和 actor-scoped 幂等键。
- Listing、Case、不可变 Action、Audit 与 Outbox 原子提交。批准发布、要求修改返回草稿、拒绝暂停、
  升级保持提交并提高优先级；Controller 不直接访问 Prisma。
- 工作台支持中文/英文、移动布局、可见 focus，以及 J/K/方向键切换、R 刷新和 Alt+A 聚焦动作。

## 11.13 LIST-005 公开、归档、删除与过期

- 低风险自动批准或人工批准后，公开详情/列表只读取当前有效安全投影；过期、归档、删除、未批准、
  taxonomy/主体停用的内容立即从 PostgreSQL 公开读消失。
- Rental 列表按发布时间与 UUID 稳定分页；签名 cursor 同时绑定 type、category 和 region，篡改或
  跨筛选复用返回通用 400。
- Owner/组织 Writer 使用强 ETag 将 PUBLISHED 归档；同一目标状态重试返回当前版本且不重复写。
  DELETE 是软删除并对同一 owner 重试保持 204。
- Worker 有界轮询到期 Rental，使用 `FOR UPDATE SKIP LOCKED` 支持多实例；状态、版本、系统 Audit
  和 `listing.expired` Outbox 原子提交。搜索侧移除由后续消费者按 eventId/aggregateVersion 幂等完成。
