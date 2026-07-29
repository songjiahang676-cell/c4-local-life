# 安全政策

## 报告漏洞

不要在公开 Issue 中披露可被利用的漏洞、真实用户数据或凭据。生产前应建立私有安全邮箱与漏洞响应流程；当前仓库中的建议占位地址为 `security@example.invalid`，部署时必须替换。

报告应包含受影响组件、复现条件、影响、可能的缓解方式以及是否接触到真实数据。安全负责人应在 1 个工作日内确认，高危问题立即进入事件响应。

## 安全基线

- 所有生产流量使用 TLS；管理后台和内部运维入口强制 MFA。
- 平台角色使用可到期/撤销且保留 grant/revoke provenance 的服务端授权；Admin 导航不是权限边界，
  普通或受限账号在 API 返回通用 403。Admin 使用独立加密密钥保护的 TOTP、一次性恢复码和短时
  recent-auth；PRIMARY 会话及近期认证已过期的会话都无法访问对应特权或敏感动作。
- 会话使用 Secure、HttpOnly、SameSite Cookie；不把长效令牌存放在浏览器 Local Storage。
- 可选密码使用独立 pepper、随机 salt 和版本化 scrypt `N=2^17,r=8,p=1`；登录失败通用化并按账号、
  IP、设备限频/锁定。恢复 token 只存哈希、冷却后单次消费，成功会撤销全部 Session、写审计和通知，
  不自动登录。OTP 限频、一次性消费并短时有效。
- 全部资源执行后端对象级授权；前端显示控制不是授权。
- Listing 草稿写入要求 ACTIVE actor、当前个人 owner 或组织写角色；组织创建者无永久旁路。创建以
  owner 范围幂等键、canonical hash、唯一索引和事务锁防重复，更新以强 ETag、行锁和版本条件防覆盖；
  成功写入在同一事务追加不含正文/attributes/PII 的 Audit 与 Outbox。
- 上传采用认证/幂等/配额、短效校验和长度绑定的私有 quarantine 预签名；公开前必须完成 magic-byte、
  恶意文件扫描、图像解码重编码/去 EXIF，并通过独立无 Cookie 域名分发。完成端点以服务端 HEAD 闭合
  intent，Worker 对实际字节复算 hash、经真实 ClamAV INSTREAM 和 Sharp 像素上限处理，只写入三个
  确定性加密 WebP；原始/派生桶保持私有，重复或乱序事件不能越过 lifecycleVersion。
- 五类 Listing 发布只经 method/path allowlist 同源 BFF；本地恢复按 server-derived userId + locale
  - vertical 隔离。
    媒体状态未知/跨 owner/删除统一 404，只有数据库确认 READY 的 LISTING_MEDIA 图片可在事务中绑定。
- 异步事件采用数据库同事务 Outbox 和至少一次投递；`eventId` 是消费者幂等键，队列 envelope 有大小
  上限和版本。日志/指标不记录事件 payload、原始提供商错误或 PII，失败只保留有界错误码。
- Listing 状态通知只从 canonical Listing owner/locale 投影，严格验证事件且以 eventId 锁和复合唯一键
  去重；模板发布后不可修改，变量仅含资源 ID/版本。通知列表和已读要求服务端账号 Policy，cursor 绑定
  账号/筛选，未知与跨账号 ID 统一 404；响应、BFF 和页面均 no-store/noindex，不记录正文或收件人。
- 组织邀请只允许当前 Owner/Admin 创建或撤销，按组织/规范化邮箱限制一条 pending，并由短效过期时间
  关闭旧链接；接受操作从当前会话推导账号并再次核对规范化邮箱。成员角色/移除要求强 ETag 并在组织锁
  后复核权限；数据库 deferred trigger 保证事务提交时至少一名 Owner。Owner 转移仅允许当前 Owner，
  还要求 MFA-bound 会话与十分钟内 recent-auth，目标晋升、原 Owner 降级、Audit/Outbox 原子写入。
- 支付数据由支付服务商托管；平台不保存完整卡号和 CVC。
- 密钥存入云 Secret Manager/KMS，禁止写入镜像、日志或仓库。
- 依赖、容器、IaC、SAST、secret scanning 和 DAST 纳入 CI/CD。

完整威胁模型和控制要求见 `docs/14-security-privacy-compliance.md`。

## 提交审核数据最小化

Listing 提交要求 ACTIVE actor、对象级 owner/组织写权限、强 ETag 和幂等键。风险规则只把
规则代码、版本、严重度和证据字段名写入不可变审核证据；匹配到的邮箱、电话、付款词或正文
不会复制到命中记录、公开响应或日志。中高风险案件不能绕过后端授权，低风险自动通过仍保留
版本化 evaluation、Audit 和 Outbox。

## 人工审核边界

审核队列和详情只允许当前 ACTIVE、MFA-bound 且仍具有 MODERATOR/SENIOR_MODERATOR 授权的会话；
Repository 在每次读取及写事务内重新检查 Session 与授权，撤销/到期在下一请求生效。处置动作另要求
十分钟内的 recent MFA、强 Case ETag、标准 action/reason 组合和 actor-scoped 幂等键。提交快照在
创建时删除动态联系/地址字段且不保存精确坐标；数据库触发器阻止快照与动作 UPDATE/DELETE。内部备注
不进入 HTTP 响应、Audit metadata、Outbox payload 或结构化日志。

## 公共 Listing 生命周期边界

五类 Listing 公开列表/详情只读取批准且当前有效的 PostgreSQL 行，并在查询层同时过滤删除、期限、
taxonomy、owner 与组织状态。列表 HMAC cursor 与筛选条件绑定，拒绝篡改和跨筛选重放；列表摘要
不返回正文、精确坐标、联系方式、媒体绑定或审核字段。归档/删除要求 ACTIVE actor、对象级
owner/组织写角色和强 ETag，Repository 在行锁后复核授权与版本；软删除重试不会重复 Audit/
Outbox。过期 Worker 只处理到期 `PUBLISHED` 五类 Listing，使用 `SKIP LOCKED` 与状态/version predicate
避免并发重复，系统审计和事件不包含正文、attributes 或 PII。

## 招聘信息边界

Job 草稿必须同时保存一致的雇主、用工形式和薪资明细；应用服务和 Repository 双层拒绝缺失 Job
明细或向其他垂类挂接 Job 明细。最低/最高薪资必须为正数、同周期且下限不高于上限。就业政策确认属于
`OWNER_ONLY` 动态字段，不进入公开投影。规则 v3 对就业政策风险只保存规则代码、版本、严重度和字段
名并进入人工审核，不在命中表、审计、事件、日志或响应中复制疑似歧视性原文；政策来源及帮助文本
链接 California Civil Rights Department 和 Labor Commissioner 官方页面。

## 转让、二手与服务边界

Transfer 强制人工审核并要求发布者确认财务数字未经平台核验；要价、租金和剩余租期由应用与数据库
约束保持一致。Secondhand 要求合法来源和禁售品确认，规则 v3 只把高置信疑似禁售品命中的字段名写入
高优先审核证据，不复制原文或自动作出处罚。Service 的执照号属于 `OWNER_ONLY`，公开执照/保险状态
明确为发布者声明而非平台验证；服务半径、可用时间和价格单位均有界。三类详情只能与相同 Listing
类型绑定，公开投影剔除政策确认、执照号、未知动态字段、联系方式和精确坐标。
