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

`MOD-002` 首个可验收切片只开放 Listing 举报；其他对象在相应 Gate 的主数据与对象授权完成后扩展，
不能把尚未实现的对象伪装成可用接口。

## 11.6 申诉

- 明确哪些动作可申诉和截止时间。
- 申诉由不同审核员或高级审核员处理。
- 展示足够原因让用户修正，同时不公开检测阈值或举报者。
- 结果：维持、修改、恢复、部分恢复；记录依据。
- 误杀率、恢复率和处理时长纳入审核质量指标。

当前可申诉动作是由举报案件产生的 Listing 下架；Owner 在动作发生后 30 天内可提交一次申诉。

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
`listing-submission` v3；当前规则覆盖新账户、分类强制人工审核、缺失发布期限、外部联系方式、
平台外付款诱导、Job 中保守匹配的疑似歧视性招聘措辞，以及 Secondhand 中高置信疑似禁售品。
低风险按提交时绑定的历史表单发布
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

Secondhand 规则只保存 `PROHIBITED_GOODS_RISK` 和字段级证据，并将高风险内容升级到优先人工队列；
不保存疑似禁售品原文，也不自动处罚。Transfer 分类策略始终人工审核。三类新增垂直的政策确认均为
OWNER_ONLY，并在动态 schema、应用明细规则和数据库类型耦合约束中失败关闭。

## 11.12 ADMIN-002 已实现的人工审核闭环

- 队列按 priority 降序、createdAt/UUID 升序稳定分页；高风险 15 分钟、普通提交 4 小时的计划 SLA
  在响应和双语界面明确展示。cursor 与 actor/筛选 HMAC 绑定，limit 最大 50。
- 每个案件读取提交事务生成的不可变脱敏快照。`LIST-008` 将当前与上一不可变 revision 一并绑定，
  初次提交显示 ADDED，重新提交与重大编辑显示真实字段级前后 diff，不从可变 Listing 当前行反推历史。
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
- 五类 Listing 列表按发布时间与 UUID 稳定分页；签名 cursor 同时绑定 type、category 和 region，篡改或
  跨筛选复用返回通用 400。
- Owner/组织 Writer 使用强 ETag 将 PUBLISHED 归档；同一目标状态重试返回当前版本且不重复写。
  DELETE 是软删除并对同一 owner 重试保持 204。
- Worker 有界轮询到期五类 Listing，使用 `FOR UPDATE SKIP LOCKED` 支持多实例；状态、版本、系统 Audit
  和 `listing.expired` Outbox 原子提交。搜索侧移除由后续消费者按 eventId/aggregateVersion 幂等完成。

## 11.14 MOD-002 举报、处置与申诉闭环

- `POST /reports` 要求 ACTIVE 登录会话、同源写入和 actor-scoped `Idempotency-Key`；当前只接受
  `LISTING`，稳定原因码为诈骗/禁限内容/误导/骚扰仇恨/隐私联系方式滥用/其他。补充说明为可选
  10–2000 字，控制字符和双向文本控制符失败关闭。
- 单一举报者对同一 Listing 只能保留一个 `OPEN|TRIAGED` 举报；并发请求由数据库 advisory lock 和
  部分唯一索引共同去重。精确幂等重试返回同一 opaque receipt，键复用不同请求返回 409。每个账号
  每小时最多新建 10 条举报，超过返回 429；同一举报重试和已存在目标去重不会消耗新的配额。
- 接收事务保存最小 Report、不可变脱敏 Listing 快照、`listing-report` 案件和 Audit。快照过滤
  email/phone/contact/address、精确坐标和未知私有 attributes；公共响应、审核队列、日志和通知均不
  暴露举报者身份。数据库生产存储按基础设施合同加密，审核读取只对当前 MFA
  `MODERATOR|SENIOR_MODERATOR` 开放。
- 举报队列按 priority 降序、createdAt/UUID 升序稳定分页，cursor 与 actor、队列和状态 HMAC 绑定；
  详情和动作响应使用强 ETag。处置要求十分钟内 MFA step-up、actor-scoped 幂等键、稳定动作/原因
  组合和当前 Case 版本。驳回、下架、升级与 Case、不可变 Action、Audit、Outbox 原子提交。
- 下架把 Listing 转为 `SUSPENDED/REJECTED`，保留原发布/到期证据并发送双语
  `listing.status.removed` 站内通知。Owner 可在 30 天内调用 `POST /appeals`；每个下架动作只能有
  一条申诉，精确重试不重复写，并创建独立 `listing-appeal` 案件。
- 原下架审核员不能处理该申诉；数据库事务在最终动作前再次检查。不同审核员可维持原决定或恢复
  尚未到期的 Listing；恢复保留原发布时间/到期时间并递增版本。结果通过
  `listing.appeal.upheld|restored` Outbox 投影为双语通知，且案件、申诉、Listing、Action 和 Audit
  同事务提交。
- SLA 响应字段以举报 24 小时、申诉 3 个 UTC 工作日计算；节假日日历、人员班次、恶意举报信誉和
  审核质量仪表盘分别由运营配置与 `MOD-004` 完成，当前不会自动定罪或因新账号自动忽略证据。

## 11.15 LIST-008 修订、diff 与重大编辑复审

- 首次提交、要求修改后的重新提交及所有已发布编辑都会追加不可变 `listing_revisions`；快照使用公开/
  审核安全字段，diff 对私有 attributes 只记录变化的 key，不复制联系方式、地址或敏感值。
- Owner 通过 `GET /listings/{listingId}/revisions` 查看按 revision/UUID 稳定分页的历史、分类、
  原因、风险、审核状态和脱敏 diff；cursor 与 actor、Listing 和 limit 绑定，跨账号/篡改失败关闭。
- 已发布 `PATCH` 继续要求强 ETag，并额外要求 actor-scoped `Idempotency-Key`。有界的小型文字修正为
  `MINOR_EDIT`，保留 `PUBLISHED`、审核状态和原到期时间；分类、区域、价格、联系方式、位置、媒体、
  attributes、locale 或风险信号变化为 `MAJOR_EDIT`。
- 重大编辑即时转回 `SUBMITTED/PENDING_REVIEW`，高风险进入 `ESCALATED`；低风险重大变化也提升到
  至少中风险人工复核。新 revision、evaluation/hits、case/snapshot、Audit 和 Outbox 原子提交。
- 重大编辑获批只能恢复 revision 保存的原发布时间与到期时间；到期则转为 `EXPIRED`，不能借编辑免费
  续期。Case ETag、Listing version、revision/evaluation 关联和事务行锁共同阻止旧审核覆盖新内容。

## 11.16 LIST-009 用户中心状态与批量动作

- 管理 bucket 是用户界面投影，不是新的领域状态：DRAFT、SUBMITTED、PUBLISHED 与
  ARCHIVED/EXPIRED/SUSPENDED 分别映射草稿、审核中、已发布、已归档。
- 查询时间已过期的 PUBLISHED 直接显示为已归档；异步 Worker 之后仍以 canonical version predicate
  转为 EXPIRED，管理投影不修改数据库，也不产生重复事件。
- 批量 ARCHIVE/DELETE 按输入顺序逐项调用既有生命周期 use case；每项重新执行对象授权、强版本与
  状态检查。成功项独立提交，未知/无权、陈旧版本和非法状态返回有界结果，不扩大事务或权限范围。
- DELETE 的目标状态重试保持幂等且不重复 Audit/Outbox；ARCHIVE 对已归档精确重试收敛。SUSPENDED
  内容不向界面提供删除动作，申诉仍通过既有独立流程处理。
