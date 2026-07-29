# 14. 安全、隐私与合规

> 本章是工程安全基线，不替代律师对加州/美国法律、就业、住房、广告、支付、税务及跨境业务的审查。

## 14.1 保护目标

- 用户账户、会话和组织权限不被接管。
- 电话、邮箱、精确地址、验证材料和消息不被未授权访问。
- 内容发布、评价、举报和广告不被批量滥用。
- 订单、支付、退款、积分和履约可证明且不可静默篡改。
- 后台动作最小权限、可追踪、可撤销/补救。
- 系统在第三方、队列和缓存故障时保持安全默认。

## 14.2 威胁模型摘要

| 威胁          | 典型场景                     | 主要控制                                      |
| ------------- | ---------------------------- | --------------------------------------------- |
| 账户接管      | OTP 猜测、凭据填充、会话盗窃 | 限频、风险验证、Secure session、设备撤销、MFA |
| IDOR/越权     | 修改他人信息、查看会话/订单  | 对象级 policy、查询约束、负面测试             |
| 发布诈骗      | 低价房、假工作、外部押金     | 风险评分、验证、重复检测、消息警告、举报      |
| 批量抓取      | 抓手机号、商家数据、列表     | 受控联系展示、速率、WAF、行为检测             |
| 上传攻击      | 恶意文件、脚本、图像解析漏洞 | quarantine、扫描、重编码、独立域、CSP         |
| 注入/XSS/SSRF | 用户正文、URL、后台预览      | 参数化查询、输出编码、URL allowlist、网络隔离 |
| 支付伪造      | 假回调、重放、重复履约       | webhook 签名、事件唯一、幂等账本              |
| 内部滥用      | 后台查隐私、改账             | 最小权限、MFA、双人审批、不可变审计           |
| 供应链        | 恶意依赖/镜像                | lockfile、签名/扫描、最小镜像、升级流程       |
| DDoS/机器人   | 搜索、登录、消息、上传       | CDN/WAF、分层限流、挑战、配额、降级           |

每个高风险功能在实现任务中补充具体数据流和滥用用例。

## 14.3 认证

- 邮箱/手机号 OTP：随机、短效、一次消费、只存 hash；按账号/IP/设备/目的分层限频。
- 错误响应不泄露账号是否存在。
- 密码如启用，使用 Argon2id 或经安全评审的强 KDF，支持泄漏密码检查。
- 管理员和高权限组织角色强制 MFA；敏感动作 step-up。
- OAuth/OIDC 回调校验 state、nonce、PKCE 和精确 redirect URI。
- 账户恢复比登录更敏感，需要冷却、通知和历史设备风险。

`AUTH-002` 使用密码学安全的六位数字验证码，默认 10 分钟有效、最多失败 5 次、同账号/目的 15 分钟
3 次、同设备每小时 10 次、同 IP 每小时 20 次。创建 challenge 时以排序后的 PostgreSQL advisory
transaction lock 串行化三个限频键，避免并发绕过；新的同账号/目的 challenge 会使旧 challenge
立即失效。验证码、账号查找键、IP 和设备标识只保存以独立 `OTP_SECRET` 做域分离的 HMAC-SHA256，
验证码从不进入 HTTP 响应或日志。验证绑定请求设备、成功后原子一次消费，未知、过期、已消费、错误、
跨设备和不可用账号共用同一错误投影。目标联系方式属于其他账号时，联系验证创建不可投递的 decoy，
不泄露占用状态。challenge 中用于投递和建档的联系方式按 Confidential PII 管理，10 分钟失效并须在
24 小时内由保留任务删除或聚合。客户端 IP 仅接受 loopback/VPC 私网可信反向代理提供的转发链；
互联网来源不能用伪造 `X-Forwarded-For` 绕过 IP 限频，生产安全组仍须禁止绕过负载均衡器直连 API。

## 14.4 会话与 CSRF

- 随机会话 token，仅 cookie 保存；数据库存 hash。
- Cookie：Secure、HttpOnly、合理 SameSite、最小 Domain/Path。
- 登录后旋转会话；权限提升、密码/邮箱/手机号变更后撤销相关会话。
- 修改请求使用 SameSite + CSRF token/origin 检查；不要以 CORS 代替 CSRF。
- 会话有绝对过期和闲置过期；用户可查看/撤销设备。

`AUTH-001` 当前实现使用 256-bit 随机 base64url bearer token，Cookie 之外不返回 token；数据库只保存
以 `SESSION_SECRET` 做域分离 HMAC-SHA256 后的摘要。Cookie 为 host-only、`Secure`、`HttpOnly`、
`SameSite=Lax`、`Path=/v1`，重复同名 Cookie 按无效凭据处理。默认绝对期限 30 天、闲置期限 7 天，
最多每 5 分钟刷新一次闲置时间且绝不越过绝对期限。登录/权限提升调用原子 rotation；退出幂等撤销。
`SUSPENDED`、`DELETED`、已软删或缺少完整 profile 的用户 fail closed，响应投影不包含邮箱、手机号、
token hash 或 IP hash。首次部署闲置期限字段时现有会话统一失效并要求重新认证。

`AUTH-003` 增加用户自助资料和设备会话边界。资料修改要求强 ETag/version，拒绝未知字段、控制字符、
双向文本控制符、任意头像 URL 和停用地区；返回投影不包含联系方式或内部风险字段。活跃会话列表使用
用户绑定的签名 cursor，只返回 session UUID、清理后的 User-Agent 与生命周期时间，不返回 token、
token/IP hash。撤销 session 的数据库条件同时包含 `userId + sessionId`，避免 IDOR；未知、外部和已撤销
ID 均幂等 204。当前会话/注销全部同步返回过期 Cookie。`users.status` 或 `deleted_at` 变化由数据库
trigger 立即设置全部未撤销会话的 `revoked_at`，避免后来 Admin/删除工作流绕过身份层不变量。

## 14.5 授权

- 默认拒绝；后端 policy 基于 actor/action/resource/context。
- 所有 ID 参数进行对象级授权，批量 API 逐条或集合约束。
- 组织边界在 repository query 中体现。
- 后台角色与普通组织角色命名/权限分离。
- 高风险后台动作需要 reason、工单和可选双人复核。

`API-004` 将授权入口统一为 PII 最小化 Actor、不可变 RequestContext、显式动作注册和全局 Policy
Guard。客户端提交的 permission、owner、organization 或 role 都不是授权事实；对象规则必须使用
Repository scoped query 返回的最小上下文。未知动作、重复注册、规则异常、缺失/已删除资源均失败关闭，
内部 deny reason 不进入通用 401/403。跨组织、错误角色、受限账户和缺失资源由可复用矩阵持续做负面测试。
`POST /listings` 的参考实现也要求 `listing:draft:create`；未登录返回 401，LIMITED 账户返回不泄露原因的
403，避免已有写端点在框架接入后继续绕过服务端权限。

`LIST-002` 把 Listing 对象授权下沉到 Repository 查询：公开查询强制当前发布/审核/过期/删除及
taxonomy/主体状态，owner 查询绑定直接所有权或当前 organization membership，审核投影只允许 ACTIVE
且具有当前 `MODERATOR|SENIOR_MODERATOR` grant 的 actor，并要求受控 region/category scope 匹配。
撤销、到期、错误角色、越界、损坏 scope、受限/暂停 actor 与不存在资源都失败关闭。三种投影各用
显式 `select`，不会先取完整 Prisma 模型；邮箱、手机号、组织 legal name、token/IP、公开精确坐标和
不属于当前角色的动态字段从查询边界即被排除。动态 JSON 按 Listing 保存的精确已发布 schema version
做字段 visibility 白名单，未知属性或 schema 缺失时返回空对象，避免历史配置漂移和 JSON 注入字段
造成横向泄漏。后续 Controller 仍须通过 API-004 Policy；Repository 不是前端隐藏或单独的全部授权层。

`LIST-003` 在 HTTP 与事务边界补齐双重授权：创建/更新先要求 ACTIVE actor permission，owner/org
读取再用 Repository 当前 membership 查询并经对象 Policy；组织创建者被移出后不能靠 `owner_id`
继续读取或写入。草稿对 guest/外部用户统一 404，能合法读取但角色只读的组织成员写入返回通用 403。
创建幂等证据只保存受约束 key 和 SHA-256 canonical request hash，不保存 request body；数据库要求两列
同时为空或同时为有效值，并用 `owner + key` 唯一索引与事务锁抵御重试竞态。更新使用行锁和
version predicate；Audit/Outbox 只含 actor/Listing/type/status/version/requestId 等最小证据，不复制
标题、正文、动态属性、精确坐标、联系方式或 provider 数据。

`ORG-001` 的组织创建在同一事务内写 Organization 和初始 OWNER，避免半完成组织；普通用户不能创建
`INTERNAL` 组织或提交 status、verification/role。对象读取先以 actor membership 约束 Repository；
跨组织与未知 ID 返回相同通用 404。Policy 使用查询到的当前角色覆盖请求开始时的 membership 快照，
成员列表 SQL 还要求 OWNER/ADMIN，以减少并发降权后的越权窗口。返回成员仅含 display name、受控头像、
角色和加入时间，cursor 绑定 actor 与 organization；不返回联系方式、账号风险、token/IP 或验证材料。

`ADMIN-001` 把平台角色保存在独立、可撤销/到期且带 grant/revoke provenance 的表中，认证 Repository
每次请求读取当前有效授权，避免长效客户端 claims 造成降权延迟。Admin API 对 guest 返回 401，对普通
ACTIVE 或 LIMITED 员工账号返回同样不泄露内部角色的 403；所有结果包括错误都 no-store。Admin app
只使用同源 allowlist BFF，设置 nonce-based script CSP、frame denial、no-referrer、noindex 和
Permissions-Policy，并且从服务端返回的导航渲染入口。OTP 只能建立普通 Session；在 `AUTH-005`
之前服务端明确返回 `privilegedActionsAllowed=false`，不把 UI 隐藏当作授权。

`AUTH-005` 使用 RFC 4226/6238 的 6 位、30 秒 TOTP（允许前后各一个时间步），通过 Node 内置
HMAC-SHA1 计算并用公开标准向量测试。TOTP secret 由 CSPRNG 产生，以从独立 `MFA_SECRET` 域分离
派生的 AES-256-GCM key 加密保存；恢复码具有 80 bit 随机性，仅保存域分离 HMAC-SHA256，明文只在
激活成功时返回一次。数据库原子记录最后消费的时间步和恢复码，拒绝并发/重复使用；连续五次失败锁定
五分钟，响应使用通用 400/429，不泄露 credential 状态。pending 设置十分钟到期，重试返回相同设置而
不是静默替换。

MFA 成功会轮换 bearer Session，旧 token 立即失效；MFA Session 默认绝对 8 小时、闲置 30 分钟，
十分钟后普通后台权限仍可存在但敏感动作必须重新 step-up。平台角色仍在每次请求从 PostgreSQL 读取，
角色撤销不会等待 MFA Session 到期。设置、TOTP 验证和恢复码消费都写最小化 `AuditLog`，不记录
secret、code、token、IP 原文或 PII。当前不提供低保证的 MFA 关闭/重置；恢复需要后续受审计身份核验
流程并撤销全部 Session。

`AUTH-004` 把密码认证保持为可选能力：密码先做 NFC 规范化和 15–128 Unicode code point 长度检查，
拒绝控制字符与内置常见/泄漏密码 blocklist，再使用独立 `PASSWORD_PEPPER` 域分离 HMAC 和
scrypt `N=2^17,r=8,p=1`、32-byte 随机 salt、64-byte verifier。数据库只保存版本化 verifier，不保存
密码、pepper 或恢复 token。登录对未知账号、未设置密码、错误密码和状态不可用账号使用同一 401，并对
identifier、IP、device 三个维度串行限流；连续失败达到阈值后持久锁定，锁定期间仍执行 dummy KDF，
降低账号枚举和时序差异。

密码设置/恢复使用 256-bit 单次随机 token，只保存域分离 hash；请求对存在/不存在账号返回相同 202
投影，并受 destination、IP、device 限流。证明必须等待默认五分钟安全冷却且在默认三十分钟内消费，
错误证明最多五次，新请求会使旧请求失效。成功后在同一 PostgreSQL 事务内更换 verifier、清除失败状态、
消费恢复记录、撤销该用户全部 Session 并追加不含 token/PII 的 `AuditLog`，然后发送密码变更通知；
绝不自动登录。通知端口在未配置真实 provider 时 fail-closed，真实邮件/SMS durable adapter 仍由
`NOTIF-002` 接入；`NOTIF-001` 只实现不含联系方式或 provider 凭据的站内 Listing 状态通知。

`TAX-001` 的公开主数据端点只返回 active Region/Category 与受控公开字段；匿名请求不能用
`activeOnly=false` 读取待发布/停用配置。查询 DTO 严格拒绝未知字段、模糊布尔值、控制字符和 bidi
控制符，长度限制为 80；Repository 参数化 SQL，别名归一化键不返回客户端。种子别名按稳定父 ID
协调并受唯一/FK 约束，不接收用户生成文本，也不把非权威 seed 中心点描述成精确地址。

`TAX-002` 的匿名表单端点只读取 active Category 的已发布版本，draft 和审计 actor 永不进入公开
DTO。已发布定义在数据库层禁止 update/delete；draft revision、当前版本和 Category 行锁共同防止
丢失更新，回滚追加新版本并保留来源。配置验证限制字段/选项数量和字符串长度，拒绝未知属性、任意
脚本、回溯引用、lookaround 与嵌套量词，降低配置注入和 ReDoS 风险。PHONE/EMAIL 动态字段必须
OWNER_ONLY/MODERATOR_ONLY 且不可进入搜索/筛选投影。Listing attributes 在服务端按其保存的精确
schema version 验证，不能信任前端表单隐藏或当前版本替代历史授权/校验事实。

## 14.6 输入、输出和内容安全

- API DTO 白名单、长度/嵌套/body 限制；未知字段按策略拒绝。
- SQL 仅参数化；动态排序/字段由白名单映射。
- 用户富文本优先存安全结构/Markdown 子集，渲染时严格 sanitize。
- URL 解析使用标准库，禁止内网/metadata IP、非 HTTP(S) 和重定向绕过。
- CSP 默认严格；用户媒体在无 cookie 独立域，禁止 SVG/HTML 直接公开执行。
- 错误不返回 stack、SQL、provider secret 或内部风险规则。

## 14.7 文件与媒体

- 原始上传在 quarantine，短效预签名、大小/数量配额。
- 校验 magic bytes、解码、杀毒、图像重编码、去 EXIF、生成安全文件名。
- 验证证件使用独立私有桶、KMS key、访问审批和短保留。
- 下载响应设置正确 Content-Type、Content-Disposition、nosniff 和缓存策略。
- 对象删除采用异步清单和重试，数据库状态与对象生命周期对账。

`MEDIA-001` 的 quarantine intent 使用认证 ACTIVE actor 和后端 Policy；数据库在 owner 级事务锁内
防止并发绕过活动数量/滚动字节配额，并以 `owner + Idempotency-Key + request hash` 阻止跨用户重放和
同键换 payload。对象 key 只含随机 UUID，不含原始文件名、用户 ID 或 PII；客户端不能提交 bucket/key。
五分钟 PUT 签名绑定声明长度、白名单 MIME、SHA-256 checksum/metadata 和 SSE，响应及所有错误均
`no-store`，HTTP 遥测不记录 body、签名 URL、hash、对象 key 或幂等键。私有 bucket 本地启动时显式
设置 anonymous `none`；生产仍须以独立 S3 bucket policy、Block Public Access、最小任务角色和
生命周期规则落实。此路径不接受 SVG/HTML、视频或验证文件；UPLOADING 不得用于公开页面。

`MEDIA-002` 的完成端点不信任客户端“上传成功”声明，而以对象存储 HEAD 元数据做第一层闭合，并由
Worker 对实际字节再次复算长度/SHA-256、检查 magic bytes 和执行真实 ClamAV INSTREAM。Sharp 在
40MP 默认像素上限内解码、拒绝多页/损坏输入、按方向旋转并重编码为 WebP，不复制 EXIF/ICC。原始对象
和派生桶均保持私有，key 只含 UUID/固定 variant；派生写入要求 SSE、不可变缓存 metadata 和安全
`image/webp` 类型。永久拒绝仅保存有界错误码，不保存扫描响应或原始 provider 错误；暂时依赖故障重试。
数据库 row lock + lifecycleVersion 阻止重复/乱序队列覆盖终态，只有 READY 才能被后续业务绑定。

`LIST-004` 的 Web BFF 仅允许发布表单所需的 method/path 组合，UUID 段严格校验且不代理 Admin、
DELETE 或任意上游路径。浏览器恢复 key 同时绑定 server-derived userId 与 locale，解析时限制总大小、
字段长度、媒体数量和枚举；切换账号不能读取上一账号草稿。媒体状态查询只对 owner 返回有界生命周期，
跨 owner/删除/未知统一 404；数据库和事务双重要求 READY + LISTING_MEDIA + IMAGE，并以确定性行锁
阻止跨 Listing 竞争绑定。客户端移除图片只解绑，不绕过未来媒体删除和审计工作流。

## 14.8 PII 分类

| 等级              | 示例                             | 控制                       |
| ----------------- | -------------------------------- | -------------------------- |
| Public            | 显示名、公开商家资料、公开信息   | 内容政策与完整性           |
| Internal          | 风险分、运营备注、聚合指标       | 员工最小权限               |
| Confidential      | 邮箱、手机号、精确地址、消息     | 字段级输出策略、加密、审计 |
| Highly Restricted | 身份证件、付款争议证据、恢复凭据 | 独立存储、双重授权、短保留 |

日志和分析默认不得包含 Confidential/Highly Restricted 原文。IP 采用必要时的截断/散列和短期保留。

## 14.9 隐私权工作流

系统需支持访问、更正、删除、数据可携带、营销退出和“不要出售/分享”（如适用）的请求管理：身份验证、范围判断、导出、例外/保留、执行、审计和 SLA。删除必须覆盖数据库公开数据、搜索、缓存、对象、通知提供商和分析标识，同时保留最小法定财务/安全证据。

## 14.10 加州与领域合规关注

需法律确认并转化为政策/测试：

- CCPA/CPRA 适用性、敏感个人信息、服务商合同和隐私请求。
- 营销短信/电话同意、退订和 Do Not Call/TCPA 风险。
- CAN-SPAM/邮件退订。
- 公平住房广告和就业歧视描述。
- 承包商/专业服务执照与免责声明。
- 儿童用户、年龄门槛和内容。
- 侵权通知、用户生成内容、社区规范和执法请求。
- 跨境货源、进口、食品/保健/仿牌/受限商品。

未完成审查的高风险分类默认关闭。

## 14.11 密钥与基础设施

- 本地 `.env` 仅占位；生产使用 Secrets Manager/Parameter Store + KMS。
- IAM 采用任务角色，不使用长期云访问密钥。
- 数据库、Redis、OpenSearch 位于私有子网；安全组最小开放。
- 管理入口经 SSO/MFA、WAF/访问代理；不直接暴露数据库控制台。
- 生产与非生产账号/密钥/数据隔离；禁止复制真实 PII 到开发环境。

## 14.12 安全验证

CI：secret scanning、SAST、依赖/许可证、IaC 和容器扫描；定期 DAST。上线前完成独立渗透测试，重点覆盖 Auth、IDOR、消息、上传、Admin、Stripe webhook 和 SSRF。高危未修复不得发布；风险接受需负责人和到期日。

## 14.13 事件响应

建立 Sev0–Sev3 分级、值班、证据保全、密钥旋转、用户/监管通知决策和事后复盘。不得为了“清理”而删除审计证据；也不得无限保存无关 PII。详见 `docs/20-operations-runbook.md`。

## 14.14 提交审核证据最小化

`MOD-001` 的提交风险控制在授权后的应用层执行，并在 repository 事务内再次验证 ACTIVE actor、
当前组织写角色、DRAFT/NOT_REVIEWED 状态和版本。规则命中证据不保存匹配原文，只保存规则代码、
版本、严重度和字段名；公开响应仅返回 LOW/MEDIUM/HIGH 与规则集版本。数据库将 evaluation/hit
设为不可变，避免审核历史被覆盖；Audit/Outbox payload 不包含正文、attributes、联系信息、
Idempotency-Key 或请求哈希。

## 14.15 人工审核威胁与缓解

- 越权/授权陈旧：Controller Policy 要求 MFA moderator；Repository 每次读写重新查询 ACTIVE user、
  未撤销 Session 与当前未过期平台角色，UI 导航不作为权限。
- 并发覆盖/重复动作：强 Case ETag、Listing/Case 行锁、版本 predicate、actor/key advisory lock、
  唯一索引和 request hash 将精确重试与不同请求冲突分开。
- PII 扩散：提交快照按历史表单 schema 删除 PHONE/EMAIL/contact/address 类动态字段，不存 latitude/
  longitude；API 只返回快照、稳定 evidence key 与聚合计数，内部备注不进入响应/Audit/Outbox。
- 审核证据篡改：snapshot/action 更新与删除由数据库触发器拒绝，快照对 Case 使用 RESTRICT；历史
  evaluation/hits 仍保持不可变。
- CSRF/代理扩大：写动作要求可信 Admin Origin；Admin 同源 BFF 使用精确 method/path 和 UUID
  allowlist，未知/方法混淆路径失败关闭。

## 14.16 公共 Listing 生命周期威胁与缓解

- 枚举/PII 泄露：公开列表和详情使用专用 projection；列表不返回 body、精确点位、contactMode、
  mediaIds 或审核字段，非公开状态统一 404。
- cursor 篡改/重放：HMAC 使用域分隔并绑定 type/category/region；签名定长比较，非法 cursor 返回
  通用 400，不回显 payload。
- 越权/并发覆盖：归档与删除要求 ACTIVE permission、对象 Policy、Repository 锁后授权复核和强
  ETag；外部用户得到通用 404，受限账号 403。
- 重复/并发过期：到期查询有界并使用 `SKIP LOCKED`；只允许 PUBLISHED + approved Rental 和当前
  version 更新。Audit/Outbox 与状态原子提交，重复轮询不复制证据。
