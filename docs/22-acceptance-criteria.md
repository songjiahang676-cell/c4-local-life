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
Audit/Outbox 和安全详情投影。自动保存/浏览器恢复与 READY 媒体绑定属于 `LIST-004`；提交、审核、
发布、删除和过期仍由后续 LIST/MOD 切片完成，不能因本项通过而标记整个 22.4 完成。

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
