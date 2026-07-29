# 南加生活网（SoCal Life Platform）架构与实施基线

> 版本：0.1.0 ｜ 基线日期：2026-07-21 ｜ 状态：可直接交给 Codex 开始实施

本仓库把首页设想图转化为一套可实施的网站蓝图，包含产品范围、信息架构、权限、领域模型、数据库、REST API、搜索、审核、支付广告、SEO、国际化、安全、运维、测试、交付路线，以及一个可启动的 Monorepo 骨架。

它不是已经完成的生产网站，而是“架构书 + 契约 + 参考代码 + 实施任务包”。Codex 应按 [`CODEX_START_HERE.md`](./CODEX_START_HERE.md) 和 [`tasks/IMPLEMENTATION_SEQUENCE.md`](./tasks/IMPLEMENTATION_SEQUENCE.md) 执行，不应脱离文档自由重构。

## 一、项目目标

建设一个服务洛杉矶及南加州华人的双语本地生活平台，核心能力包括：

- 分类信息：招聘、租房、店铺/生意转让、二手、本地服务。
- 本地发现：城市、分类、商家、师傅、优惠和趋势页。
- 交易前沟通：收藏、站内消息、电话/邮箱受控展示。
- 内容治理：自动风控、人工审核、举报、申诉和审计。
- 商业化：置顶、刷新、推荐位、广告、商家/师傅套餐、积分钱包。
- 后续扩展：问答、论坛、活动、国内货源与跨境资源。

## 二、首期架构结论

- **形态**：模块化单体优先，Web、Admin、API、Worker 四个可独立部署进程。
- **前端**：Next.js App Router，服务端渲染/增量静态生成承担公开 SEO 页面。
- **后端**：NestJS + Fastify，REST-first，OpenAPI 为接口事实源。
- **主数据**：PostgreSQL + PostGIS；所有业务写入以数据库为准。
- **搜索**：OpenSearch 是异步构建的查询读模型，不作为主数据源。
- **异步任务**：Redis + BullMQ；数据库 Outbox 保证事件最终投递。
- **文件**：S3 兼容对象存储；本地使用 MinIO。
- **生产基线**：AWS CloudFront/WAF + ALB + ECS Fargate + RDS + ElastiCache + OpenSearch Service + S3，外部能力通过适配器解耦。

详细原因见 [`docs/07-system-architecture.md`](./docs/07-system-architecture.md) 和 [`adr/`](./adr)。

## 三、目录导航

| 目录/文件              | 用途                                                   |
| ---------------------- | ------------------------------------------------------ |
| `CODEX_START_HERE.md`  | Codex 的第一入口与执行纪律                             |
| `DELIVERY_MANIFEST.md` | 项目负责人/Codex 交付索引与边界                        |
| `VALIDATION_REPORT.md` | 已执行、未执行及首轮动态验收说明                       |
| `AGENTS.md`            | 仓库级开发约束，Codex 应持续遵守                       |
| `ARCHITECTURE_BOOK.md` | 全部架构章节合并版                                     |
| `docs/`                | 分章节架构书，便于检索和维护                           |
| `tasks/`               | Epic、Backlog、阶段顺序、可复制主提示词                |
| `apps/web`             | 面向用户的响应式首页参考实现与后续公开站点             |
| `apps/admin`           | 运营、审核、广告和客服后台骨架                         |
| `apps/api`             | NestJS API 骨架与示例模块                              |
| `apps/worker`          | 搜索、媒体、通知等队列 Worker 骨架                     |
| `packages/database`    | Prisma 数据模型、安全扩展迁移、后置约束 SQL 与查询样例 |
| `packages/contracts`   | 跨应用共享的 Zod 契约                                  |
| `openapi/openapi.yaml` | REST API 契约                                          |
| `schemas/`             | 动态表单、首页编排、分析事件 JSON Schema               |
| `seed/`                | 城市、分类、首页和示例信息种子数据                     |
| `diagrams/`            | Mermaid 系统、部署、流程和 ER 图                       |
| `infra/`               | 云部署与 Terraform 蓝图                                |
| `scripts/`             | 引导、静态校验和本地健康检查脚本                       |

## 四、本地启动

前提：Node 24、pnpm 11、Docker Desktop/Engine。

```bash
cp .env.example .env
corepack enable
pnpm install
pnpm infra:up
pnpm db:generate
pnpm dev
```

四个应用的生产形态容器、健康检查和本地启动方式见
[`docs/local-containers.md`](./docs/local-containers.md)。

默认地址：

- 用户站：`http://localhost:3000`
- 管理后台：`http://localhost:3001`
- API：`http://localhost:4000/v1`
- Swagger：`http://localhost:4000/docs`
- Mailpit：`http://localhost:8025`
- MinIO Console：`http://localhost:9001`

在依赖安装前可先运行纯静态检查：

```bash
bash scripts/check-architecture.sh
```

环境变量、生产秘密来源与脱敏规则见 [`docs/runtime-configuration.md`](./docs/runtime-configuration.md)。
结构日志、基础指标、Trace 传播与 PII 防护见 [`docs/observability-baseline.md`](./docs/observability-baseline.md)。
真实 PostgreSQL Repository 测试与事务隔离见 [`docs/database-integration-testing.md`](./docs/database-integration-testing.md)。
OpenAPI 唯一事实源、服务路由和契约校验规则见 [`docs/08-api-and-integrations.md`](./docs/08-api-and-integrations.md)。

浏览器基线使用固定版本 Playwright/Chromium，并在独立端口启动生产构建，避免干扰本地开发服务：

```bash
pnpm test:e2e:install
pnpm test:e2e
```

`test:e2e` 会构建应用并运行桌面与移动端首页/API smoke；CI 在质量构建后使用
`pnpm test:e2e:ci` 复用构建产物。详情见 [`docs/18-testing-quality.md`](./docs/18-testing-quality.md)。

## 五、事实源优先级

发生冲突时按以下顺序处理：

1. 安全、隐私和法律约束。
2. 已接受的 `adr/*.md`。
3. `openapi/openapi.yaml`、Prisma Schema、JSON Schema 等机器可读契约。
4. `docs/` 中相应专题文档。
5. `tasks/BACKLOG.csv` 与阶段计划。
6. 示例代码和模拟数据。

任何改变关键技术边界、身份模型、支付账本或数据主权的改动，都必须新增 ADR，而不是直接修改实现。

## 六、当前验证状态

原始架构包静态验证详情见 [`VALIDATION_REPORT.md`](./VALIDATION_REPORT.md)；该报告保留交付时点，不代表当前动态工程状态。

截至 2026-07-28，本机已经真实完成依赖锁定、Prisma 生成/校验、格式、TypeScript、ESLint、
OpenAPI lint/生成漂移检查、单元/契约/真实 PostgreSQL 集成测试、数据库基线/升级验证、全部应用构建，
以及 Chromium 桌面/移动端首页与 API smoke。逐项命令、失败修复和未运行项见
[`tasks/WORKLOG.md`](./tasks/WORKLOG.md)。

GitHub Actions run `30186103447` 已在干净 Ubuntu 环境通过完整质量作业，并构建 Web、Admin、API、
Worker 四个镜像；四个 runtime 均确认以 `node` 用户启动并通过 readiness。PR #1 保留了两个真实失败
run 及其修复证据。项目负责人于 2026-07-25 明确授权公开仓库；`main` 随即启用必须经 PR、分支最新、
两项 required checks、解决 review conversation、管理员不可绕过、禁止强推/删除的保护。临时 PR #2
通过故意破坏内部链接产生真实失败 run `30187032798`，GitHub 报告合并状态 `BLOCKED`；测试 PR 和分支
随后已关闭/删除。绿色 PR #1 的两项 required checks 均通过。

Gate 0 最终 head run `30187153269` 通过后，PR #1 已按保护规则合并到 `main`（merge commit
`8590060`）。Gate 1 的 `AUTH-001` 随后通过 PR #3 / run `30187968381` 合并为 `89c7f8b`；
`AUTH-002` 通过 PR #4 / run `30188776254` 的完整质量、E2E 和四应用非 root 容器检查合并为
`22d9120`。`AUTH-003` 又通过 PR #5 / run `30384193833` 的完整质量、E2E 和四应用非 root 容器检查，
合并为 `9c66b87`。`API-004` 通过 PR #6 / run `30386104555` 合并为 `0af5f99`；`ORG-001` 通过
PR #7 / run `30388093140` 的完整质量和四应用非 root 镜像检查合并为 `ab09c81`；`TAX-001` 通过
PR #8 / run `30389838047` 合并为 `d622f74`；`TAX-002` 通过 PR #9 / run `30391936500` 合并为
`59218aa`，合并后 main run `30392308720` 亦通过。`MEDIA-001` 通过 PR #10 / run
`30393901014` 合并为 `aadddcf`；main run `30394324273` 的完整质量和四应用非 root 容器检查亦通过。
`ADMIN-001` 通过 PR #11 / run `30396556334` 合并为 `8058597`；`AUTH-005` 通过 PR #12 /
run `30398506529` 合并为 `f6d7242`，其 MFA tamper 测试稳定性修复又通过 PR #13 / run
`30401011927` 合并为 `ca506c8`。`AUTH-004` 已实现可选 scrypt 密码登录、通用防枚举失败、
账号/IP/设备限频与持久锁定、恢复冷却、只存哈希的单次 token、成功后全会话撤销和审计。真实
PostgreSQL 52 项、全仓 48 个文件共 179 项测试、8 个构建、运行时可观测性检查和 Chromium
桌面/移动 6/6 smoke 已通过，并由 PR #14 / final run `30402997906` 合并为 `b4d9474`。

当前 `EVT-001` 已完成 PostgreSQL Transactional Outbox 的原子 `SKIP LOCKED` claim、租约与指数退避、
BullMQ `eventId` 幂等 job、版本化有界 envelope、终态失败、优雅停机和 oldest-pending-age 指标；
第 13 个迁移、54 项真实 PostgreSQL 测试、全仓 51 个文件共 186 项测试、8 个构建、运行时可观测性、
架构检查及 Chromium 桌面/移动 6/6 smoke 已在本机通过。本机没有运行中的 Redis，因此唯一真实
BullMQ/Redis 集成测试明确跳过；PR #15 / final run `30404864972` 已使用托管 Redis service 强制执行并
通过该测试、完整质量门禁和四应用非 root 镜像检查，随后受保护合并为 `490efa4`。

`MEDIA-002` 已实现 owner 范围 `POST /media/{mediaId}/complete`、S3/MinIO HEAD 闭合、原子
SCANNING + Outbox，以及 Worker 的实际字节/hash/magic-byte 复核、ClamAV INSTREAM、Sharp
方向校正/去 EXIF/ICC、THUMBNAIL/CARD/FULL 三个确定性 WebP 变体和 lifecycleVersion 幂等
READY/REJECTED。第 14 个迁移已从全新空库部署，数据库 baseline 19 个负例、升级和 57 项真实
PostgreSQL 测试通过；全仓 55 个文件/203 项测试通过，本机 Redis/ClamAV 两项集成因服务不存在明确
跳过。PR #16 / run `30406971001` 已在真实 Redis/clamd 上通过 57 个文件/205 项测试，并通过完整
Linux 生产构建、运行时检查、Chromium 桌面/移动 smoke 和四个非 root 镜像。Windows 中等完整性进程
在 Admin standalone 最终复制阶段不能创建 symlink；本地编译、类型和静态页面生成已通过，该宿主限制
没有在 Linux 托管构建复现。真实短信/邮件提供商适配器仍保留到 `NOTIF-002`。

PR #16 的最终 head run `30407394217` 两项 required checks 均通过，随后受保护合并为
`d4abece`，Gate 1 实施主线完成。Backlog 中的 `ORG-002` 是 G1/P1，但显式依赖 Gate 2
`NOTIF-001`；该依赖及 `ORG-002` 已分别由 PR #24/#25 受保护合并。受限验证文件
`MEDIA-003` 属于 Gate 4，仍按 Gate 顺序延后。
`LIST-001` 已由 PR #17 / final run `30408759770` 通过两项 required checks，并受保护合并为
`c1709a7`。`LIST-002` 在此基础上提供真实 PostgreSQL public/owner/moderator 安全投影：公开内容在
查询层过滤状态、审核、期限、taxonomy 与主体；owner/organization member 和当前 scoped moderator
分别通过对象范围查询授权；动态 attributes 按精确历史 schema visibility 白名单过滤。PR #18 /
final run `30410107716` 通过两项 required checks，并受保护合并为 `a8db956`。

`LIST-003` 已在此基础上接入数据库草稿创建、owner/组织成员读取和条件更新：OpenAPI/运行时契约要求
actor-scoped `Idempotency-Key`、强 ETag/`If-Match`，Repository 以事务锁和 version predicate 关闭
创建/编辑竞态，并在成功事务中追加不含正文/PII 的 Audit 与 Outbox。15 个 migration 已从全新
`socal_list003_empty` 空库重放；baseline 22 个负例、previous-baseline upgrade、64 项真实
PostgreSQL 测试、全仓 61 个文件/226 项测试、8 个构建、运行时检查和 Chromium 6/6 smoke 本机通过。
本机无 Redis/ClamAV 的 2 项服务集成明确跳过；PR #19 / run `30412033239` 已用真实服务通过
Linux quality、浏览器和四镜像非 root 检查，final run `30412407859` 通过后受保护合并为
`c9a6db2`。

`LIST-004` 已提供 `/{locale}/post/rental/new` 的中文/英文响应式发布表单，按已发布 schema 白名单
渲染动态字段，以 900ms 防抖、actor 幂等键和强 ETag 完成服务端自动保存，并以 user + locale
隔离、250KB 严格解析的本地快照提供离线恢复。图片仅接受 JPEG/PNG/WebP，展示上传/扫描/拒绝/重试，
只有 owner 状态端点确认 READY 后才进入草稿。第 16 个迁移及 Repository 以 UUID 行锁、用途/类型/
状态/owner 检查和数据库约束原子绑定媒体；Web 同源 BFF 只允许该流程所需 method/path。全量本地
质量门禁通过 61 个文件/235 项测试、9 个 typecheck/lint、8 个构建；Chromium 桌面/移动 8/8 通过。

`MOD-001` 新增 owner/组织写角色限定的 `POST /listings/{listingId}/submit`，以强 ETag 和
actor-scoped 幂等键保护提交。`listing-submission` v1 对新账户、人工审核策略、发布期限、
外部联系方式和平台外付款进行确定性分层：低风险按历史期限自动发布，中/高风险创建审核案件，
高风险进入优先队列。Listing 状态、不可变 evaluation/rule hits、case、Audit 和 Outbox 在同一
PostgreSQL 事务提交，公开响应与日志不包含命中原文、阈值或联系信息。

`ADMIN-002` 已把中/高风险案件接入真实审核工作台：队列按风险优先级、创建时间和稳定 UUID 排序，
提供有界且与 actor/筛选条件绑定的签名 cursor；详情只读取提交时不可变快照、最小规则证据、媒体状态
和发布者聚合，不返回联系方式、精确坐标或请求哈希。审核员必须使用当前有效
MODERATOR/SENIOR_MODERATOR 角色与 MFA；批准、要求修改、拒绝和升级还要求十分钟内的 step-up、
强 Case ETag 和 actor-scoped 幂等键。Listing、Case、不可变动作、Audit 与 Outbox 在同一
PostgreSQL 事务写入；Admin BFF 仅开放这些精确 method/path。

`LIST-005` 已闭合首个 Rental 公共生命周期：公开列表只读取已批准、未过期、未删除且 taxonomy/
发布主体有效的 PostgreSQL 事实，返回不含正文、联系方式、精确坐标和内部审核字段的摘要；HMAC
cursor 绑定 `type/category/region` 并以 `publishedAt + id` 稳定分页。Owner/组织写角色使用强
Listing ETag 幂等归档或软删除，状态/版本/Audit/Outbox 原子提交。Worker 以有界批次和
`FOR UPDATE SKIP LOCKED` 将到期 Rental 转为 `EXPIRED`，重复轮询不重复写证据，并暴露低基数
轮询/过期/失败指标。搜索索引最终移除仍由 Gate 3 消费者负责。

`NOTIF-001` 已把 Listing 状态 Outbox 事件投影为账号私有的站内通知：Worker 对 envelope、事件类型、
聚合版本和最小 payload 严格校验，以 eventId advisory lock 和数据库唯一键保证至少一次投递下仅写一
条；中英文模板按稳定 key/locale/version 发布后不可修改，Notification 保存渲染快照而不保存正文或
联系方式。`GET /notifications` 使用绑定账号和未读筛选的 HMAC cursor，已读端点仅更新当前账号且可
安全重试。Web 提供中英文、移动端、noindex 的通知中心与同源精确 allowlist BFF；外部邮件/SMS、偏好、
退订和 provider 回执仍按边界留给 `NOTIF-002`。

`ORG-002` 已闭合组织成员生命周期：Owner/Admin 可创建三天内有效、邮箱规范化且同一组织/收件人仅一
条 pending 的邀请并撤销；被邀请账号只能接受自己的有效邀请，接受、角色变更和移除均以组织行锁、
成员版本 ETag 和事务内 Audit/Outbox 防止竞态与重复证据。可延迟约束触发器在每次事务提交前保证活动
组织至少一名 Owner；Owner 转移还要求当前 Owner、MFA-bound 会话和十分钟内 recent-auth，目标晋升
与原 Owner 降级原子提交。邀请通知只保存资源 ID/版本，正文不包含邮箱或组织私密资料。

`LIST-006` 已把已验证的 Rental 模式复用到 Job：招聘草稿使用独立中英文响应式入口，按历史表单
schema 校验雇主、用工形式、经验/远程方式、薪资范围/周期及就业政策确认；应用层和 Repository 都
拒绝 Job 缺少明细或其他垂类携带 Job 明细。提交风险规则 v3 只记录命中字段名并把疑似歧视性招聘内容
送人工审核，不复制命中文本。公开列表/详情继续过滤联系方式、精确位置和 OWNER_ONLY 政策字段，到期
Job 与 Rental 共用有界、并发安全且不重复写审计证据的 Worker。PR #26 已受保护 squash 合并，
`main` 最终 run `30443279395` 通过。

`LIST-007` 已将同一闭环扩展到 Transfer、Secondhand 和 Service：三类分别持久化一致的
`TransferDetail`、`SecondhandDetail` 和 `ServiceDetail`，并由应用层与 PostgreSQL 双层阻止类型错配、
无效价格、越界租期/服务半径和空交付/可用时间。转让始终进入人工审核且要求财务免责声明；二手要求
合法来源/禁售品确认，并由 v3 高置信规则把疑似禁售品送高优先人工审核；服务执照号仅 owner/审核可见，
公开资质状态明确为发布者声明。五类公共查询、签名 cursor、归档/删除和到期 Worker 现共享一致的
安全投影与幂等状态链；三类新增中英文 noindex 发布页复用 READY 图片、自动保存和幂等提交。

`MOD-002` 已闭合首个 Listing 举报、处置和申诉链：ACTIVE 用户通过同源、小时配额、actor-scoped
幂等键和活动目标唯一约束提交；并发重复只生成一份脱敏不可变快照和审核案件，公共/Admin 投影均不
泄露举报者。MFA moderator 使用签名队列 cursor、强 ETag、近期 step-up 和稳定原因处置；下架状态、
Action、Audit、Outbox 原子写入。Owner 可在 30 天内申诉一次，原审核员不能复核，独立审核员可维持
或恢复尚未到期内容，三个结果都通过版本化中英文站内模板通知。

`LIST-008` 已把 Listing 提交和已发布编辑纳入不可变版本历史：每次提交、重新提交及发布后编辑都保存
规范化脱敏快照、字段级 diff、actor、风险结果和原发布期限。Owner 可通过私有签名 cursor 查看稳定
原因；小型文字修正保留当前公开状态，价格、分类、区域、联系方式、媒体、位置、动态字段或风险信号
等重大改变必须重新进入审核并立即从公开读移除。审核通过只恢复原始发布/到期窗口，不因编辑免费续期；
仓储层使用行锁、强 ETag、actor-scoped 幂等证据和版本校验阻止重复或旧事件覆盖新版本。

`LIST-009` 已实现私有信息管理中心：`GET /me/listings` 按草稿、审核中、已发布、已归档四个稳定
bucket 返回当前账号及其当前组织成员可读的信息摘要、各 bucket 计数和签名 cursor；过期但尚未被
Worker 扫描的公开行在读取时归入已归档，避免用户中心显示失效信息。`POST /me/listings/actions`
接受最多 20 个唯一 Listing ID 与强版本，按输入顺序逐项归档或软删除并返回部分成功结果；跨 owner、
组织只读角色、已删除和未知对象统一为不泄露存在性的结果。中英双语移动页面默认 noindex/no-store，
提供类型筛选、批量选择、删除确认、部分失败反馈和草稿继续编辑，Web 仅经严格同源 BFF 调用 API。

`MOD-003` 已实现版本化 Listing 重复候选：同类型一年窗口内以 pg_trgm 文本、媒体 64-bit dHash 和
表单 schema 识别后的域分离联系方式 HMAC 召回最多 10 条候选。低阈值只保存 dry-run 证据，达到执行
阈值也只提升到人工审核，不自动定罪或删除。候选绑定精确 evaluation/Listing/阈值版本并由数据库禁止
修改删除，人工 confirmed/false-positive 结果一次写定；Admin 只显示最小候选摘要和信号，不暴露分值、
阈值、指纹或媒体对象 key，精确动作重试不重复误杀指标。

`WEB-004` 已实现共享账户中心壳与私有总览：`/[locale]/account`、信息管理和通知页复用单一内存
Session，全部读取 `no-store`，在可见状态下每 15 秒及 focus/pageshow/恢复可见/绝对到期时重新验证。
401、过期、异常或越界响应立即清空旧能力；权限不写入 Web Storage 或 URL。导航只呈现服务端返回且
当前已实现的信息、通知和发布入口，最终 API 仍逐请求授权。总览提供中英文、移动/桌面、受限账号、
guest、错误/重试、无组织状态和组织类型/角色本地化，并保持 noindex/no-store。

Gate 3 从 `SEARCH-001` 开始建立可执行的 OpenSearch 公共投影。v1 使用版本化物理索引和稳定读写
alias，严格 mapping 只允许双语文本、分类/地区、价格/属性、模糊公开 geo、公开发布者信号、推广标志
和内容版本；PII、精确地址、审核/风险字段及私有媒体标识明确排除。`pnpm search:index:ensure` 可重复
创建或校验该契约，索引 Worker、查询 API 和原子重建仍由后续 SEARCH 任务负责。

## 七、规划容量与服务目标

以下是首期设计目标，不是现有实测数据：10 万注册用户、50 万有效/历史信息、1 万 DAU、持续 100 RPS/峰值 500 RPS；公共 API p95 读取小于 300ms、写入小于 700ms；搜索更新 p95 60 秒内；公开服务可用性 99.9%；RPO 15 分钟、RTO 2 小时。

容量假设必须在 Beta 前使用压测和真实流量重新校准。
