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

## 22.11 MOD-003 重复检测验收

- 同类型一年窗口内能产生文本、图片和联系方式候选，输入/结果有界；跨类型、过期窗口、自身和
  DELETED 不进入候选。
- 阈值集有稳定版本；低阈值候选为 DRY_RUN 且不改变 LOW 决策，达到执行阈值才追加中风险
  `POSSIBLE_DUPLICATE` 并送人工审核，系统绝不自动定罪或删除。
- 原始联系方式不持久化到检测表，Admin/API/日志/指标/Audit/Outbox 不暴露联系方式指纹、相似数值、
  阈值、媒体 object key 或候选 owner。
- 候选证据绑定 evaluation/Listing 版本并不可更新或删除，人工复核结果一次写定；批准记录
  FALSE_POSITIVE，重复原因记录 CONFIRMED，精确幂等重试不重复统计。
- `socal_moderation_duplicate_reviews_total` 仅有 confirmed/false_positive 固定标签；测试以样本量和
  阈值版本解释误杀率，不伪造生产准确率。
- OpenAPI、生成契约、Prisma/migration、回滚说明、真实 PostgreSQL、完整质量、生产浏览器和托管
  保护门禁全部通过后方可标记完成。

## 22.12 WEB-004 账户中心壳验收

- `/[locale]/account` 与现有账户子页共享一份 no-store 内存 Session；并发读取去重，15 秒可见窗口、
  focus、pageshow、visibilitychange 和绝对到期会重新验证。
- 401、过期、网络/服务错误和 malformed/越界 payload 都清空旧能力并失败关闭；Session/permission
  不进入 Web Storage、URL、公开缓存、日志或错误文本。
- 导航只显示服务端返回且当前已实现的能力；缺少通知/发布/信息读取能力时对应入口不存在，受限账号、
  guest、loading、unavailable、retry 与无组织状态均有中英文可访问界面。
- 用户/组织只使用安全摘要并本地化角色/类型；服务端仍对每个资源与 mutation 独立授权。
- 私有页 noindex/no-store、桌面/移动无横向溢出、键盘焦点、组件回归和生产 Chromium 门禁通过；
  OpenAPI/Prisma/migration 无变化并明确记录。

## 22.13 SEARCH-001 版本索引验收

- v1 物理索引、read/write alias 和 `_meta` 版本可重复创建/验证；已有 mapping 或 write alias 漂移时
  失败关闭，不执行不可审查的原地修补。
- 中文 CJK bigram、英文 stop/stem、双语和前缀 analyzer 在目标 OpenSearch 版本真实执行；结构化分类、
  地区、价格、attributes、内容版本和模糊公开 geo point 有确定 mapping。
- TypeScript 文档 DTO 与 `dynamic: strict` mapping 都不允许电话、邮箱、精确地址、审核备注、风险分、
  object key 或认证材料；真实节点写入额外电话字段返回 400。
- CI 固定版本化 OpenSearch service 并健康检查，真实运行 analyzer、alias、index/search、geo 和负例；
  本地缺少 Docker 时必须明确记录，不能把跳过当通过。
- PostgreSQL、OpenAPI、Prisma 和 migration 不变；后续 Worker、query API、同义词和重建任务保持各自
  Backlog 边界。

## 22.14 SEARCH-002 索引 Worker 验收

- 所有 Listing 状态事件只用最小 envelope 触发，文档从 PostgreSQL 当前公开投影重载；非公开、过期、
  删除、主体/taxonomy 无效或不存在的 Listing 执行索引删除。
- 写入/删除使用 canonical external version；真实 OpenSearch 证明旧写和旧删不能覆盖新版本，重复
  投递安全，数据库版本意外落后事件时不信任 payload。
- 下架类事件在 Outbox 领取和 BullMQ 两段优先；freshness histogram 能分别计算 urgent p95 10 秒和
  normal p95 60 秒，标签无资源 ID/PII。
- 周期 reconciliation 稳定分页比较 canonical/index version，能修复缺失、落后和应删除文档；索引
  版本领先失败告警且不反写 PostgreSQL。
- PUBLIC attributes 以历史 schema 白名单；EXACT 坐标、联系方式、未知/私有字段、审核/风险和媒体
  标识有真实 PostgreSQL/OpenSearch 负例；OpenAPI、Prisma 和 migration 保持不变。

## 22.15 SEARCH-003 查询 API 验收

- 中英 NFKC query、类型、分类、地区、decimal price、半径与距离筛选工作；未知/危险/不完整参数、
  倒置价格和超过 50 条请求明确 400。
- 只返回 PUBLISHED、固定快照时未过期的最小公开投影；body、审核/风险、内部 quality/promotion、
  联系方式、精确位置和 provider detail 不进入响应。
- PIT + search_after cursor 绑定全部筛选/排序/limit；篡改/跨查询重放失败，真实 OpenSearch 中分页
  无重复/漏页，第一页后新写入不进入既有 PIT，终页关闭且遗留资源有短效 TTL。
- facets 固定为 type/category/region/price unit；五种排序均有稳定 ID tie-break，distance 只在有坐标
  时使用。query/source/facet/limit/timeout 均受 allowlist，不接受任意脚本或聚合。
- cursor/PIT 过期、timeout 和 OpenSearch 不可用分别返回 410/504/503 与 no-store Problem Details；
  详情、发布和 PostgreSQL canonical 写链不依赖搜索。
- 指标只有固定 outcome/sort/geo；query/cursor/PIT/ID/筛选值/坐标/金额不进入日志或标签。OpenAPI、
  生成类型、单元/HTTP/真实 OpenSearch、完整质量和保护门禁通过后方可标记完成。

## 22.16 SEARCH-004 发现隐私验收

- 已发布词典不可变、只有一个草稿、最后编辑者不能发布，历史回滚先追加草稿并由第二人发布新版本；
  同 scope 歧义词拒绝。
- cursor 固定词典版本；最多八个审核词 OR 展开，每词内部 AND；真实 OpenSearch 能通过同义词命中。
- 建议与热门契约严格、有界、无占位数据；空 q 只用 active taxonomy，热门仅 rank 且无 count。
- 只有首屏、有效结果、非 bot、非敏感 query 可采样；来源为 IP 派生 HMAC，同源换 User-Agent 不增源；
  每 query/source/day 唯一，少于五来源绝不公开。
- 样本默认 30 天、数据库不超过 90 天并可有界清理；query/source/hash 不进入日志或指标标签。
- OpenAPI/生成类型、Prisma/migration/回滚说明、单元/HTTP/PostgreSQL/OpenSearch、全量质量、Linux
  Chromium 和四镜像保护门禁均有真实通过证据后才可标记 done。

## 22.17 WEB-001 公开列表、详情与筛选验收

- 五类 `jobs/rentals/transfers/marketplace/services`、城市路径、全站 `/search` 与
  `[city]/[slug]-[UUID]` 详情均为真实动态 SSR；首页对应入口使用 canonical 新路由。
- 搜索 GET 表单支持中英文 q、类型、分类、城市、decimal 价格与相关度/最新/价格排序；重复参数、
  bidi/control、倒置价格、未知城市和过期 cursor 有明确、安全的恢复或 404。
- 响应经严格 Search/Public Listing/recursive taxonomy Schema；SSR 不转发 Cookie，Owner/内部字段或
  越界响应失败关闭。用户 HTML 不执行，结构化属性只显示有界公开 primitive。
- 卡片和详情以文字标明 PUBLISHED、Sponsored/推广和已验证机构；日期/货币本地化，地点仅显示区域与
  精度，不显示 point、联系方式、审核、风险或媒体内部标识。
- 无结果明确不使用模拟内容；Search 故障仅简单单垂类首屏降级 canonical PostgreSQL 且无后续 cursor，
  复杂筛选显示通用恢复状态。搜索/筛选/cursor 页面 `noindex,follow`。
- 单元/组件/生产 Chromium 桌面和移动覆盖 SSR HTML、双语、label/skip/focus/44px/reflow、列表/详情、
  空态/错误、推广/状态和无横向溢出；完整质量与受保护门禁有真实证据后才可标记 done。

## 22.18 TAX-003 首页布局配置验收

- 十类模块 source 有严格白名单，未知字段、任意 HTML、重复 slot key、未披露广告和越界 TTL/limit
  被契约与应用层拒绝；中英文 seed 只含结构。
- locale/region scope 可创建草稿、乐观更新、发布和从历史版本追加回滚；并发旧 revision/version
  失败且不会覆盖新配置。
- 发布版本在 PostgreSQL 中不可 UPDATE/DELETE；发布/回滚与最小化 cache-invalidation Outbox 事件
  原子提交，事件不携带正文或 PII。
- JSON Schema、Zod、Prisma、migration/回滚说明、单元与 PostgreSQL 负例、种子、全仓质量和受保护
  CI 有真实证据后才可标记完成。公共首页聚合 API 和模块数据隔离仍属于 `WEB-002`。

## 22.19 WEB-002 首页真实数据与模块隔离验收

- `GET /v1/homepage` 严格校验 locale/region/device，返回已发布布局版本和按 slot 排序的 strict
  模块 union；缺少发布 scope 为 no-store 503，unknown query 为无输入反射的 400 Problem Details。
- Hero 仅来自 allowlist 本地化 content key；热门词保留五来源和敏感/bot 筛查；城市来自 active
  taxonomy；Listing feed 限定当前地区、PUBLISHED、未过期 canonical 投影，且不含精确坐标、正文、
  联系方式、审核、风险或内部计数。
- 一个模块失败只省略该模块并标记 partial；真实空模块隐藏且不输出测试 fixture、模拟数字、虚构商家/
  师傅/评价/行情/广告。未实现布局 kind 不出现在响应或页面。
- Web 用一次匿名、限时、限体积、strict SSR 读取渲染双语 Hero/热门/城市/Listing 模块及诚实空态；
  页面无 Cookie 转发、无客户端 Prisma/OpenSearch 访问、语义结构可键盘访问且桌面/移动无横向溢出。
- 发布事件消费者严格验证 Outbox envelope，并以 Redis Lua 原子处理新版本失效与重复/乱序 stale；
  指标只有固定 kind/outcome。OpenAPI、生成类型、单元/HTTP/Worker/Web、全量质量、生产 Chromium 与
  受保护 CI 有真实证据后方可标记 done。

## 22.20 SEO-001 Metadata/canonical/hreflang/robots 验收

- 首页、无查询频道根页及可用详情输出绝对同源 canonical、清洗限长的双语 title/description、
  Open Graph/Twitter 和 `index,follow`；中英真实等价页声明 `zh-Hans`、`en-US`、`x-default`。
- 任意查询参数、全站搜索、未批准城市聚合页为 `noindex,follow` 且 canonical 不含 query；
  城市页仅由严格、有限的 `SEO_INDEXABLE_CITY_ROUTES` 精确白名单开放，非法配置整体失败关闭。
- 详情元数据只从匿名公共 API 的 PUBLISHED、未过期安全投影读取 title/summary/时间；正文、PII、
  精确坐标、联系方式、审核/风险和未知字段不进入 meta。错误 UUID/垂类 404，旧 slug 指向规范路径。
- 占位、账户、消息、发布/编辑和 Admin 保持 `noindex,nofollow`。Web robots 禁止 BFF、健康和私有
  路径且不伪造 sitemap；Admin robots 全站禁止抓取。
- 单元测试覆盖文本清洗、可信 origin、allowlist 失败关闭和完整模板矩阵；生产 standalone Chromium
  桌面/移动实际断言 title、canonical、hreflang、robots、Open Graph/Twitter 和 robots.txt。
  OpenAPI、Prisma 与 migration 不变化；全量质量和受保护 CI 全绿后才可标记 done。

## 22.21 PERF-001 Web/API 缓存与性能预算验收

- API/Worker 共享 locale/encoded-region/device key；只有 strict、scope 相符、≤1 MB、完整非 partial
  首页写 Redis，TTL 为模块最小值且 ≤300 秒。损坏/错 scope/Redis 故障删除或回源，PostgreSQL 仍是
  事实源；同实例并发 miss 只组合一次。
- Web 只缓存完整聚合且 ≤30 秒；完整 API 为 browser max-age 0/shared 30 秒，partial、错误和私有
  响应 no-store。发布事件原子失效三种设备 key，重复/乱序不会回退水位。
- 浏览器按配置采样固定 CWV/route/value，省略凭据、URL/query/slug 和一切标识；API strict 202/400/
  429，地址只做短时 HMAC 限频且不进入日志/指标。缓存和 CWV 指标仅有文档规定的低基数标签。
- 构建后 gzip JS chunk 与生产 standalone HTML/脚本传输预算在桌面/移动自动执行；route-level RED
  可计算 API p95。CI/本地预算不得被表述为生产 LCP/INP/CLS/p95 实测。
- OpenAPI/生成类型、单元/HTTP/Web/Worker、真实 Redis、全量质量、API runtime、Linux Chromium 与
  四镜像受保护门禁有真实证据后方可标记 done；Prisma/migration 不变化。

## 22.22 SEO-002 结构化数据与 Sitemap 分片验收

- 无 query 首页输出 strict 同源 `WebSite/SearchAction`；可索引频道/获批城市/详情输出与可见层级
  一致的 `BreadcrumbList`。只有当前有效、字段完整的 Job 输出 `JobPosting`，且只用公开 summary、
  雇主、用工形式和城市级位置；不含 rating、联系信息、精确地址、owner-only、审核/风险或推断字段。
- JSON-LD exact-key runtime Schema 拒绝未知节点/字段、跨 origin URL、错误日期和越界文本，script
  serializer 转义 HTML/行分隔边界。搜索、query、未批准城市、依赖错误及私有页不输出索引型 JSON-LD。
- `/sitemap.xml` 只列实际有内容的 locale/vertical/published-month 子分片，Listing 分片 `lastmod`
  来自该月最新 canonical `updatedAt`；静态分片只含双语首页、五频道和 active+allowlisted 城市。
- Listing 子分片完整遍历 canonical cursor，再次过滤未来/过期、按 UUID 去重并输出 canonical/双语
  alternate。搜索/query/账户/BFF/健康/Admin/占位、过期和下架资源不得出现。每片 10,000 源记录/
  URL、200 页、15 秒、10 MB；超限、cursor 循环、来源/生产 origin 错误无缓存 503，禁止静默截断。
- robots 仅声明真实 `/sitemap.xml`；成功 XML 也 no-store，失败日志/Server-Timing 不含 URL、cursor、
  ID、内容或 provider error。单元/route 测试与 production Chromium 实际解析 JSON-LD、robots 和
  XML；全仓质量、真实服务、API runtime、Linux Chromium 与四镜像保护门禁全绿后方可标记 done。
- OpenAPI、Prisma、migration 与 canonical 数据形状不变化；PostgreSQL 仍是事实源，OpenSearch 不参与
  sitemap 生成。
