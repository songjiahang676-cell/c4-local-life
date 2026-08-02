# 18. 测试与质量工程

## 18.1 测试策略

测试以风险为导向，不追求虚假的覆盖率数字。核心目标是保护领域不变式、权限、状态机、幂等、数据迁移、契约和关键用户旅程。

## 18.2 测试层级

| 层级                   | 范围                                         | 工具方向                          |
| ---------------------- | -------------------------------------------- | --------------------------------- |
| Unit                   | 纯规则、排序、价格、状态机、policy           | Vitest/Jest 等                    |
| Component              | UI 状态、表单、无障碍                        | Testing Library + axe             |
| Repository Integration | Prisma/SQL/PostGIS 真实行为                  | PostgreSQL 容器                   |
| API Integration        | Nest 模块、auth、validation、Problem Details | Fastify inject/supertest          |
| Contract               | OpenAPI 请求/响应与消费者                    | schema validator/generated client |
| Worker                 | 幂等、重试、乱序、DLQ                        | Redis + fake adapters             |
| E2E                    | 搜索、发布、审核、消息、支付测试模式         | Playwright                        |
| Performance            | 延迟、吞吐、耐久、积压                       | k6/等价                           |
| Security               | SAST、DAST、依赖、授权负面、上传/webhook     | CI + 专项测试                     |

## 18.3 必测领域不变式

- Listing 类型与 detail 匹配；非法状态转换失败。
- 过期/下架/删除内容不出现在公开 API/搜索。
- 重大编辑重新审核，旧事件不能覆盖新版本。
- 组织角色和对象所有权不可跨越。
- 会话仅参与者可读；屏蔽后不能发送。
- 评价资格、唯一性和编辑窗口。
- webhook 重复/乱序不产生重复账本或履约。
- 钱包条目不可变，余额与条目对账。
- 广告库存无超卖，暂停立即传播。
- 删除请求覆盖搜索、缓存和媒体清理任务。

`LIST-001` 的纯领域测试固定覆盖五类 type-detail 正例与错配、Job 薪资范围、Service 半径、
最小货币单位及 `FREE/NEGOTIABLE`、提交/升级/退回/重提、自动与人工审核边界、1–365 天发布期限、
提前过期、归档、暂停、软删除、非法转换、旧版本、倒退时间和非法原因码。外部重建的聚合快照也必须
经过同一 `assertListingInvariants`，避免 Repository 反序列化绕过规则。

`LIST-002` 的真实 PostgreSQL 集成矩阵固定验证三种安全投影。公开层覆盖 draft、未审核、过期、停用
taxonomy 和字段泄漏负例；owner 层覆盖直接 owner、organization member、外部用户及暂停成员；审核层
覆盖正确 scope、错误 scope、损坏 scope、撤销、到期、错误平台角色和普通用户。每层都序列化检查不含
邮箱、legal name、精确坐标或不属于当前 visibility 的 attributes；精确历史 schema 缺失时三层都必须
返回空 attributes，而不是原始 JSON。fixture 仅使用 `example.invalid` 与明确 synthetic 文本，并在
事务回滚隔离中运行。

`LIST-003` 增加三层写入测试。service/HTTP 层验证创建精确重试与 changed-payload 409、强 ETag、
缺失/旧 `If-Match`、guest/outsider/limited、个人 owner 与组织五角色、未知 attributes、非空 media
和 over-posting；真实 OpenAPI schema 验证 create/read/update 实际响应。PostgreSQL 层从全新空库
验证 15 个 migration、22 个约束负例、配对幂等证据、并发同 key 只创建一行，以及两个版本相同的
并发 PATCH 只成功一个；每次成功恰有一条 Audit 和一条 Outbox，序列化负例证明其中没有业务正文或
PII。并行集成测试只按稳定 seed ID 断言 taxonomy，避免其他隔离 fixture 造成全表计数抖动。

`LIST-004` 增加 READY 媒体绑定和浏览器发布测试。Repository 集成验证 owner READY 图片的稳定排序、
解绑、未扫描/跨 owner 拒绝且失败时 Listing 不创建、不递增版本；API/契约验证 owner 状态、统一 404、
无存储 metadata 泄漏和唯一 `mediaIds`。Web 单测覆盖双语校验、create/update payload、user + locale
恢复隔离和严格 BFF allowlist。Playwright 在 Desktop Chrome 与 Pixel 7 上用真实生产构建验证中文填写、
自动保存、刷新恢复、切换英文和无横向溢出，共 8 个 E2E case。

## 18.4 授权测试

为每个 resource/action 维护矩阵：Guest、owner、同组织各角色、无关用户、limited/suspended、后台正确/错误角色、跨组织、已删除状态。测试不仅看 403，还验证没有数据侧信道和部分批量泄漏。

## 18.5 契约测试

- OpenAPI 在 CI 解析、lint，示例响应验证。
- 实现响应通过 schema 验证；错误格式统一。
- 共享 Zod 契约与 OpenAPI 避免手工漂移，选择一个生成/同步方向并记录。
- 外部 provider 使用记录的官方 fixture/模拟 server，覆盖 timeout、429、5xx、签名失败和字段新增。

## 18.6 数据库迁移测试

- 从空库应用全部 migration。
- 从上一个发布快照升级，并运行旧/新应用兼容测试。
- 检查不可为空、唯一、外键和自定义 SQL 约束。
- 大回填在代表性数据上测时长、锁和可恢复。
- 回滚优先应用 roll-forward；若提供 down，必须验证不会丢失未备份数据。

## 18.7 E2E 核心场景

1. 访客搜索→登录→收藏→联系。
2. 用户创建草稿→上传→提交→运营批准→搜索可见。
3. 运营拒绝→用户修订→重新提交。
4. 发布者编辑重大字段→重新审核。
5. 消息屏蔽/举报。
6. 商家创建组织、邀请 Editor、购买推广（Stripe test）。
7. webhook 重放不重复履约。
8. 过期任务移除公开结果。
9. 账户删除请求和撤销/执行。
10. 中英文、移动宽度和键盘操作。

## 18.8 测试数据

- 使用 factories/fixtures 生成，不依赖生产数据。
- 时间、UUID、provider response 可控制。
- 测试区分 LA/Orange County、语言、角色和风险状态。
- 敏感示例使用明显虚构 `example.invalid`、555 号码等。
- 每个测试独立或明确事务清理，避免顺序依赖。

## 18.9 CI Gate

PR 必须通过静态检查、typecheck、lint、unit、contract、关键 integration 和 build。主分支/夜间运行完整 integration、E2E、扫描和迁移测试。发布候选运行 staging smoke、性能阈值和安全清单。

不得通过 `skip`, `only`, 降低阈值或关闭 strict 来绕过失败。Flaky test 必须有 owner、隔离标签和修复期限。

## 18.10 质量指标

关注 escaped defects、回滚率、变更失败率、MTTR、flaky rate、审核事故、权限漏洞和支付对账差异，而非单一代码覆盖率。核心领域分支可设较高覆盖要求，但测试可读性和行为价值优先。

## 18.11 Gate 0 测试基线

根目录 `vitest.config.ts` 将 Web、Admin、API、Worker、Config、Contracts、Database 和 UI
配置为八个具名 test project。DOM project 使用 jsdom 和 Testing Library；服务与纯 TypeScript
package 使用 Node 环境。常用命令：

```bash
pnpm test:unit
pnpm test
pnpm test:watch
```

`pnpm test` 同时生成 V8 coverage、`reports/test-results/junit.xml` 和
`reports/test-results/results.json`。报告是验证证据，不是通过降低断言质量来追求的覆盖率目标。
CI 在测试失败时仍上传报告；测试源码同时经过 `tsconfig.tests.json` 和 ESLint。

## 18.12 种子与测试工厂

`packages/database/src/testing/factories.ts` 只生成带随机 UUID、`example.invalid` 身份和明确 synthetic 文案的测试输入，默认 Listing 状态为 `DRAFT`。Repository 集成测试通过 `DATABASE_INTEGRATION_URL` 连接专用测试库；CI 在迁移完成后运行，测试自行清理其稳定 ID 范围。

`pnpm db:seed:validate` 是无数据库的种子契约检查。`seed-database.integration.test.ts` 在真实 PostgreSQL 中连续执行两次导入并验证无重复；不得用生产数据或生产数据库替换这些 fixture。

## 18.13 Repository 集成隔离

统一框架、数据库 URL 防误用规则、事务回滚示例和显式命令见 [`database-integration-testing.md`](./database-integration-testing.md)。每个测试必须通过同一个 `TransactionClient` 完成准备、Repository 调用和断言；成功与失败路径均由框架回滚。CI 设置 `DATABASE_INTEGRATION_URL`，因此不允许把 integration skip 当成 Gate 通过。

## 18.14 迁移兼容测试

数据库迁移另有 `db:migrate:safety` 静态破坏性 SQL 检查和 `db:upgrade:check` 上一兼容基线升级
检查。升级检查只接受明确的隔离数据库，创建并清理独立临时数据库，不读取生产快照或真实数据。

## 18.15 Gate 0 Playwright 基线

根目录 `playwright.config.ts` 用生产构建的 standalone Web 和编译后的 API 执行 smoke，不依赖开发服务器，
也不连接真实 PostgreSQL、Redis 或 OpenSearch。测试固定使用 `127.0.0.1:3100` 与
`127.0.0.1:4100`，不会复用或占用默认开发端口；Web/API 进程由 Playwright 启停。

当前基线同时运行 Desktop Chrome 与 Pixel 7 两个项目，验证：

- `/zh-Hans` 标题、搜索输入和语言入口可见，页面没有横向溢出；
- API health 返回可追踪 request ID；
- 运行时提供 canonical OpenAPI 文档；
- 非法请求返回无 stack trace 的 RFC 9457 Problem Details。
- 五类发布表单可在中文/英文与移动宽度完成自动保存、账号范围恢复和无横向溢出。

首次使用先安装与锁定依赖匹配的 Chromium。常用命令：

```bash
pnpm test:e2e:install
pnpm test:e2e
pnpm test:e2e:ci
```

`test:e2e` 先执行全仓构建；`test:e2e:ci` 只用于质量构建已完成的 CI job。standalone 构建不会自动携带
`public` 和 `.next/static`，因此两条路径都先运行 `scripts/prepare-standalone-runtime.mjs`。
HTML、JUnit、trace、截图和视频输出到被 Git 忽略的 `reports/e2e/`；CI 即使失败也上传报告。

## 18.16 MOD-001 验证增量

- 纯规则测试覆盖低/中/高风险、规则顺序、规则版本和无原文证据。
- HTTP/契约测试覆盖强 ETag、幂等重试/冲突、owner/组织对象授权、guest/受限/外部用户和
  `no-store` 安全响应。
- PostgreSQL 集成测试覆盖一次事务内的状态、evaluation/hits、case、Audit/Outbox，以及
  evaluation/hit 不可变触发器。
- 空库重放、上一发布基线升级和数据库负例必须识别提交审核表、唯一约束、状态一致性与触发器。

## 18.17 ADMIN-002 验证增量

- Policy/HTTP 测试覆盖 guest、PRIMARY、SUPPORT、MODERATOR/SENIOR_MODERATOR、过期 step-up、严格
  query、no-store、通用错误、ETag、action/reason 和幂等冲突。
- cursor 单元测试覆盖签名、actor/filter 绑定、篡改和跨范围重放；OpenAPI 运行时用实际 queue、
  detail、action 响应验证三个 schema。
- PostgreSQL 集成覆盖稳定分页、撤销角色立即失效、脱敏快照、批准原子状态、精确重试/冲突、
  单一 Action/Audit/Outbox，以及 snapshot/action 直接更新/删除失败。
- Admin DOM 测试覆盖脱敏证据、无 recent MFA 禁用动作、准确 concurrency/idempotency headers、
  J/K/方向键与 Alt+A；BFF 测试覆盖精确 allowlist 和 method confusion。
- 空库 baseline 要求 18 个 migration 和 31 个约束负例；upgrade 合成一条旧审核案件，证明新迁移
  自动生成不含动态 attributes/坐标的快照。

## 18.18 LIST-005 验证增量

- HTTP/契约测试覆盖安全 Rental 摘要、公开详情、稳定双字段分页、cursor 篡改/筛选绑定、缓存头、
  guest/受限/外部用户、强 ETag、归档和幂等软删除。
- PostgreSQL 集成测试覆盖公开状态/审核/期限/taxonomy/主体过滤，owner/组织写授权，archive/delete
  状态与版本，以及每次转换的单一 Audit/Outbox。
- 过期测试先执行到期批次再重复执行，要求第二次为零并保留一组 SYSTEM Audit/Outbox；Worker 单元
  测试验证批次/间隔配置、idle/expired 指标和无资源标识日志。
- 空库 baseline 要求 19 个 migration、31 个约束负例和过期部分索引；上一发布基线升级必须保留哨兵。

## 18.19 NOTIF-001 验证增量

- Worker 单元测试覆盖八类 Listing 状态事件、严格 envelope、风险分支、永久/瞬时错误、无 PII
  payload 和 created/duplicate/ignored/unavailable/failed 有界结果。
- PostgreSQL 集成使用两个独立 Repository 并发投递同一 eventId，要求恰好一条通知；同时覆盖双语、
  canonical owner、LOW/MEDIUM 规则、稳定分页、跨用户已读拒绝、重复已读和模板 UPDATE/DELETE 失败。
- HTTP/契约测试覆盖 guest/LIMITED、账号隔离、未读计数、签名 cursor 的账号/筛选绑定、篡改、未知/
  外部 404、CSRF origin、严格 query 和 no-store。
- Web DOM 与 production Playwright 覆盖登录门、畸形响应拒绝、已读状态、中英链接、noindex、桌面/
  移动无横向溢出和 BFF method/path confusion。
- 空库 baseline 要求 20 个 migration、16 条已发布双语模板和 33 个数据库负例；上一发布升级保留哨兵，
  全量架构检查要求 49 paths、113 schemas 和 51 models。

## 18.20 ORG-002 验证增量

- HTTP/契约测试覆盖 OWNER/ADMIN 与错误角色、邀请精确重试/冲突、跨用户接受、撤销、强成员 ETag、
  self/Owner 防删除、recent-MFA Owner 转移及普通 ACTIVE 用户 MFA enrollment。
- PostgreSQL 集成覆盖邀请/接受/到期、角色版本冲突、Audit/Outbox 最小证据、转移精确重试，以及直接
  删除最后 Owner 在 deferred constraint 提交点失败。
- Worker/通知集成覆盖严格邀请 envelope、永久/瞬时错误、重复 eventId 收敛、双语模板、当前用户列表
  与已读，同时断言不出现联系方式或组织私有名称。
- 空库和上一基线升级检查要求 21 个 migration、18 条已发布双语模板、邀请/转移表、membership 版本、
  PENDING 唯一索引和两个 Owner trigger；OpenAPI 规模同步为 57 paths、123 schemas。

## 18.21 LIST-006/LIST-007 垂直复用验证增量

- API/契约测试对五类 `GET /listings?type` 逐项接受，并拒绝非 Listing 类型；公开摘要与详情按历史
  schema 剔除 OWNER_ONLY、未知字段、联系方式和精确坐标。
- 应用单元测试覆盖五类价格单位、必填政策确认、Transfer 固定人工审核、Secondhand 禁售品高风险
  路由、Service 半径和低风险自动发布；命中证据只包含字段名，不包含命中原文。
- PostgreSQL 集成逐项验证 detail create/update、类型错配拒绝、三类新增 check、五个到期部分索引，
  以及五类到期批次重复执行不重复 Audit/Outbox。
- Web 单元和 production Playwright 覆盖五类账号/locale/vertical 隔离恢复、价格单位映射、READY
  媒体路径、中英文入口、桌面/移动无横向溢出，以及 Job/Transfer/Secondhand/Service 幂等提交。
- 空库 baseline 要求 23 个 migration、8 个 Listing 部分索引和 37 个数据库负例；上一发布基线升级
  必须保留哨兵并验证三个新增 detail 约束与五类到期索引。

## 18.22 MOD-002 验证增量

- 契约/HTTP 测试覆盖 Listing-only target、稳定原因、details 边界、同源、登录、幂等键、429、
  no-store opaque receipt、MFA/recent-MFA、强 Case ETag 和动作/原因耦合。
- Service 测试覆盖举报/申诉 deadline、签名 cursor 的 actor/queue/status 绑定、下架和恢复状态机，
  并明确拒绝原审核员处理申诉。
- PostgreSQL 集成以并发不同幂等键举报同一 target，要求一条活动 Report/Case/不可变脱敏快照；
  继续覆盖下架、30 天申诉、同审核员拒绝、独立审核员恢复、Listing 版本，以及每步唯一
  Action/Audit/Outbox/通知投影。
- 数据泄漏断言在公共 receipt、Admin detail、快照、Audit/Outbox 和通知中搜索 reporter identity、
  email、phone、contact/address 与原始私有 attributes。
- 空库 baseline 要求 24 个 migration、40 条已发布双语 Listing 模板、8 个举报/申诉 check 和 42 个
  数据库负例；上一发行版升级必须回填遗留 Report 的幂等证据并保留既有 Listing/审核哨兵。

## 18.23 LIST-008 修订与重大编辑验证增量

- 纯规则/API 测试覆盖发布后缺少幂等键、精确重试、强 ETag、文字 typo minor、价格/分类/区域/联系/
  位置/媒体/attributes/locale/risk major、跨 owner 404、签名分页 cursor 和响应敏感字段负断言。
- PostgreSQL 集成覆盖初次提交 revision、被要求修改后 resubmit diff、minor 保持公开及原期限、
  major 进入人工审核并从公共读移除、低风险提升、Case previous snapshot、owner-only 分页和并发重试。
- 数据库负例必须证明 revision UPDATE/DELETE 均被不可变触发器阻止，并验证版本/哈希/风险/actor/
  publication-window check；baseline/upgrade 同时要求表、索引、触发器和旧数据 sentinel 存活。
- 审核测试使用 previous revision 生成真实 diff；批准重大编辑保留原 `published_at/expires_at`，
  审批时已到期则直接 EXPIRED，陈旧 Case/Listing version 不能覆盖较新修订或产生免费续期。
- OpenAPI/生成类型/HTTP 测试覆盖 owner revision collection、`ListingOwnerView.latestRevision`、
  `no-store`、Problem Details 和 BFF 精确 allowlist；全量质量门禁继续运行格式、类型、lint、单元/
  集成、生产构建、运行时和 Chromium 桌面/移动回归。

## 18.24 LIST-009 用户中心管理验证增量

- 契约测试覆盖四 bucket、type/organization filter、limit/cursor coercion、未知字段拒绝、1–20 项、
  UUID/版本边界和重复 Listing ID 拒绝；OpenAPI response/Problem Details 与生成类型保持同步。
- Service/HTTP 测试覆盖账号隔离、组织读取角色、只读组织成员批量写的通用 NOT_FOUND、受限账号只读/
  禁止写、expiry-aware bucket、签名 cursor 篡改、部分成功顺序、版本/状态冲突和删除精确重试不重复
  Audit/Outbox。
- PostgreSQL 集成覆盖个人与组织 Listing、四状态和过期映射、计数/过滤/稳定分页以及摘要敏感字段
  负断言，并验证既有 owner/organization 状态索引足够，不为 UI 新增事实表。
- Web 单元测试覆盖 guest、正常列表与部分批量失败；BFF 测试锁定两个精确 method/path。
  Chromium 桌面/移动生产回归覆盖英文未登录边界、no-store/noindex、登录入口和无横向溢出。

## 18.25 MOD-003 重复检测验证增量

- 纯函数测试覆盖 PHONE/EMAIL 规范化、domain-separated 指纹去重、候选/执行阈值边界、三种信号、
  多信号置信度、NaN/越界分值收敛和 dry-run 不提升风险。
- Worker 测试验证相同规范化像素生成稳定 16 位小写 dHash，READY 写入携带 hash，失败/旧生命周期
  不能完成；Repository 测试验证非法 hash 和软删除状态约束。
- 真实 PostgreSQL 测试覆盖同类型一年窗口、文本 pg_trgm、联系方式精确指纹、图片 Hamming 距离、
  最多 10 条排序、原始 PII 不持久化、候选与联系方式在提交事务内写入，以及候选证据/人工结果的
  UPDATE/DELETE 篡改负例。
- API/契约/Admin 测试验证 ENFORCE 提升到人工审核、DRY_RUN 不改变低风险决定、详情只暴露最小候选
  字段、`DUPLICATE_CONTENT` 原因耦合、中英界面与数值/指纹/object-key 不泄漏。
- 可观测性测试只接受 confirmed/false_positive 固定标签，并验证首次人工复核按候选数计数、精确
  动作重试不计数。空库、上一发布升级、完整质量、运行时、生产 Chromium 和托管真实服务门禁仍必须
  全部执行并如实记录。

## 18.26 WEB-004 账户壳验证增量

- 解析器单测覆盖有效 Session、重复/非法 capability、未知平台角色、越界组织和过期响应的失败关闭。
- 组件测试证明账户总览、Listing 管理和通知中心共享一次 no-store Session 读取；能力缺失不显示入口，
  focus 后 401 清空导航，网络失败有显式重试且不保留旧权限。
- 生产 Chromium 桌面/移动验证 `/en-US/account` 的 capability 导航、组织枚举本地化、
  noindex/no-store 和无横向溢出，并回归子页 guest 与双语通知路径。
- 全仓格式、类型、lint、单元/集成、八应用构建、运行时、架构语义和托管真实服务/四镜像门禁继续执行；
  本任务不修改 OpenAPI、Prisma 或 migration。

## 18.27 SEARCH-001 索引契约验证增量

- 单元测试锁定 v1 物理名和读写 alias、非法 prefix、strict mapping、双语/CJK/英文/前缀 analyzer、
  `geo_point`、写 alias 和 PII/审核字段负断言。
- Manager 测试覆盖首次创建、重复启动、mapping version 漂移和 write-alias 漂移；漂移必须抛出稳定
  `LISTING_INDEX_CONTRACT_MISMATCH`，不得就地覆盖。
- 托管 CI 启动 OpenSearch 2.19.5 真实节点；集成测试实际创建随机命名索引、运行中英文 `_analyze`、
  经 write alias 写入、经 read alias 执行中文+geo 查询，并证明 strict mapping 拒绝额外电话字段。
- Runtime config 测试覆盖 index prefix 边界和用户名/SecretValue 密码成对要求；Workflow checker
  锁定版本化 OpenSearch service、cluster health 和 integration URL，避免 CI 静默跳过。
- 全仓格式、类型、lint、单元/集成、八应用构建、运行时、架构和四镜像门禁继续执行；本任务不修改
  OpenAPI、Prisma 或 migration。

## 18.28 SEARCH-002 索引 Worker 验证增量

- 单元测试覆盖严格 envelope、canonical 较新版本重载、整数金额、primitive PUBLIC attributes、
  紧急删除、失败/时效指标、对账 cursor 与 provider 错误脱敏。
- BullMQ 测试证明下架 priority 1、普通事件 priority 10；真实 PostgreSQL 测试证明 Outbox 领取优先、
  历史 PUBLIC 字段白名单、taxonomy path/alias、非公开删除状态和 EXACT 坐标不进入投影。
- 真实 OpenSearch 测试在 read/write alias 上验证 external version：v2 写入后 v1 写/删均 stale，
  v3 删除成功且读 alias 不再返回。
- 托管质量门必须同时提供 PostgreSQL、Redis、ClamAV、OpenSearch，执行完整 test/build、Linux
  Chromium 和四个非 root 镜像；本任务不修改 OpenAPI、Prisma 或 migration。

## 18.29 SEARCH-003 公共查询验证增量

- 契约测试覆盖 NFKC、控制/双向字符、成对 geo、距离排序、decimal price、倒置范围、50 条 limit、
  2048 cursor、unknown key 和独立最小 Search response；生成类型与 OpenAPI 无漂移。
- Service 单测证明一次 PIT 跨页复用、固定 snapshotAt、`limit + 1`、稳定 search_after、终页关闭，
  以及 cursor 篡改、跨 query/filter/limit 重放和过期在访问 backend 前失败。
- Adapter 单测锁定公开 `_source`、固定 bool/filter/facets、geo/price minor-unit 查询、无脚本，并对
  partial shard、timeout、malformed/PII 投影 fail closed；HTTP 测试覆盖 400/410/503/504 Problem
  Details、no-store 和敏感字段负断言。
- 托管 CI 的真实 OpenSearch 测试创建随机严格索引，经 read/write alias 执行文本、geo、facets、
  PIT + search_after；第一页后新增文档不得进入既有 PIT，三条快照结果不重复/漏页。无本地节点时
  明确 skip，不能把 skip 声称为通过。
- metrics 测试只接受固定 outcome/sort/geo，禁止 query、cursor、PIT 或资源标识。全仓格式、类型、
  lint、测试、八应用构建、运行时、生产 Chromium 和四镜像门禁继续执行。

## 18.30 SEARCH-004 发现与隐私验证增量

- 契约测试覆盖空 q、安全 normalization、region/locale/window/limit、unknown key、strict 响应、无 count、
  缓存头和 400/503 Problem Details。
- 单元测试覆盖 locale/region 同义词 scope、最多八词、canonical correction、cursor 词典版本固定、
  bot/PII/阻止词拒绝、IP HMAC 来源、User-Agent 轮换不增源、空查询 taxonomy 和敏感二次筛查。
- PostgreSQL 集成测试覆盖草稿并发、双人发布、发布不可变、追加回滚、每日 source 去重、五来源硬阈值、
  literal prefix、30–90 天保留约束和有界过期删除；低于阈值即使调用方传 1 也不得返回。
- 真实 OpenSearch 测试证明审核扩展可命中且不改变索引事实源；CI 继续运行 fresh baseline、upgrade、
  全量质量、Linux Chromium 和四镜像。没有本地服务时必须明确 skip，不能声称通过。

## 18.31 WEB-001 公共页面验证增量

- Contracts 单测覆盖公开 list/detail/search/taxonomy 的严格运行时响应、PUBLISHED 常量、分页 cursor
  一致性、Owner 字段/未知键拒绝、递归 taxonomy 和 Search attributes 上限。
- Web 单测覆盖 NFKC/decimal/倒置价格/重复参数、匿名 header、SSR bot 采样排除、Search 查询参数、
  503 简单首屏降级、复杂筛选失败、两类 cursor 不混用、Owner 投影失败关闭、稳定路由/货币/属性输出。
- 组件测试覆盖中英文筛选、原生 label、有效/推广/验证文字、诚实空态、详情安全提示、用户
  `<script>` 文本转义和嵌套属性不展示。
- Playwright 使用独立、纯虚构、无网络依赖的公共 API fixture，生产 standalone Web 在桌面/Pixel 7
  验证 SSR HTML、搜索 noindex、筛选值、列表/详情、推广/验证、无效价格恢复和无横向溢出；fixture
  只在 E2E 进程存在，不进入应用、seed 或生产数据路径。
- 全仓格式、类型、lint、单元/集成、八应用构建、API 运行时、架构和四镜像保护门禁继续执行。本任务
  不修改 OpenAPI、Prisma 或 migration；真实 OpenSearch 查询回归继续由既有 SEARCH 测试承担。

## 18.32 TAX-003 首页布局验证增量

- Contracts/JSON Schema 拒绝未知模块、未知 source 字段、任意 HTML 和未披露广告，并验证 slot key 唯一；
  架构检查器还会用 Draft 2020-12 schema 验证实际首页 seed，防止两份契约静默漂移。
- Service 单元测试覆盖新 scope 草稿、乐观冲突、发布、历史回滚、规范化 hash 和无正文 Outbox 契约。
- PostgreSQL 集成测试覆盖原子发布/回滚、当前版本切换、事件唯一性和直接 UPDATE/DELETE 已发布版本
  的数据库负例；种子测试覆盖中英文结构且不含真实/伪造业务内容。
- Prisma validate/generate、迁移安全、全仓质量、API runtime、架构检查和受保护 CI 均须真实通过；本地
  缺少 PostgreSQL 时明确记录 skip，不能把 skip 当作通过。

## 18.33 SEO-001 元数据与爬虫验证增量

- Web 单元测试覆盖可信 public origin 规范化、控制/双向字符和 HTML-like 标签清洗、code-point
  限长、城市 allowlist 正常/非法失败关闭，以及首页、频道、城市、详情、搜索和私有模板矩阵。
- 详情测试使用 strict 虚构公共 Listing 响应，断言 title/summary/发布时间可进入 meta，正文和
  `<script>` 不进入；旧 city/title 路径的 canonical/hreflang 必须使用 API 返回的规范投影。
- production standalone Playwright 在桌面和 Pixel 7 实际读取最终 HTML head，验证绝对 canonical、
  `zh-Hans`/`en-US`/`x-default`、noindex 筛选、allowlisted 城市、article Open Graph、Twitter card
  及 Web/Admin robots.txt；不能只断言 Metadata 对象。
- 本任务不修改 OpenAPI、Prisma 或 migration。结构化数据/sitemap 测试由 `SEO-002` 负责；全仓
  格式、类型、lint、单元/集成、八应用构建、API runtime、架构和四镜像保护门禁继续执行。

## 18.34 PERF-001 缓存与性能预算验证增量

- Contracts/单元测试覆盖三维 cache key 编码、strict scope/大小/TTL、0 TTL/partial 不缓存、损坏删除、
  Redis 失败回源、并发 miss 合并和固定低基数 outcome；CI 使用真实 Redis 验证 expiry/poison cleanup。
- HTTP/OpenAPI 测试覆盖完整首页短效共享 header、partial/错误 no-store，以及 Web Vital 202、
  unknown/URL/越界 400、短期 HMAC 限频和无地址/错误文本指标。
- Web 测试覆盖完整聚合最长 30 秒缓存、partial 不缓存、请求合并、固定 route 分类、采样丢弃和
  `credentials=omit` 无 URL/标识 payload。
- `performance:check` 在生产 build 后限制最大/全部 gzip JS chunks；standalone Playwright 在桌面和
  Pixel 7 分别限制首页 HTML/脚本传输，并继续运行所有既有交互/SEO 场景。

## 18.35 SEO-002 结构化数据与 Sitemap 验证增量

- Web 单元测试用两页 strict canonical Listing fixture 验证 cursor 遍历、UUID 去重、未来/过期剔除、
  locale/vertical/month 路径、双语 alternate、真实月份 index `lastmod` 和 allowlisted active 城市；
  源记录预算故意压到 1 时必须 503/失败关闭而非截断。
- XML serializer 测试拒绝跨 origin URL，并断言搜索 query、账户、过期资源和评分不进入输出。route
  测试覆盖 index、静态/Listing 子分片、Content-Type、安全/计数 header 和非法 locale/resource 404。
- schema.org 测试验证 exact-key `WebSite/SearchAction`、`BreadcrumbList`、当前 Job `JobPosting`，
  额外评分字段、已过期或错误垂类失败关闭；恶意 HTML-like 文本不能突破 JSON-LD script 序列化。
- production standalone Chromium 实际解析首页/详情 JSON-LD、robots sitemap 声明、index 与真实
  静态/Listing XML；不只调用 builder。既有桌面/移动、HTML/JS 预算和私有 noindex 场景必须继续通过。
- 本任务不修改 OpenAPI、Prisma 或 migration；全仓格式、生成契约、类型、lint、单元/真实服务集成、
  八应用构建、API runtime、架构和四镜像保护门禁继续执行。
- 本任务不修改 Prisma 或 migration；本地无 Redis 时集成测试明确 skip，受保护 CI 必须提供真实
  Redis、全量测试、API runtime、Linux Chromium 和四个非 root 镜像后才可完成。

## 18.36 SEO-004 可访问性验证增量

- `@axe-core/playwright` 是根工作区固定直接依赖；`test:a11y` 构建生产应用后执行，
  `test:a11y:ci` 复用 CI 构建。不得禁用规则、排除失败节点或把 incomplete 当作通过。
- Desktop Chrome 与 Pixel 7 覆盖首页、列表/筛选、详情、发布初始/错误、私有账户和 Admin 登录；
  每次扫描 WCAG 2.0/2.1/2.2 A/AA 标签，输出具体 rule 和 selector 以便修复。
- 键盘测试从页面第一次 Tab 开始，验证本地化 skip link、可见焦点和 Enter 后主内容焦点；表单测试
  验证 alert、首错焦点、`aria-invalid`/`aria-describedby` 及错误目标尺寸。
- 320 CSS px、forced colors、reduced motion 与横向溢出自动回归；人工 200% browser zoom 和至少一种
  主流屏幕阅读器必须留下工具/版本/路径/播报结果，axe 或 accessibility tree 不能替代。
- 全仓质量、既有 production E2E、受保护真实服务与四镜像仍必须通过。完整矩阵和缺口 ID 见
  [`accessibility-baseline.md`](./accessibility-baseline.md)。

## 18.37 EVT-002 队列恢复验证增量

- Repository 真实 PostgreSQL 测试覆盖失败证据分页、精确幂等/变更冲突、目标状态、短租约恢复、逐项
  一次写定、批次聚合与 Audit；空库 baseline 还验证 hash、计数、lifecycle 和唯一约束负例。
- API/Contracts 测试覆盖四个 OpenAPI 路径、严格 DTO、guest/普通账号/auditor/stale-MFA/admin 矩阵、
  actor/filter cursor 篡改、无效目标、409 retry conflict 和只返回聚合 job 状态。
- Worker 单元测试覆盖 terminal 判定、非法 envelope、失败证据脱敏、Outbox 恢复、BullMQ retry、
  canonical mismatch、重复 item、dry-run 与 repair reconciliation；正常关闭等待在途 DLQ 写入。
- Admin 测试覆盖双语、筛选提交、选择/确认、recent-MFA 禁用和 dry-run 默认；完整质量、真实 PostgreSQL/
  Redis、API runtime、Linux Chromium 与四镜像受保护门禁全绿后方可标记完成。

## 18.38 SEARCH-005 重建与回滚验证增量

- Repository 真实 PostgreSQL 测试覆盖 actor/type/key 并发幂等、并行 operation 拒绝、Search/Queue job
  领取隔离、短租约 phase 恢复、source/target 双写目标、切换/回滚完成和四类 Audit 证据；baseline/
  upgrade 检查新表、唯一索引、phase/name/hash/window 约束和旧数据保留。
- API/Contracts 测试覆盖三条 OpenAPI 路径、严格 DTO、guest/primary/stale/auditor/admin 权限矩阵、同键
  变更、并发重建、窗口外回滚、exact retry 和响应 PII/cursor/hash 最小化。
- Worker 单元测试覆盖候选名称、回填到追赶、逐版本 mismatch 失败关闭、原子切换参数、临时依赖重试及
  alias + candidate/rollback 多目标写入。真实 OpenSearch 测试创建随机候选，证明无 alias、版本枚举、
  read/write 一次切换和旧 source 回滚；完整托管门禁不得静默跳过 PostgreSQL/OpenSearch。

## 18.39 SEARCH-006 相关性与 Dashboard 验证增量

- JSON Schema 与 strict runtime parser 验证 8 条纯合成文档、16 条平衡中英 query、judgment 文档引用、
  1–3 grade、唯一 ID、门槛和 contact/control/bidi 负例；禁止生产、用户或抓取数据进入 fixture。
- 公式单测覆盖 ideal ranking、graded gain 倒序、全零结果、缺失/重复 query run、重复/未知文档；报告
  同时包含 overall 与 zh-Hans/en-US 的 NDCG@10、MRR、Recall@10、零结果率，并对每个 scope 判门槛。
- 托管 CI 在随机严格索引中使用生产 v1 analyzer/mapping、公开 query adapter 与同一数据集产生排名；
  没有 `OPENSEARCH_INTEGRATION_URL` 时只明确 skip，不能把 ideal-run 单测当作真实相关性通过。
- Dashboard contract 测试锁定零结果、样本量、route p95、timeout/unavailable、freshness 和 recovery
  面板，只允许已发出的 metric 与固定标签。locale 指标只允许两值，query/cursor/PIT/资源 ID/筛选/
  坐标/金额/provider detail 不进入指标；离线分数不得导出为生产时序。
- OpenAPI、Prisma 和 migration 保持不变；完整质量、API runtime、Linux Chromium、真实服务和四个
  non-root 镜像受保护门禁继续执行。生产 Dashboard provisioning、cluster exporter 和告警归 OBS-002。
