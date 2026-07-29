# 22. 验收标准与 Definition of Done

## 22.1 全局 Definition of Done

每个可交付功能必须：

- 对应 Backlog ID、产品说明和验收场景。
- 前后端、Admin（如需要）、数据、权限、状态、错误和空态完整。
- 更新 OpenAPI/Schema/Prisma/迁移/种子/文档。
- 具有领域、集成、授权和关键 E2E 测试。
- 中文/英文、移动端和键盘操作可用。
- 日志、指标、追踪、业务事件和告警（需要时）存在。
- 不记录/泄露 PII，不引入未评估依赖或密钥。
- 在 staging 通过 smoke，具备发布/回滚和 Feature Flag 策略。
- 未执行测试明确记录，不把“未测试”描述为通过。

## 22.2 Gate 0 验收

- 干净机器按 README 在可用网络下完成 `pnpm install --frozen-lockfile`。
- `check-architecture`、format、lint、typecheck、db validate、test、build 全部通过。
- Web/Admin/API/Worker 容器可构建；健康检查工作。
- staging 基础部署可重复；配置/secret 无硬编码。
- CI 阻止 secret、破坏契约和失败测试进入主分支。

## 22.3 身份验收

- OTP 请求和验证具有账号/IP/设备限频，不泄露账号存在。
- 会话 cookie 安全，登录后旋转，可查看和撤销设备。
- suspended/deleted 用户不能继续使用旧会话。
- 组织 Owner/Admin/Editor/Billing/Analyst 权限矩阵通过负面测试。
- 管理后台强制 MFA；普通用户无法访问任何 Admin API。
- 账户删除请求存在冷静期、阻塞条件和审计。

`ADMIN-001` 前置验收：独立 Admin app 具有 noindex/no-store、严格 script CSP、中文/英文、移动/键盘
状态；guest 可看到登录边界，普通或 LIMITED 账户的 `GET /admin/session` 返回通用 403，只有 ACTIVE
且具有当前有效平台角色的 Session 获得服务端计算导航。其安全投影必须保持
`privilegedActionsAllowed=false`，直到 `AUTH-005` 真实完成 MFA/step-up；因此本切片不能被当作上面
“后台强制 MFA”最终验收已经完成。

`AUTH-005` 最终验收：有效平台角色只能先进入 MFA setup/verify 边界；未设置账号必须用 TOTP 激活，
恢复码只显示一次且服务端仅存哈希。普通 OTP Session 不得通过 `admin:console:privileged`；成功 MFA
必须轮换 Cookie/数据库 Session，旧 token、同一 TOTP 时间步和已用恢复码均失败。连续失败触发带
`Retry-After` 的锁定，跨站 Cookie 写被拒绝。MFA Session 使用更短绝对/闲置期限；近期认证窗口过期后
`admin:sensitive:access` 失败，重新验证后恢复。所有 MFA 结果 no-store、写审计且不含 secret/code。
TOTP 算法必须通过 RFC 向量、真实 PostgreSQL 事务/约束和中文/英文移动/键盘界面测试。

`AUTH-004` 可选密码验收：verifier 必须使用版本化强 KDF、随机 salt 与独立 pepper，常见密码、短密码、
控制字符和异常长度失败；登录对未知账号/错误密码/未设置密码返回通用 401，identifier、IP、device
限流与持久失败锁定不可并发绕过。恢复请求不泄露账号存在性，token 只经 side channel 交付且数据库只存
hash；冷却前、过期、错误、已消费、已取代和重放证明均失败。成功恢复必须原子替换密码、撤销全部
Session、写最小审计、发送变更通知且不自动登录。空库 12 个 migration、上一发布基线升级、数据库
约束负例、真实 Repository 事务、HTTP 契约与 abuse 测试必须通过。

`EVT-001` 可靠事件验收：两个 dispatcher 并发领取同一批 PENDING 事件不得重复 claim；领取事务不得
跨越 Redis 调用；租约过期可安全重领，旧 attempt 的确认必须失败。BullMQ jobId 固定为 eventId，
入队后确认前崩溃允许安全重复；失败使用指数退避+jitter，达到上限或永久无效 envelope 进入 FAILED。
数据库约束保护状态/attempt/eventType，日志与指标不含 payload/PII；oldest pending age 和有界结果指标
可抓取。空库 13 个 migration、上一发布基线升级、约束负例、真实 PostgreSQL 并发 Repository 和 Worker
publisher/故障测试必须通过。

## 22.4 Listing 验收

对五种类型逐项：

- 草稿可创建、自动保存、恢复、编辑和删除。
- 动态字段客户端/服务端一致验证，未知字段按契约处理。
- 媒体只有 READY 可发布；原始文件不公开。
- 提交产生审核记录和 Outbox；非法状态转换失败。
- 审核批准后公开详情可见并最终进入搜索。
- 下架/过期在目标时间内从列表/搜索移除。
- Owner/组织成员权限正确；他人不能读取草稿或审核原因。
- 并发编辑返回 409 而非静默覆盖。
- 详情不泄露精确地址/联系方式/风险字段。

`LIST-003` 已验收其中的草稿创建、owner/组织读取与编辑、动态字段服务端校验、强 ETag/409、最小
Audit/Outbox 和安全详情投影。`LIST-004` 已验收 Rental 中英/移动动态表单、900ms 防抖自动保存、
账号与 locale 隔离的离线恢复、字段错误定位、上传进度/扫描/重试，以及事务化 READY 媒体绑定；
Rental 的提交、审核、发布、删除和过期已由后续 `MOD-001`、`ADMIN-002`、`LIST-005` 完成；
`LIST-006` 已复用同一闭环完成 Job 的岗位/薪资/就业政策、双语移动发布提交、公开读取和过期；
`LIST-007` 已继续完成 Transfer/Secondhand/Service 的 schema、明细持久化、政策确认、双语移动提交、
安全公开读取和过期。`LIST-008` 已验收不可变 revision、真实前后 diff、owner 原因和重大编辑复审；
账户管理和搜索派生状态仍由后续任务完成，因此整个 22.4 尚不能标记完成。

`MOD-001` 已验收提交风险切片：提交使用强 ETag 与 actor-scoped 幂等键；规则集和命中均有
版本；低风险按历史发布期限自动发布，中风险创建普通案件，高风险升级并创建高优先案件；
Listing/evaluation/hits/case/Audit/Outbox 原子提交且重复请求不重复写。公开响应不包含命中原文、
规则阈值或内部输入。Rental 公开列表/详情、人工审核动作、删除和过期已分别由
`LIST-005`/`ADMIN-002` 验收；Job 已由 `LIST-006` 复用，`LIST-007` 又覆盖其余三类。v3 风险规则
继续把就业政策疑点送人工审核，并把 Secondhand 高置信疑似禁售品送高优先人工审核；搜索派生状态
仍待 Gate 3。

`ADMIN-002` 已验收人工审核切片：队列具备风险/SLA、稳定签名 cursor 和有界筛选；详情来自不可变、
脱敏的提交快照并展示首提 diff、规则/媒体/发布者聚合；MFA + 当前 moderator 保护读取，recent MFA +
Case ETag + 幂等键保护批准/要求修改/拒绝/升级。动作与 Listing/Case/Audit/Outbox 同事务且证据不可
覆盖。Rental 公开列表/详情、Owner 归档/软删除和 Worker 过期已由 `LIST-005` 完成；Listing
举报、下架、独立审核员申诉和恢复已由 `MOD-002` 完成；重新提交和重大编辑的历史 revision diff
已由 `LIST-008` 完成。搜索索引消费仍由后续 Gate 3 切片负责，因此整个 Listing 生命周期尚未完成。

`MOD-002` 已验收 Listing 举报/申诉切片：ACTIVE actor、同源、幂等键、每账号小时配额和活动目标
唯一约束保护接收；并发同目标举报只写一条 Report/脱敏快照/案件/Audit。公共 receipt 和 MFA
审核详情均不含举报者身份。举报处置使用 recent MFA、稳定原因、强 ETag 与 actor-scoped 幂等键，
并把下架状态、Case、不可变 Action、Audit 和 Outbox 原子提交。Owner 在 30 天内只能针对下架动作
申诉一次；独立审核员可维持或恢复尚未到期内容，原审核员被应用层与事务内检查拒绝；三种结果均由
版本化双语站内模板通知。当前对象范围刻意限于 Listing，Message/Review/Profile/User 举报随对应
主数据 Gate 扩展。

`LIST-005` 已验收 Rental 公开生命周期：公开列表只返回批准、未过期、未删除且 taxonomy/主体有效的
安全摘要；按 `publishedAt + id` 稳定分页，HMAC cursor 绑定 type/category/region 并拒绝篡改或跨筛选
复用。公开详情继续省略精确坐标、联系方式和内部字段。Owner/组织 Writer 使用强 ETag 归档或软删除；
归档与 DELETE 重试不重复写，状态、版本、最小 Audit 和 Outbox 在同一事务提交。Worker 通过有界批次和
`FOR UPDATE SKIP LOCKED` 将到期 Rental 转为 `EXPIRED`，重复/并发轮询只产生一组系统审计和事件；公开
读立即移除，搜索侧最终移除仍由后续索引消费者处理。

`LIST-006` 已验收 Job 完整垂直切片：版本化动态表单覆盖雇主、岗位类型、经验、办公方式、排班、
语言、福利、签证支持声明、薪资范围与 OWNER_ONLY 就业政策确认；`job_details` 与 Listing 在同一
事务 create/upsert，应用/数据库双层拒绝非正数、倒置或不支持周期的薪资。公共集合、签名 cursor、
详情、归档/删除和 Worker 过期复用现有状态链并接受 `type=JOB`，公开 schema 投影剔除政策确认。
中英 noindex Job 发布页复用 900ms 自动保存、账号/locale/vertical 隔离恢复、READY 图片和 ETag，
并通过精确 BFF allowlist 以幂等键提交审核；桌面/移动 E2E 覆盖填写、保存、提交和无横向溢出。

`LIST-007` 已验收其余三个垂直切片：Transfer 要求 FIXED 正数要价、租金/剩余租期/转让原因、
OWNER_ONLY 财务免责声明并始终人工审核；Secondhand 要求成色、非空交付方式、合法来源/禁售品确认，
只接受 FIXED/NEGOTIABLE/FREE；Service 要求 1–100 英里服务半径、非空可用时间和资质声明，
只接受 HOURLY/FIXED/NEGOTIABLE，执照号仅 owner/审核可见。三个 detail 与 Listing 在同一事务
upsert 且类型严格耦合，数据库约束阻止应用旁路。五类公共 list/detail、签名 cursor、归档/软删除和
到期处理统一；v3 禁售品规则只保留字段级证据。三个中英文 noindex 发布页复用账号/locale/vertical
隔离恢复、READY 图片、强 ETag 和幂等提交，桌面/移动 E2E 覆盖三类填写、保存与提交。

`LIST-008` 已验收修订与重大编辑：首次/重新提交和已发布编辑都追加数据库不可变、哈希绑定的规范化
脱敏 snapshot/diff；Owner 私有 collection 使用 actor/Listing 绑定的签名 cursor 并显示稳定分类、
原因、风险和审核状态。小型文字修正保留公开状态与原期限；价格、分类、区域、联系、位置、媒体、
attributes、locale 或风险信号变化立即重新人工审核并从公开读消失。revision/evaluation/case/Audit/
Outbox 原子提交，精确重试不重复写；批准只恢复原 publication window，已到期直接 EXPIRED，旧案件或
旧事件不能覆盖较新版本。

`NOTIF-001` 已验收 Listing 状态站内通知：Worker 只接受版本正确、UUID/时间/聚合一致且属于白名单事件的
Outbox envelope；未知/畸形事件永久失败，瞬时数据库错误继续重试。Repository 以 eventId advisory
lock、canonical Listing owner 和 `source_event_id + user_id + channel` 唯一键保证并发重复投递只产生
一条；LOW 自动发布和 MEDIUM 待审核规则、中文/英文 locale 选择及不可变模板由真实 PostgreSQL 验证。
私有列表按 `createdAt + id` 稳定分页，HMAC cursor 绑定账号和未读筛选；外部/未知通知共用 404，已读
重试不重复改变状态。中英文 noindex Web 通知中心具备登录门、未读筛选、分页、已读、错误/空态、44px
触控目标和移动无溢出 E2E。当前只支持 IN_APP；邮件/SMS、偏好、退订与 provider 重试明确属于
`NOTIF-002`。

Gate 1 的 MEDIA-001 前置验收：上传 intent 要求认证/CSRF/Policy 和 owner 范围幂等；并发活动数量与
滚动字节配额不可绕过；仅返回五分钟、长度/MIME/SHA-256/SSE 绑定的私有 quarantine PUT；文件名不能
决定 bucket/key；普通媒体路径拒绝 SVG/HTML 和验证文档；原始对象在 READY 前没有公共 URL。

Gate 1 的 MEDIA-002 验收：完成端点只允许 ACTIVE owner，并用服务端 HEAD 元数据闭合 intent；
成功只返回 SCANNING。Worker 必须对实际字节复算长度/hash、检查 magic bytes、真实接入 ClamAV、
解码且限制像素，输出恰好 THUMBNAIL/CARD/FULL 三个无 EXIF/ICC 的 WebP；原始和派生对象保持私有。
SCANNING→READY/REJECTED、变体和 Outbox 必须在数据库事务中按 lifecycleVersion 幂等；永久内容错误
拒绝、暂时依赖错误重试、重复/乱序事件不得覆盖终态。CI 必须用真实 clamd 对 clean 与标准测试签名验证，
不能只依赖 mock。

## 22.5 搜索验收

- 中英查询、城市别名、分类、价格、时间、距离筛选工作。
- 结果仅包含可公开状态，排序稳定、cursor 不重复/漏页（允许变动语义文档化）。
- 推广结果可识别，不出现违规/过期/无关内容。
- 新发布 p95 60 秒可搜；下架 p95 10 秒消失。
- OpenSearch 不可用时详情/发布继续，搜索明确降级。
- 全量重建和 alias 回滚演练通过。
- 相关性标注集达到团队设定门槛，零结果和慢查询有 Dashboard。

## 22.6 消息与信任验收

- 只有参与者可读会话；不存在 IDOR。
- 新账号/高频消息受限；屏蔽后不能发新消息。
- 举报不泄露举报者，进入正确队列并可审计。
- 联系方式 reveal 受认证、频率和发布者策略控制。
- 商家/师傅验证结论与原件权限分离。
- 评价只允许合格互动，同一关系不重复。

## 22.7 商业化验收

- 价格/SKU 快照保存在订单。
- 浏览器返回不能直接将订单标为 PAID。
- Stripe 签名失败拒绝；重复/乱序 webhook 不重复账本/履约。
- 钱包所有余额可由不可变 entries 重算且对账为零差异。
- 固定广告库存不超卖；素材批准后变更重新审核。
- 退款引用原付款/履约，具有权限、理由和审计。
- 广告/置顶有视觉和辅助技术标识。

## 22.8 生产就绪验收

- SLO Dashboard、on-call、告警、Runbook 和 owner 完整。
- 目标负载压测满足预算，或有书面风险接受和扩容计划。
- RDS 恢复、OpenSearch 重建、Redis/Outbox 恢复演练达 RTO/RPO。
- 独立安全审查/渗透测试高危清零。
- 法律政策、隐私、条款、举报/申诉、退款和营销同意经过批准。
- 审核/客服/财务/广告运营培训并通过演练。
- 灰度、Feature Flag、回滚、状态页/沟通模板准备完成。
- 首页统计、商家、师傅、评价和广告均来自真实授权数据或隐藏。

## 22.9 ORG-002 成员生命周期验收

- OWNER/ADMIN 可对现有 ACTIVE 用户创建短效非 Owner 邀请；同 key 精确重试返回同一资源，不同输入
  409，同受邀人并发 PENDING 邀请不重复。
- 只有邀请绑定用户可接受；撤销、过期、跨用户和跨组织请求失败关闭，联系方式不进入响应、事件或日志。
- 非 Owner 角色变更使用强 ETag；self、Owner 与最后 Owner 不能通过通用变更/删除接口移除。
- Owner 转移要求当前 OWNER、近期 MFA 与幂等键，并在并发/失败/重试下始终至少保留一名 Owner。
- 邀请创建事件生成可重复消费的双语站内通知；API、数据库、Worker、Web parser 和真实迁移验证通过。

## 22.10 LIST-009 用户中心信息管理验收

- 认证用户可按草稿、审核中、已发布、已归档查看个人及当前组织可读的最小摘要和准确计数；过期公开行
  不会继续显示在已发布，DELETED 永不返回。
- 分页按 `(createdAt,id)` 稳定，cursor 绑定账号和全部筛选；篡改、跨账号/筛选重放及越界 limit 失败。
- 批量归档/删除最多 20 个唯一对象并携带各自强版本；结果保持请求顺序、支持部分成功，跨 owner、
  只读组织角色、未知、版本冲突和状态冲突不造成越权或对象存在性泄漏。
- 删除/归档精确重试不重复 Audit/Outbox；SUSPENDED 不显示删除动作，受限账号可读但不能批量写。
- 中英文、移动/桌面、键盘、触控、loading/empty/error/guest/部分失败、删除确认、noindex/no-store
  和草稿精确编辑入口均有自动化验证；OpenAPI、生成类型、Zod、BFF 和实现一致。
