# 南加生活网完整网站架构书

> 本文件由 `scripts/generate-architecture-book.py` 从 `docs/00-*.md` 至 `docs/30-*.md` 合并生成。分章节文件是维护事实源。


---

<!-- source: docs\00-executive-summary.md -->

# 00. 执行摘要

## 0.1 产品定位

南加生活网是面向洛杉矶及南加州华人社区的双语本地生活平台。它不是单一“分类广告站”，而是以可信本地身份、城市与行业分类为骨架，把信息发布、搜索发现、站内沟通、商家/师傅信誉和本地商业化连接起来。

首期必须先建立高频且可形成供需闭环的五个垂直：招聘、租房、店铺/生意转让、二手、本地服务。问答、论坛、活动与跨境货源保留在信息架构和扩展模型中，但不阻塞 MVP 上线。

## 0.2 成功标准

产品成功不等同于“页面像设想图”。首期需要同时达到：

- 发布者能在移动端 3–5 分钟内完成一条合规信息；
- 访客能按城市、分类、价格和关键词快速找到有效信息；
- 联系行为受到隐私、频控与反诈骗保护；
- 运营团队能审核、下架、封禁、处理举报并追溯动作；
- 付费置顶、广告和套餐具备订单、支付、履约、退款和账本证据；
- 搜索引擎能抓取高质量城市/分类/详情页，而低质量、过期和重复内容不污染索引；
- 系统在单区域故障、任务重复、第三方超时和部分依赖不可用时可控降级。

## 0.3 范围切片

### MVP（上线必需）

身份与会话、区域/分类、五类信息、媒体、审核、列表/详情、搜索、收藏、消息、举报、商家/师傅基础档案、管理后台、通知、SEO、基础分析、置顶/刷新与 Stripe 支付。

### Phase 2

评价体系、商家优惠、订阅套餐、积分钱包、活动、问答、论坛、自动推荐、供应商目录。

### Phase 3

原生移动应用、跨境采购工作流、智能匹配、更多城市/州、数据产品和成熟广告竞价。

## 0.4 架构摘要

采用 Monorepo + 模块化单体，以降低首期分布式复杂度，同时保留拆分路径：

- `web`：公开站点，SSR/ISR、SEO、双语和响应式页面。
- `admin`：运营、审核、客服、广告、财务和配置后台。
- `api`：同步业务能力和外部 API。
- `worker`：搜索同步、媒体处理、通知、过期、对账等任务。
- PostgreSQL/PostGIS：唯一业务事实源。
- OpenSearch：全文、筛选、排序和地理搜索读模型。
- Redis/BullMQ：缓存、限流和异步队列。
- S3：原始文件与派生媒体。
- Outbox：数据库事务与异步事件之间的可靠桥梁。

只有在模块出现独立扩缩容、独立发布、隔离故障或团队所有权的真实压力后才拆服务。

## 0.5 关键质量目标

以下为设计目标，需在 Beta 前重新压测：

| 项目                 | 目标                   |
| -------------------- | ---------------------- |
| 公开服务月可用性     | 99.9%                  |
| API 读 p95           | < 300ms（不含第三方）  |
| API 写 p95           | < 700ms                |
| 搜索查询 p95         | < 450ms                |
| 搜索索引新鲜度 p95   | < 60s                  |
| 首页关键内容 LCP p75 | < 2.5s                 |
| RPO / RTO            | 15 分钟 / 2 小时       |
| 核心支付/账本        | 不丢失、可重放、可审计 |
| 无障碍               | WCAG 2.2 AA 目标       |

## 0.6 主要风险

最大的风险不是流量，而是内容质量、诈骗、虚假身份、重复信息、联系方式滥用、支付履约争议、运营能力不足和 SEO 被低质内容拖累。架构从第一天就包含审核状态、风控信号、举报、审计、数据保留、隐私展示与后台工作台，不能在上线后补做。

## 0.7 一页交付路径

1. 先让仓库、数据库、CI、身份和基础配置可重复。
2. 完成一类信息的端到端垂直切片，再推广到五类。
3. 建立搜索同步与 SEO 页面，不让 OpenSearch参与主写入。
4. 增加消息、收藏、商家/师傅和信任机制。
5. 最后接入商业化，支付前先完成账本与幂等。
6. 使用灰度城市和受控发布者进行 Beta；以运营负荷、诈骗率、搜索成功率作为上线门槛。

---

<!-- source: docs\01-assumptions-and-decisions.md -->

# 01. 假设、约束与决策

## 1.1 已知输入

- 产品名称暂定“南加生活网”，参考域名/品牌在设想图中为 SoCalCHINESE.com。
- 首发市场是洛杉矶及南加州，主要用户为中文用户，同时支持英语。
- 首页需要覆盖招聘、租房、转让、二手、师傅、商家、优惠、问答、论坛、活动、国内货源等入口。
- 页面存在快速发布、热门搜索、置顶信息、城市入口、价格行情、行业专区、广告、商家/师傅推荐、积分充值和多角色后台入口。
- 用户希望把完整文件夹直接交给 Codex 实施，因此文档必须自包含、可执行并有明确顺序。

## 1.2 规划假设

这些是假设，不应被误读为已有业务数据：

| 假设          |                           基线 | 复核时间           |
| ------------- | -----------------------------: | ------------------ |
| 首年注册用户  |                        100,000 | Beta 前和每季度    |
| 有效+历史信息 |                        500,000 | 数据容量测试前     |
| 日活          |                         10,000 | 公测后             |
| 持续/峰值请求 |                  100 / 500 RPS | 压测与真实流量     |
| 首发语言      |                 简体中文、英语 | 内容运营准备时     |
| 时区          |            America/Los_Angeles | 不变，用户可覆盖   |
| 货币          |                            USD | 扩区时复核         |
| 年龄门槛      |                  18+ 发布/交易 | 法律审查后确认     |
| 生产云        |                   AWS 单主区域 | 成本与团队能力复核 |
| 商业化启用    | 公开上线后 12 个月保持全站免费 | 首个周年日前 90 天 |

## 1.3 核心约束

- 团队规模和需求仍在形成期，不能以微服务制造运营负担。
- 本地信息具有高变动、强地域、重复发布和欺诈风险。
- 公开页面需要 SEO，同时登录后交互需要较强实时性。
- 中英文搜索不能只靠简单包含匹配。
- 联系方式、地址和身份材料属于敏感信息。
- 广告与置顶属于付费履约，必须可以证明展示和退款依据。
- 社区内容和跨境货源可能带来额外法律/审核负担，必须分阶段启用。

## 1.4 已接受的架构决策

| 决策     | 结论                                                           | 记录     |
| -------- | -------------------------------------------------------------- | -------- |
| 服务形态 | 模块化单体 + 独立 Worker                                       | ADR-0001 |
| 搜索     | PostgreSQL 主数据 + OpenSearch 读模型                          | ADR-0002 |
| API      | REST-first + OpenAPI 3.1                                       | ADR-0003 |
| 可靠事件 | Transactional Outbox + 至少一次投递                            | ADR-0004 |
| 生产部署 | AWS 托管服务 + ECS Fargate                                     | ADR-0005 |
| 收费节奏 | 首个公开运营年度免费；后续收费和自动充值均由 Feature Flag 控制 | ADR-0006 |

## 1.5 有意推迟的决策

- 第三方身份供应商：首期可自建会话并通过适配器接短信/邮件；生产前根据预算选择。
- 短信供应商：Twilio、AWS SNS 或其他，接口统一。
- 邮件供应商：本地 Mailpit，生产倾向 SES；由适配器隔离。
- 内容审核模型供应商：先规则+人工，后续可接图像/文本模型。
- 分析平台：首期定义事件契约，可从仓库/OTel 落地到选定平台。
- 原生 App：Phase 3；API 和会话设计须避免 Web-only 死路。
- 广告竞价：首期固定库存和排期，不做实时竞价。

## 1.6 决策原则

1. 先保证内容可信、可运营和可恢复，再追求功能数量。
2. 主链路同步最短化；可重试的副作用异步化。
3. 核心数据只保留一个事实源；所有读模型均可重建。
4. 对外契约先于实现，安全和审计先于商业化。
5. 优先选团队能稳定运营的技术，而非最炫技术。
6. 新抽象必须至少解决两个已存在场景，不为假想复用设计框架。

## 1.7 需要产品/法律确认的清单

- 品牌、域名、商标和旧站数据的权属。
- 允许发布的工作、住房、服务、二手和跨境商品类别。
- 公平住房、就业歧视、执照服务、食品/保健、移民/法律服务的审核规则。
- 用户年龄、隐私政策、服务条款、退款和广告政策。
- 是否允许现金/线下交易撮合，以及平台责任边界。
- 商家和师傅验证所需材料及保存期限。
- 评论/论坛上线前的社区规范和申诉 SLA。
- 加州隐私义务、营销短信/邮件同意和儿童用户处理方式。

上述项目未确认时，相关功能必须使用 Feature Flag 保持关闭。

---

<!-- source: docs\02-product-requirements.md -->

# 02. 产品需求与范围

## 2.1 产品使命

让南加州华人能够在一个可信、双语、移动友好的平台中找到本地工作、住房、商品、服务和商家，并让发布者以低摩擦方式获得有效联系。

## 2.2 主要角色

| 角色                  | 核心需求                                             |
| --------------------- | ---------------------------------------------------- |
| 访客/求职者/租客/买家 | 快速搜索、筛选、辨别新鲜度和可信度、收藏、联系       |
| 个人发布者            | 快速创建、预览、提交、编辑、刷新、查看效果、处理咨询 |
| 招聘方/房东/店主      | 组织身份、多人协作、批量管理、套餐与数据             |
| 商家                  | 商家页、营业信息、优惠、评价、广告和线索             |
| 本地师傅/服务商       | 服务范围、资质、报价、评价、可用时间和线索           |
| 运营审核员            | 队列、证据、规则命中、处置、申诉、审计               |
| 客服/财务/广告运营    | 用户支持、订单退款、对账、广告排期和报告             |
| 平台管理员            | 配置、权限、分类、城市、风控规则和系统健康           |

## 2.3 MVP 功能需求

### 身份与账户

- 邮箱或手机号 OTP 注册/登录；支持密码作为可选补充。
- 安全会话、设备列表、注销全部设备、账户状态和个人资料。
- 组织创建、成员邀请、Owner/Admin/Editor/Billing/Analyst 角色。
- 管理员账号与普通账号隔离权限，后台强制 MFA。

### 区域与分类

- 国家/州/县/城市/社区/邮编层级。
- 首期种子覆盖 Los Angeles County、Orange County 及主要华人城市。
- 分类树支持中文/英文名称、图标、排序、表单模板、SEO 元数据和启停。

### 分类信息

- 类型：招聘、租房、转让、二手、服务。
- 公共字段：标题、摘要、正文、价格、货币、价格单位、城市、分类、媒体、联系偏好、有效期。
- 每种类型具有结构化扩展字段，来自 JSON Schema 并落到强类型 detail 表或受控 attributes。
- 草稿自动保存、预览、提交、审核、发布、编辑、续期、归档、删除。
- 版本控制避免并发覆盖；重大编辑重新审核。

### 搜索与发现

- 关键词、城市、半径、分类、价格、发布时间、特性筛选。
- 中文、英文、拼音/常见别名同义词和 typo 容忍。
- 默认按相关性、质量、新鲜度、距离、可信度综合排序；付费提升必须明确标识。
- 热门搜索、城市页、分类页、最新信息和精选信息。

### 互动

- 收藏、最近浏览（经同意）、分享。
- 与信息发布者建立站内会话；垃圾消息限频、屏蔽和举报。
- 电话/邮箱不默认暴露给爬虫；按发布者策略和用户状态受控展示。
- 站内、邮件、短信通知偏好。

### 商家与师傅

- 组织商家页、地址/营业时间/联系方式、分类、城市、验证状态。
- 师傅服务范围、服务分类、执照/保险状态、简介和可用性。
- MVP 可先展示运营精选；评价写入能力在 Gate 4 完成。

### 审核与后台

- 文本、链接、手机号、重复、频率、设备/IP、图片风险的自动规则。
- 审核工作台、举报队列、用户/组织限制、信息下架、证据和内部备注。
- 所有敏感后台动作进入不可篡改审计日志。

### 商业化

- SKU：刷新、置顶、推荐位、首页/列表广告、商家/师傅套餐。
- Stripe Checkout/Payment Intent，通过 webhook 确认结果。
- 订单、付款、退款、履约、发票/收据引用和双向账本。
- 所有推广内容显示“推广/广告”，自然排序与付费权重分离记录。

## 2.4 非功能产品需求

- 中文为默认语言；英语页面可完整操作，不是机器拼接残缺页面。
- 移动优先；发布和联系链路在 360px 宽度可用。
- 公共详情和聚合页可被搜索引擎抓取；个人中心、搜索组合页和后台不索引。
- 无障碍目标 WCAG 2.2 AA。
- 核心状态有明确空态、加载、错误、离线/重试和过期表现。
- 运营可在不发版情况下调整城市、分类、首页模块、规则、广告库存和 Feature Flag。

## 2.5 明确不在 MVP

- 平台托管商品/房租/工资的完整交易或托管支付。
- 实时竞价广告和复杂推荐机器学习。
- 原生 iOS/Android App。
- 全量论坛、群聊、直播、短视频。
- 复杂供应链、报关、跨境结算。
- 多州税务结算和多货币账本。
- 公共开放 API 市场。

## 2.6 业务规则摘要

- 信息发布者必须登录；高风险分类可能要求额外验证。
- 同一主体、相似标题、相同联系方式和短时间内重复发布触发去重/审核。
- 过期信息从默认结果移除，但按保留策略保存。
- 置顶不能绕过内容审核；被下架后的未消费推广按政策处理。
- 评价只允许具有可验证互动/订单/线索关系的用户，且同一关系限制一次有效评价。
- 用户可屏蔽对方；屏蔽后不能新发消息，也不向双方暴露状态细节。

## 2.7 产品指标

### 北极星与健康指标

- 有效联系数（通过反垃圾过滤、排除自联系/重复）。
- 搜索成功率（搜索后产生详情/收藏/联系的会话比例）。
- 发布到首个有效联系的时间。
- 信息审核通过率与中位审核时长。
- 7/30 日供给方留存、有效信息新鲜度。
- 举报率、确认诈骗率、消息垃圾率、误杀申诉率。
- 付费推广履约率、退款率、商家续费率。

所有指标必须在 `schemas/analytics-event.schema.json` 的事件契约下采集，并提供隐私退出与保留策略。

---

<!-- source: docs\03-information-architecture.md -->

# 03. 信息架构

## 3.1 顶层导航

公开站顶层导航与设想图保持一致，但按发布阶段控制：

| 导航     | MVP       | 目标路由                | 说明                   |
| -------- | --------- | ----------------------- | ---------------------- |
| 首页     | 是        | `/[locale]`             | 城市化首页编排         |
| 招聘     | 是        | `/[locale]/jobs`        | 列表、详情、发布       |
| 租房     | 是        | `/[locale]/rentals`     | 列表、详情、发布       |
| 转让     | 是        | `/[locale]/transfers`   | 生意/店铺/设备转让     |
| 二手     | 是        | `/[locale]/marketplace` | 二手物品               |
| 找师傅   | 是        | `/[locale]/providers`   | 本地服务商目录         |
| 商家     | 是        | `/[locale]/businesses`  | 商家黄页               |
| 优惠     | Phase 2   | `/[locale]/deals`       | 商家优惠               |
| 问答     | Phase 2   | `/[locale]/questions`   | 本地问答               |
| 论坛     | Phase 2   | `/[locale]/community`   | 社区板块               |
| 活动     | Phase 2   | `/[locale]/events`      | 本地活动               |
| 国内货源 | Phase 2/3 | `/[locale]/suppliers`   | 审核后启用             |
| 更多     | 是        | 菜单                    | 新闻、帮助、关于、政策 |

## 3.2 核心层级

```text
语言
└── 地域上下文（南加州 / 县 / 城市 / 社区）
    ├── 首页
    ├── 垂直频道
    │   ├── 城市+分类聚合页
    │   ├── 筛选结果页
    │   ├── 详情页
    │   └── 发布/编辑流程
    ├── 商家/师傅目录
    ├── 搜索
    ├── 用户中心
    └── 帮助、政策和品牌页
```

语言不应通过查询参数表达；使用稳定路径 `/zh-Hans/...` 与 `/en/...`。地域上下文可作为路径中的城市 slug，也可作为用户偏好和筛选条件。不要为每个任意筛选组合生成可索引 URL。

## 3.3 页面模板

### 首页模板

- 全局头部、地区选择、统一搜索、账户入口。
- 左侧快速发布。
- Hero、热门搜索和可信的实时/近实时指标。
- 热门排行榜、城市、置顶信息。
- 功能入口矩阵。
- 最新招聘/房源/转让/二手。
- 需求大厅、价格行情、老板专区、跨境资源（按 Feature Flag）。
- 右侧广告、优质商家、推荐师傅、增值服务。
- 平台保障、角色后台入口和页脚。

### 垂直聚合页

- H1、地域面包屑、简短可读介绍。
- 结构化筛选、排序、结果数、地图切换（租房/服务可选）。
- 自然结果与推广结果清晰标记。
- 可抓取的城市/分类组合仅限运营批准白名单。
- FAQ、相关城市/分类和安全提示。

### 详情页

- 状态、新鲜度、验证/推广标签。
- 标题、价格、地点精度、结构化属性、正文和媒体。
- 发布者卡片、可信信号、联系按钮、举报。
- 相似信息与安全提醒。
- 对爬虫不暴露私密联系方式。

### 发布流程

1. 选择发布类型。
2. 选择分类和城市。
3. 动态字段填写和媒体上传。
4. 联系与隐私策略。
5. 预览、规则提示和提交。
6. 审核状态与后续推广。

支持保存草稿、自动保存、恢复、移动端键盘和字段错误定位。

## 3.4 用户中心

```text
/account
├── overview
├── listings
│   ├── drafts
│   ├── pending
│   ├── published
│   └── archived
├── favorites
├── messages
├── notifications
├── orders
├── wallet
├── organizations
├── profile
├── verification
├── security/sessions
└── privacy
```

用户中心默认 `noindex`，所有数据通过鉴权 API 获取。

## 3.5 多角色后台入口

设计图底部的“平台后台入口”在真实产品中不应把所有入口公开展示给未授权用户。登录后根据权限显示：用户中心、商家后台、师傅后台、供应商后台、广告主后台、审核/运营后台、客服、财务。后台路径与公开站分域或独立应用，并执行后端权限校验。

## 3.6 URL 与 slug 规则

- slug 使用 ASCII 小写、短横线和稳定业务词；中文标题不是唯一标识。
- 详情建议：`/[locale]/jobs/[citySlug]/[listingSlug]-[shortId]`。
- 城市/分类路径由路由注册表生成，避免自由拼接和重复 canonical。
- slug 变更保留 301 映射；资源 ID 永不由 slug 推断授权。
- 搜索和多数筛选 URL 设置 canonical/noindex；高价值聚合页由 SEO 白名单控制。

## 3.7 空态与失败态

每个列表和详情模板必须设计：无结果、筛选过窄、资源过期/下架、权限不足、登录过期、上传失败、支付处理中、服务降级和网络重试状态。错误不能只显示内部代码，应提供明确下一步但不泄露安全细节。

---

<!-- source: docs\04-user-journeys.md -->

# 04. 关键用户旅程

## 4.1 访客搜索并联系发布者

1. 用户从首页、城市页或搜索引擎进入。
2. 系统解析语言和城市上下文，不强制弹窗阻断浏览。
3. 用户搜索“尔湾 主卧”，添加租金与发布时间筛选。
4. 搜索服务返回自然结果、明确标识的推广结果和筛选聚合。
5. 用户打开详情，看到更新时间、地点精度、发布者可信信号和安全提示。
6. 用户点击收藏或联系；未登录时进入短登录流程并返回原页面。
7. 系统创建/复用会话，执行限频和反垃圾规则，发送消息。
8. 发布者收到站内通知，按偏好异步发送邮件/短信。
9. 分析系统记录匿名/用户级事件，避免采集消息正文和敏感联系方式。

异常：资源已过期则禁止新联系并展示相似信息；发布者屏蔽对方则返回通用不可用结果；消息风险高则进入挑战、限速或审核。

## 4.2 个人发布招聘信息

1. 登录后选择“发布招聘”。
2. 选择分类和城市，系统加载相应 JSON Schema。
3. 填写标题、薪资范围、岗位类型、经验、正文和联系策略。
4. 客户端做即时验证；服务端再次执行完整校验。
5. 保存草稿时产生资源版本，媒体采用预签名直传。
6. 提交时在事务内变更为 `SUBMITTED`、创建审核记录和 Outbox 事件。
7. 自动规则判定：低风险自动批准；高风险进入人工队列。
8. 发布成功后建立搜索索引，页面可见；索引延迟不改变数据库状态。
9. 发布者可查看浏览、收藏、有效联系等聚合指标并购买推广。

重大编辑（薪资、地点、联系方式、正文风险词等）重新进入审核；轻微拼写修改可按规则继续展示并异步复审。

## 4.3 房东发布租房

除普通发布流程外：

- 表单提醒公平住房和禁止歧视性描述。
- 精确门牌地址默认私有，公开仅到城市/社区或模糊坐标。
- 图片扫描并删除 EXIF 定位信息。
- 明显低价、重复照片、短期多账号和外部支付引导提高风险分。
- 联系曝光受用户登录、速率和风控控制。

## 4.4 师傅入驻

1. 用户创建服务商档案，选择服务分类与半径。
2. 可提交执照/保险材料；文件进入独立私有桶和验证队列。
3. 运营仅展示验证结论和到期日，不公开证件原件。
4. 服务商发布服务信息并设置可用时间。
5. 用户从目录或信息详情发起咨询。
6. 形成可验证互动后才允许评价。
7. 到期材料触发提醒，过期时移除“已验证”标签而非自动删除档案。

## 4.5 商家购买首页广告

1. 组织 Billing/Owner 选择广告库存、城市、日期和素材。
2. 系统检查库存并创建带过期锁的草稿订单。
3. Stripe 完成支付；同步返回页面只显示“处理中”。
4. 签名 webhook 经持久化、去重后确认付款。
5. 广告素材进入审核，库存和排期在事务中确认。
6. 到期由 Worker 自动开始/结束；展示和点击写入聚合事件。
7. 运营可暂停违规广告，退款依据订单、履约快照和政策决定。

## 4.6 举报与申诉

1. 登录用户选择原因并可附说明/证据。
2. 系统去重同一举报者/资源组合并给出回执。
3. 风险评分决定是否立即隐藏或进入队列。
4. 审核员查看资源快照、规则命中、历史、关联账号和举报证据。
5. 执行动作：无处理、降权、编辑要求、下架、限制用户/组织、封禁。
6. 用户收到不泄露举报者信息的通知。
7. 可申诉动作进入独立队列，由不同或高级审核员处理。
8. 全过程记录审计，敏感证据按保留策略清理。

## 4.7 账户删除

1. 用户验证身份并了解影响。
2. 系统检查未完成订单、争议、组织 Owner 转移和法定保留。
3. 进入冷静期，撤销活动会话和营销同意。
4. 到期后撤下公开内容或按政策匿名化。
5. 财务/审计记录保留最小必要字段，个人资料与可分离 PII 去标识。
6. 搜索索引、缓存、对象存储和分析标识通过异步任务清理。
7. 生成删除完成审计，不保留不必要的原始身份材料。

## 4.8 管理个人资料与登录设备

1. 已登录用户读取自己的安全资料投影；响应不包含邮箱、手机号、trust score、token/IP hash。
2. 用户修改显示名、简介、语言或首选地区时提交服务器返回的强 ETag；过期版本返回冲突而不静默覆盖。
3. 首选地区必须是仍启用的 taxonomy region；头像只能由后续安全媒体流程设置，不能保存任意外部 URL。
4. 用户查看仍有效的登录会话，看到创建/最近活动/到期时间和经过清理的 User-Agent，并明确标识当前会话。
5. 会话列表使用用户绑定、HMAC 签名的 cursor；客户端不能篡改游标或用一个账号的 cursor 查询另一个账号。
6. 用户可幂等撤销自己的任一会话，未知或他人 session ID 返回相同结果；撤销当前会话时同时清除 Cookie。
7. “注销全部”原子撤销该用户所有会话并清除当前 Cookie。
8. 用户状态或软删除标记变化时，数据库不变量立即撤销全部未撤销会话；后续请求继续执行状态 fail-closed。

---

<!-- source: docs\05-roles-and-permissions.md -->

# 05. 角色、权限与授权模型

## 5.1 模型

采用 RBAC + ABAC：角色决定可执行动作集合，属性决定具体资源是否可操作。所有授权在 API 服务端执行，UI 仅用于减少无效入口。

属性包括：资源 owner、organization membership、组织角色、资源状态、城市/分类审核范围、验证等级、账户风险状态、订单关系和时间窗口。

## 5.2 平台角色

| 角色              | 典型权限                                     | 限制                             |
| ----------------- | -------------------------------------------- | -------------------------------- |
| Guest             | 浏览公开资源、搜索                           | 不可发布、收藏、联系、举报       |
| User              | 个人资料、草稿、发布、收藏、消息、举报、订单 | 仅自己的资源和会话               |
| Verified User     | 高风险分类或更高额度                         | 仍受规则和限频                   |
| Support           | 查看最小必要账户/会话元数据、协助恢复        | 默认不能看消息正文和验证原件     |
| Moderator         | 审核内容、处理举报、施加内容动作             | 不处理付款、不能改自身审计       |
| Senior Moderator  | 申诉、用户/组织高级限制                      | 高风险动作需双人确认             |
| Ad Ops            | 广告库存、素材审核、排期                     | 不能退款或改账本                 |
| Finance           | 订单、退款、对账、账本调整                   | 不审核内容；调整需理由和复核     |
| Taxonomy Admin    | 城市、分类、表单和首页编排                   | 发布前需版本/回滚                |
| Platform Admin    | 系统配置、角色授权、Feature Flag             | 强制 MFA，最小人数，所有动作审计 |
| Read-only Auditor | 只读审计和报告                               | 无写权限、导出受控               |

## 5.3 组织角色

| 角色    | 档案         | 信息           | 成员              | 订单/账单          | 分析              |
| ------- | ------------ | -------------- | ----------------- | ------------------ | ----------------- |
| OWNER   | 全部         | 全部           | 邀请/移除/转权    | 全部               | 查看              |
| ADMIN   | 编辑         | 全部           | 邀请/移除非 Owner | 查看/购买          | 查看              |
| EDITOR  | 编辑有限字段 | 创建/编辑/提交 | 无                | 无                 | 查看自身内容      |
| BILLING | 只读         | 只读           | 无                | 购买/发票/付款方式 | 财务报告          |
| ANALYST | 只读         | 只读           | 无                | 只读               | 查看/导出受控数据 |

组织中必须始终至少有一个 Owner。Owner 转移和组织删除需要近期认证；Billing 不能通过修改内容间接获得审核权限。

## 5.4 资源级规则示例

### 信息

- 草稿：Owner 或组织 Editor 以上可读写。
- 已提交：默认只读；允许撤回，或通过受控修订创建新版本。
- 已发布：Owner 可编辑，重大字段触发重新审核。
- 已下架：Owner 可查看原因和申诉，不可自行恢复。
- 已删除：普通界面不可见；审计/法律保留按策略访问。

### 会话

- 只有参与者可读取会话。
- Support 默认仅查看时间、参与者状态、举报标记和技术元数据；查看正文需工单理由和临时授权。
- 被屏蔽或限制的用户不能发新消息。
- 管理员不能使用后台 API 冒充用户发送消息。

### 评价

- 作者可在短时间窗口编辑；删除采用软删除和审核记录。
- 被评价组织不能修改评价，只能回复或举报。
- 审核员不能处理自己或所属组织相关的案件。

### 订单和账本

- User/组织 Billing 仅能查看自身订单。
- 退款由 Finance 或自动政策流程执行，必须引用原支付和幂等键。
- 账本调整至少需要原因码、工单、操作者和复核状态。

## 5.5 权限实现

- 身份解析：Session → User → status/risk → memberships。
- 控制器声明动作，例如 `listing:publish`。
- Policy service 接收 actor、action、resource context，返回 allow/deny 与原因码。
- Repository 查询尽量带 owner/org 条件，避免“先取全对象再判断”产生 IDOR。
- 后台高风险动作采用 step-up authentication 与可选双人审批。
- 权限结果可短时缓存，但用户状态、组织角色和封禁变更必须主动失效。

API 应用层的统一实现位于 `apps/api/src/common/authorization/`：

- `AuthContextGuard` 先解析 Cookie/Session，再为每个请求建立不可变 `RequestContext`。Actor 只包含 user/session ID、账户状态、验证徽章、显式全局权限和活动组织 membership，不携带显示名、联系方式、IP 或 token。
- 控制器使用 `@RequirePolicy("<domain>:<resource>:<action>")` 声明动作；全局 `AuthorizationGuard` 在进入控制器前执行已注册规则。未声明动作的公共路由不被误拦截，但任何未注册动作、重复注册或规则异常都失败关闭。
- `PolicyService` 返回内部 allow/deny 与稳定原因码；HTTP 边界只向未登录用户返回通用 401，向其他拒绝返回通用 403，不泄露资源、角色或组织是否存在。
- 对象级规则必须使用 Repository 已按 actor/tenant 约束取得的最小资源上下文（owner、organization、state、deleted），不得把客户端提交的 owner/org 当作授权事实。`ownerOrOrganizationPolicy` 是组合规则，不替代 Repository 的 scoped query。
- `/auth/session` 的 `permissions` 只用于客户端减少无效入口；服务端每次请求仍重新构建 Actor 并执行 Policy，客户端不得提交或覆盖权限。当前 ACTIVE 用户获得账户自助、`listing:draft:create` 和 `media:upload:create` 能力，LIMITED 用户仅保留账户资料/会话自助能力；Listing 草稿和媒体上传 intent POST 已由各自 Policy 动作强制执行。

`ADMIN-001` 将平台角色与组织角色分开持久化到 `platform_role_assignments`。每条授权保留 reason、
grant/revoke actor、时间、可选到期与 JSON-object scope；会话 Repository 在每次请求只读取未撤销、
未过期授权，不把客户端 claims 当作事实。`admin:console:access` 只授予 ACTIVE 且至少有一个有效平台
角色的 Actor。`GET /admin/session` 再次执行服务端 Policy，并只返回安全用户投影、去重后的角色和服务端
计算的工作区导航；普通 ACTIVE 用户和带角色的 LIMITED 用户都收到不泄露角色细节的 403。

`AUTH-005` 在该 bootstrap 权限之外增加两层服务端动作：

- `admin:console:privileged` 必须同时具备当前平台角色与 `MFA` 强度 Session；
- `admin:sensitive:access` 还必须处在十分钟近期 MFA 窗口内。

普通 EMAIL/SMS OTP 只能建立 `PRIMARY` Session。TOTP 或一次性恢复码验证会原子撤销旧 Session，
换发默认绝对 8 小时、闲置 30 分钟的 MFA Session；`RequestContext` 携带服务端解析的认证强度与
近期认证布尔值，客户端不能提交。新增后台工作区必须声明 `admin:console:privileged`，PII reveal、
导出、封禁、角色/财务/配置等高风险动作必须声明 `admin:sensitive:access`，不能只读取
`GET /admin/session` 的展示字段。

## 5.6 权限测试最小矩阵

每个资源至少测试：未登录、资源拥有者、同组织不同角色、无关普通用户、受限用户、正确后台角色、错误后台角色、跨组织 ID、已删除/下架状态、批量接口部分越权。默认拒绝，未知动作不得隐式放行。

可复用测试 helper 位于 `apps/api/test/support/policy-matrix.ts`。新资源应以表驱动矩阵验证 allow/deny 和原因码，并至少包含跨组织、错误角色、受限账户、删除资源和缺失资源负例；HTTP 测试另外断言外部错误不会暴露内部 deny reason。

`ORG-001` 把组织角色落为以下显式动作；未列出的组合默认拒绝：

| 动作                          | OWNER | ADMIN | EDITOR | BILLING | ANALYST |
| ----------------------------- | ----- | ----- | ------ | ------- | ------- |
| `organization:profile:read`   | ✓     | ✓     | ✓      | ✓       | ✓       |
| `organization:profile:edit`   | ✓     | ✓     | ✓      | —       | —       |
| `organization:profile:manage` | ✓     | ✓     | —      | —       | —       |
| `organization:listings:write` | ✓     | ✓     | ✓      | —       | —       |
| `organization:members:read`   | ✓     | ✓     | —      | —       | —       |
| `organization:members:manage` | ✓     | ✓     | —      | —       | —       |
| `organization:owner:transfer` | ✓¹    | —     | —      | —       | —       |
| `organization:billing:manage` | ✓     | —     | —      | ✓       | —       |
| `organization:analytics:read` | ✓     | ✓     | —      | ✓       | ✓       |

`profile:edit` 只代表公开档案内容，不能修改 legal identity、状态或验证结论；这些字段必须走
`profile:manage` 或后续专用审核动作。每次对象授权使用 Repository 返回的当前 membership 覆盖请求
开始时的角色快照；成员列表 SQL 同时限制 actor 为 OWNER/ADMIN，降低并发降权窗口。

`ORG-002` 已把 `members:manage` 落到短效邀请、撤销、非 Owner 角色变更和移除。邀请只接受现有 ACTIVE
用户 UUID，不通过请求或事件传播邮箱/手机号；同组织同受邀人最多一个 PENDING 邀请，接受操作绑定
invitee user，跨用户和跨组织标识统一 404。Owner 角色不能通过通用成员接口赋予、修改或删除。

¹ `organization:owner:transfer` 还要求当前 OWNER 的 MFA 强度 Session 和 recent-MFA 窗口。转移事务先
提升目标成员再降级原 Owner，数据库延迟约束在组织创建、成员角色更新和删除的事务提交点保证始终至少
一名 Owner；精确幂等重试返回原转移凭据。普通 ACTIVE 用户可通过 `/auth/mfa/*` 建立自有 TOTP
step-up，MFA secret、恢复码和 Session token 不进入组织事件或审计 metadata。

---

<!-- source: docs\06-domain-and-data-model.md -->

# 06. 领域与数据模型

## 6.1 领域边界

模块化单体按业务能力而不是技术层划分。建议 API 内部模块如下：

| 模块          | 责任                                   | 拥有的核心数据                                |
| ------------- | -------------------------------------- | --------------------------------------------- |
| Identity      | 用户、身份提供方、会话、验证、账户状态 | users, identities, auth_sessions              |
| Organizations | 商家/服务商/供应商组织与成员           | organizations, memberships                    |
| Taxonomy      | 地区、分类、动态表单、别名             | regions, categories                           |
| Listings      | 五类信息、详情扩展、版本、生命周期     | listings, *_details, listing_media            |
| Media         | 预签名上传、扫描、变体、访问策略       | media metadata / object keys                  |
| Search        | 索引投影、查询、同义词、热词           | OpenSearch indices, search config             |
| Messaging     | 会话、参与者、消息、屏蔽               | conversations, participants, messages         |
| Trust         | 商家/师傅档案、验证、评价              | business_profiles, provider_profiles, reviews |
| Moderation    | 规则命中、举报、案件、动作、申诉       | reports, moderation_cases/actions             |
| Notifications | 模板、偏好、站内/邮件/短信投递         | notifications, delivery attempts              |
| Commerce      | SKU、订单、支付、退款、积分账本        | orders, payments, wallet_entries              |
| Advertising   | 活动、素材、库存、排期、履约           | ad_campaigns, creatives, placements           |
| Analytics     | 事件契约、聚合指标、实验               | event stream / warehouse projections          |
| Admin/Audit   | 后台授权、配置、审计                   | platform_role_assignments, audit_logs         |

模块可在同一数据库中使用独立 repository 和 service 边界。禁止把“同库”理解为可任意跨表写入。

## 6.2 核心聚合

### Listing 聚合

根实体 `Listing` 存放跨类型共享字段，类型特有字段放在一对一 detail 表：

- `JobDetail`：雇主、雇佣类型、薪资、经验、远程、签证支持。
- `RentalDetail`：房型、卧室/浴室、面积、押金、可入住日、租期、家具、宠物、停车。
- `TransferDetail`：业务类型、要价、租金、剩余租期、转让原因、库存。
- `SecondhandDetail`：成色、品牌、型号、交付方式。
- `ServiceDetail`：服务半径、执照、保险、紧急服务和时间。

不变式：

1. 一个 Listing 只能有与 `type` 匹配的一个 detail。
2. `PUBLISHED` 必须有 `publishedAt`，并已通过适用审核。
3. 公开查询只返回 `status=PUBLISHED`、未删除、未过期且地区/分类有效的数据。
4. 价格与货币组合合法；`FREE/NEGOTIABLE` 不应要求固定金额。
5. 精确地点只对获授权方返回；公开坐标按精度策略模糊化。
6. 每次更新递增 `version`，并用乐观并发控制。
7. 重大字段变化产生新的审核快照，而不是覆盖审核证据。

`LIST-001` 将这些规则实现为不依赖 Nest/Prisma 的纯领域边界
`apps/api/src/modules/listings/listing-domain.ts`。五类 detail 使用 `kind` 判别联合并在运行时再次校验
必须与 Listing `type` 一致；金额只接受 `bigint` 最小货币单位和 `USD`，`FREE/NEGOTIABLE`
必须没有金额，其余价格必须为正数且不超过数据库精度。Job 薪资上下限、Rental 房间/押金、
Transfer 要价/租金/剩余租期、Secondhand 成色和 Service 半径都有有界规则。

内容状态和审核状态保持正交但受组合矩阵约束：草稿只能 `NOT_REVIEWED|REJECTED`，提交态只能
`PENDING_REVIEW|ESCALATED`，公开/过期/归档只能 `AUTO_APPROVED|APPROVED`，暂停态记录
`REJECTED`。所有转换要求当前 `expectedVersion`、非倒退 UTC 时间、actor 和稳定原因码，成功后
只生成新聚合与前后状态事件并递增版本；发布期限由调用方显式传入 1–365 天，过期动作不能早于
`expiresAt`。`LIST-002` 已由 `packages/database` 的 Listing Repository 接入只读持久化边界；
`LIST-003` 已接入草稿创建与条件更新写事务。领域规则本身不直接操作 Prisma，也不自行决定运营发布期限。

`LIST-002` 使用三套显式 Prisma `select` 和独立返回类型，而不是序列化完整 Listing。公开读取在 SQL
条件中同时要求已发布、已批准、发布时间已到、尚未过期、未删除、有效地区/分类，以及可用 owner/
organization；owner 读取把直接 owner 或当前 organization membership 与 actor 状态放进查询；
moderator 读取只接受当前未撤销、未过期且 region/category scope 匹配的 `MODERATOR`/
`SENIOR_MODERATOR`。不同权限层的动态 attributes 始终按 Listing 保存的精确
`formSchemaVersion` 重新读取已发布定义并投影；定义缺失、损坏、字段重复或未知 attribute 时失败关闭，
绝不返回原始 JSON。公开投影不含精确坐标、联系方式、审核状态和内部评分；owner 可读取自己的精确点和
审核状态但不含审核员字段；moderator 可读取受控内部状态和三层动态字段，但仍不读取邮箱、手机号、
组织 legal name 或精确坐标。

`LIST-003` 的草稿创建把 `owner + Idempotency-Key` 和 canonical request hash 保存为配对证据；同一
actor/key 的精确重试返回原草稿，不同 payload 返回 409，事务级 advisory lock 防止并发重复插入。
更新先锁定 Listing，再要求当前 `DRAFT`、当前个人 owner 或组织 `OWNER|ADMIN|EDITOR`、精确历史表单
schema 和 `expectedVersion`；条件更新只允许一个并发请求成功。每次成功创建/更新在同一 PostgreSQL
事务追加最小化 `AuditLog` 与版本化 Outbox，事件不含标题、正文、attributes、联系方式或幂等证据。
组织 Listing 的创建者不享有永久旁路；移除 membership 后即失去 owner 投影视图和写权限。

### Organization 聚合

Organization 是可多人管理的商业主体。商家、师傅团队和供应商共享成员模型，但对应 profile/verification 能力不同。

不变式：至少一名 Owner；slug 唯一；被暂停组织不能创建新公开内容；删除组织前必须处理信息、订单和 Owner 关系。

`ORG-001` 的创建 Repository 在单一 PostgreSQL 事务中验证 ACTIVE actor、插入 Organization 并插入
初始 OWNER membership；任何一步失败都不留下无 Owner 组织。slug 是全局唯一的稳定重试句柄：同一 Owner
以完全相同的 payload 重试返回原资源，换 Owner 或不同 payload 返回冲突。成员范围读取把
`actorUserId + organizationId` 放入查询条件；成员列表还在 SQL 中要求当前角色为 OWNER/ADMIN，并只投影
display name、受控头像、角色和加入时间，不读取邮箱、手机号或内部风险字段。邀请、移除、角色变更、
至少一名 Owner 的并发维护及 step-up Owner 转移属于 ORG-002。

### Identity 聚合

`User`、`UserProfile` 与 `AuthSession` 构成认证后的账户管理边界。资料通过递增 `version` 做乐观并发，
避免多端编辑静默覆盖；联系方式和内部信任状态不属于自助资料 DTO。会话只保存 bearer token 的域分离
HMAC，设备管理投影不暴露 token/IP hash。`users.status` 或 `deleted_at` 变化时数据库 trigger 撤销该
用户全部未撤销 session，确保 Admin、删除编排或后续 application service 都不能绕过账户状态不变量。

`PlatformRoleAssignment` 是与组织 Membership 分离的平台员工授权历史。它保存显式角色、可选最小范围、
reason code、grant/revoke actor、授予/到期/撤销时间；数据库要求 scope 为 JSON object、到期晚于授予、
撤销时间/操作者同时存在，并禁止同一用户/角色出现两个未撤销 grant。过期授权仍保留为审计历史，并须由
后续受控授权工作流显式撤销后再授予。认证 Repository 每次解析 Session 时按当前时间过滤过期/撤销行，
所以降权不依赖客户端 token 刷新；`ADMIN-001` 不提供角色写 API，bootstrap 只能走受审计维护流程。

`AUTH-005` 为 `AuthSession` 增加 `PRIMARY|MFA` 强度与 `mfa_verified_at`，MFA 换发时在同一事务撤销
旧 Session。每个 User 最多一个 `MfaCredential`；pending/active/disabled 时间状态由数据库 check
约束，TOTP secret 只保存 AES-256-GCM 密文、key version、最后消费时间步和失败锁定元数据。
`MfaRecoveryCode` 只保存域分离 hash 与消费时间，`credential + hash` 唯一。激活、时间步消费和恢复码
消费均在事务内追加最小化 `AuditLog`，并用条件更新使并发重放最多一个成功。

`AUTH-004` 在 User 上增加可空版本化 `password_hash`、`password_changed_at`、有界失败计数与锁定时间。
`PasswordAuthAttempt` 只保存 identifier/IP/device 的域分离 hash、可空 user 关联和
PENDING/SUCCESS/FAILURE 结果，用于三维限流和安全诊断，不保存凭据或 PII 原文。
`PasswordRecoveryRequest` 保存可空 user、channel、destination/token/IP/device hash、冷却/到期、
失败次数、消费/取代时间；窗口、终态与失败次数由数据库 check 约束。成功恢复在同一事务更新 User、
撤销全部 `AuthSession`、消费请求并追加 `auth.password.recovered` 审计，保证重放和部分提交失败关闭。

### Media 聚合

`MediaAsset` 在任何业务资源绑定前记录上传所有权、用途、类型、声明字节数、SHA-256、私有 bucket/key、
短效过期时间和 owner 范围幂等键。对象键只能是服务端生成的
`quarantine/<两位分片>/<media UUID>/original`，不包含原始文件名或用户标识。创建 intent 在 owner
advisory transaction lock 内依次处理 exact retry、ACTIVE actor 复核、未过期活动数量和滚动 24 小时
字节配额，再插入元数据；同一 `owner + Idempotency-Key` 的不同 payload 冲突。`ListingMedia` 仍是现有
公开变体投影；`LIST-004` 在 `MediaAsset` 上增加 nullable `listingId` 和稳定 `sortOrder` 作为私有草稿
绑定证据。Repository 先按 UUID 顺序锁定候选 asset，要求 `LISTING_MEDIA + IMAGE + READY`、当前
actor 所有或已经绑定到同一可编辑 Listing，随后才在同一 Listing 写事务中绑定/解绑。数据库 check
同时禁止把未扫描、非图片或非 Listing 用途的 asset 绑定，跨 Listing 复用由锁和外键失败关闭。

`MEDIA-002` 把生命周期扩展为 `UPLOADING → SCANNING → READY/REJECTED`。API 只根据受信 `HeadObject`
元数据完成 owner 范围的对象确认，并在同一事务递增 `lifecycleVersion`、写入状态和
`media.upload.completed` Outbox；Worker 再重新读取原始对象、计算精确字节数/SHA-256、检查
JPEG/PNG/WebP magic bytes、调用 ClamAV、使用 Sharp 解码与自动旋转，并生成不携带 EXIF/ICC 的
THUMBNAIL/CARD/FULL WebP。`MediaVariant` 以 `(mediaAssetId, kind)` 唯一，key 固定为
`processed/<两位分片>/<media UUID>/<kind>.webp`。READY/REJECTED 终态与对应 Outbox 事件在一个
PostgreSQL 事务内提交；重复或过期 lifecycleVersion 只能返回 existing/stale，不能覆盖新状态。

### Conversation 聚合

会话可关联一个 Listing，参与者集合固定受控；消息追加写入，编辑/删除保留时间戳。阻塞状态影响发送权限，不泄露封禁策略细节。

### Order/Wallet 聚合

订单表示购买意图和履约；支付表示外部资金状态；钱包条目表示积分/信用的不可变变动。当前余额是条目求和或经过校验的投影，不允许直接 `UPDATE balance = ...`。

## 6.3 数据库设计原则

- 主键：内部 UUID；高写入表可后续评估 UUIDv7，但需统一迁移策略。
- 时间：`timestamptz`，数据库/服务统一 UTC。
- 金额：`numeric(14,2)` 或以 minor units 存储；明确币种。
- 文本：标题等有长度上限；正文保留纯文本/受控富文本源，不存未清洗 HTML。
- 软删除：公开内容、用户、组织采用 `deletedAt`；财务记录不可物理覆盖。
- JSON：仅用于可演进、非关键查询属性；关键筛选和约束字段使用列/表。
- 多语言：分类/地区可使用翻译表或受控 JSON；用户内容不自动生成权威翻译。
- 地理：PostGIS geometry/geography 用于半径和边界查询；Prisma 不支持部分能力时通过 SQL repository 封装。
- 审计：业务表的 `updatedAt` 不替代审计日志。

当前 `ListingGeoRepository` 是地理读取的唯一基础封装：它查询由公开模糊经纬度生成的 `geography(Point, 4326)`，使用 `ST_DWithin`（米）筛选、`ST_Distance`（英里）返回距离，并限制最大 250 英里/100 条。Repository 不返回经纬度或私有地址，且对状态、审核、过期、删除、地区与分类有效性做防御性过滤。调用方不得绕过该边界直接拼接地理 SQL。

`TAX-001` 的 `TaxonomyRepository` 是 Region/Category 公共读取边界。主表保留稳定 ID、父级、
slug 和中英名称；`region_aliases` / `category_aliases` 保存可重建查询词，不复制主节点。
Repository 参数化名称/slug/code/归一化别名查询，API 应用层组树并仅公开原始别名、公开区域
中心点和 active 状态。匿名 API 固定 active-only；未启用节点留给后续受权后台预览。

## 6.4 索引策略

基础索引在 Prisma Schema 与 `packages/database/prisma/sql/post_schema_constraints.sql` 中给出。扩展迁移只安装 `pg_trgm`/`postgis`；后置 SQL 必须合并到首个建表迁移之后，再根据查询计划验证：

- Listing：类型/状态/发布时间、分类、地区、owner、organization。
- 搜索 fallback：标题/正文 trigram/全文索引。
- 地理：公开模糊位置 GiST。
- Message：conversation + createdAt。
- Notification：user + status + createdAt。
- Moderation：status + priority + createdAt。
- Order/Payment：customer/organization + status + createdAt；provider event id 唯一。
- Outbox：status + availableAt + id，支持 `SKIP LOCKED` 批量领取。

不要为猜测中的查询建立大量索引。每个新索引应有目标查询、Explain 证据、写入成本和删除条件。

`EVT-001` 将该索引合同实现为部分 claim 索引和原子 CTE：单条
`UPDATE ... FROM (SELECT ... FOR UPDATE SKIP LOCKED)` 按 `availableAt,id` 领取事件、增加 attempt 并把
`availableAt` 推进到租约到期时间。Dispatcher 不持有数据库事务调用 Redis；发布确认和失败记录必须同时
匹配 `id + attempt`，因此过期 dispatcher 不能覆盖后续领取结果。PENDING、PUBLISHED、FAILED 的
`publishedAt/lastError` 组合和 attempts 上限由数据库 check 约束。

## 6.5 一致性边界

同一数据库事务内完成：

- Listing 状态变更 + 审核快照/Outbox。
- Order 创建 + 库存预留/Outbox。
- Payment webhook 去重 + Payment 状态 + 账本/履约事件。
- Moderation action + 资源状态 + AuditLog。
- Message 写入 + Conversation lastMessageAt + 通知事件。

不得把 OpenSearch、邮件、短信、S3 派生处理或第三方 API 放入数据库事务。事务提交后由 Outbox/Worker 完成。

Outbox 进入 BullMQ 后即标记 PUBLISHED，而不是等待消费者完成。`eventId` 同时作为 BullMQ `jobId` 和
消费者幂等键；Redis 或进程故障窗口允许重复投递，消费者必须用 eventId/业务版本做条件更新，不能假设
exactly-once。Redis 不可用时事件保留 PENDING 并在租约/指数退避后重试；达到上限或无效事件进入 FAILED，
受控重放和 reconciliation 由 `EVT-002` 提供。

## 6.6 版本与历史

当前 Schema 包含业务实体的当前快照。`TAX-002` 已增加
`category_form_schema_versions`：一个 Category 最多一个 draft、已发布记录由数据库保护为不可变，
回滚追加新版本；`listings.form_schema_version` 固定旧草稿的校验事实源，`category_fields` 只是当前
发布版本的可重建查询投影。后续仍应增加以下历史能力：

- `listing_revisions`：提交/发布/重大编辑时保存规范化快照、diff、actor、风险结果。
- `moderation_rule_hits`：规则版本、输入摘要和结果。
- `payment_webhook_receipts`：原始事件引用、签名校验结果、处理状态。
- 首页编排、同义词和规则的专用版本表（分类表单不再使用泛化 `config_versions`）。
- `deletion_requests`：账户删除工作流。

历史表应设置分区/保留，而不是无限增长。

## 6.7 数据迁移策略

1. Expand：先新增 nullable 列/表/索引。
2. Dual read/write（必要时）：应用兼容新旧结构。
3. Backfill：分批、幂等、有进度和失败恢复。
4. Switch：切换读取，验证指标。
5. Contract：至少一个稳定发布周期后删除旧结构。

大表 `CREATE INDEX CONCURRENTLY`、长事务和锁风险需在迁移 Runbook 中说明。Prisma migration 可结合手写 SQL，但必须保留可审查文件。首个迁移的推荐步骤是：先用 `--create-only` 生成建表 SQL，再把 `post_schema_constraints.sql` 放到相关表创建之后；不得在表存在前运行后置约束。

Gate 0 CI 同时执行两类迁移保护：

- `pnpm db:migrate:safety` 静态阻断未说明的 drop/truncate/update/delete/rename、收紧非空和新增
  required column；例外必须在 SQL 中给出原因与恢复方案，供审核追踪。
- `pnpm db:upgrade:check` 从版本化的上一兼容基线重放到当前状态，并用合成 sentinel 验证已有
  数据未丢失。空库 `prisma migrate deploy` 仍单独执行，二者不能互相替代。

## 6.8 备份与恢复

- RDS 自动备份与 PITR；生产建议至少 15 分钟恢复点目标。
- S3 开启版本控制和生命周期；私有验证材料使用独立桶/KMS key。
- OpenSearch、Redis 不作为备份事实源；定义全量重建任务。
- 每季度做恢复演练，验证不仅能恢复数据库，还能重新索引、重放任务并恢复应用密钥依赖。

### MOD-001 审核证据模型

`moderation_evaluations` 以 Listing + 提交版本唯一，并以 actor +
`Idempotency-Key` 唯一；保存规则集版本、风险层、输入哈希和最终状态/版本。
`moderation_rule_hits` 只保存稳定规则代码、规则版本、严重度和证据字段名。
两表由数据库触发器阻止 UPDATE/DELETE。中高风险 evaluation 与
`moderation_cases` 一对一；Listing 状态、evaluation、case、Audit 和 Outbox 在同一事务提交。

### ADMIN-002 人工审核证据模型

`moderation_case_snapshots` 与 Listing submission Case 一对一，保存提交时 Listing 版本、canonical
SHA-256、抓取时间和已脱敏 JSON。动态 PHONE/EMAIL/contact/address 字段与精确坐标不会进入快照；
快照和 `moderation_actions` 均由数据库触发器禁止 UPDATE/DELETE。`moderation_cases.version` 提供
强 ETag 并发控制，`moderation_actions(actor_id,idempotency_key)` 保证 actor 范围精确重试；历史动作
允许两个证据字段均为空，新工作台动作必须同时写入 key 与 request hash。

批准/要求修改/拒绝/升级在一个事务内更新 Listing 与 Case version，追加 ModerationAction、
最小 AuditLog 和 OutboxEvent。Case 快照外键使用 RESTRICT，因此动作或资源处置不能顺带删除审核
事实；事故恢复优先停用工作台并保留证据，再通过新迁移 roll forward。

### MOD-002 举报与申诉证据模型

`reports` 增加必填 actor-scoped `idempotency_key/request_hash`；部分唯一索引约束同一举报者、目标和
`OPEN|TRIAGED` 状态只有一条活动举报。当前 `target_type` 由数据库约束为 `LISTING`，原因码、补充
说明和请求摘要均有有界 check。接收事务同时创建 `listing-report` Case 和一份不可变脱敏
`moderation_case_snapshots`，但公共或 Admin DTO 都不投影 `reporter_id`。

`moderation_appeals` 与产生下架决定的 `moderation_actions` 一对一，保存 appellant-scoped 幂等证据、
20–2000 字申诉陈述及 OPEN/UPHELD/RESTORED/CLOSED 决策证据；状态、decision code 和 resolved time
由数据库 check 配对。每条申诉拥有独立 `listing-appeal` Case，`moderation_cases_source_check`
强制 submission/report/appeal 三类队列恰好绑定一个来源。举报处置或申诉决定均在 Listing/Case 行锁
内复核 actor/session/版本，并原子追加不可变 Action、最小 Audit 和 Outbox；申诉审核事务还会拒绝
原下架 Action 的 actor。

### LIST-005/LIST-007 公共生命周期持久化

五类 Listing 公开查询仍以 `listings` 为事实源，使用 `(published_at DESC, id DESC)` 复合游标，并要求
PUBLISHED + AUTO_APPROVED/APPROVED、未到期、未删除、active taxonomy 与可公开主体。新增部分索引
分别只覆盖可过期的 Rental、Job、Transfer、Secondhand 和 Service；它们是可重建索引，不是第二份数据。

Owner 归档/软删除在 Listing 行锁内复核 ACTIVE actor、个人 owner 或组织 OWNER/ADMIN/EDITOR、
状态、时间和 version。成功更新与 `AuditLog`、`OutboxEvent` 同事务；DELETE 写 `deleted_at` 而不物理
级联。过期 Worker 通过 `FOR UPDATE SKIP LOCKED` 领取到期行，状态/version predicate 保证同一
Listing 只产生一次 `listing.expired` 审计和事件。

Transfer/Secondhand/Service 明细与对应 Listing 在创建/更新事务内 upsert，并删除不属于当前类型的
其他垂直明细。数据库 check 分别约束转让核心字段、二手成色/交付数组和服务半径/可用时间；应用层
在进入 Repository 前继续执行价格单位、政策确认和有界业务规则，形成双层失败关闭。

### NOTIF-001 站内通知投影

`notification_templates` 以稳定 key、channel、locale、version 唯一，已发布版本由数据库触发器禁止
UPDATE/DELETE。`notifications` 保存渲染快照及 `template_id/template_version`、Listing 资源引用、
`source_event_id/aggregate_version`；同一事件对同一用户和 channel 只能产生一行。Worker 可以接收
重复或乱序事件，但按事件发生时间生成通知并通过 advisory lock/唯一键收敛。读取只返回当前用户的
IN_APP 投影，按 `(created_at DESC,id DESC)` 稳定分页；已读更新绑定 user，外部标识不会越权改变状态。

### ORG-002 成员生命周期与 Owner 不变量

`organization_invitations` 保存 actor/org 范围的幂等键与请求摘要、非 Owner 角色、到期时间和
PENDING/ACCEPTED/REVOKED/EXPIRED 单向状态证据；部分唯一索引禁止同一组织和受邀人并存两个 PENDING
邀请。接受在组织/邀请锁内写 membership、邀请状态、AuditLog 和 OutboxEvent。

`organization_memberships.version/updated_at` 为角色变更提供强 ETag 并发控制。Owner 转移凭据写入
`organization_owner_transfers`，包含 from/to、精确幂等摘要、结果角色与发生时间。两个 deferred
constraint trigger 在事务结束时检查组织至少保留一名 Owner，使先提升后降级的转移可原子提交，同时
拒绝直接删除或降级最后一名 Owner。

---

<!-- source: docs\07-system-architecture.md -->

# 07. 系统架构

## 7.1 架构风格

首期采用“模块化单体 + 异步 Worker + 可重建读模型”。目标是在一个团队可控范围内实现强边界、可靠发布和水平扩展，而不是提前承担微服务的一致性、网络和运维成本。

```text
Browser / Search Bot
        │
   CDN + WAF
        │
 ┌──────┴────────┐
 │               │
Next Web      Next Admin
 │               │
 └──────┬────────┘
        │ HTTPS REST
  NestJS API (stateless)
   │     │      │
   │     │      └── Redis (cache/rate limit/queues)
   │     └───────── OpenSearch (read model)
   └─────────────── PostgreSQL/PostGIS (system of record)
        │
      Outbox
        │
   BullMQ Workers ── S3 / Email / SMS / Stripe / Search
```

Mermaid 图见 `diagrams/system-context.mmd`、`containers.mmd`、`deployment.mmd`。

## 7.2 进程边界

### Web

- 公开路由、SSR/ISR、SEO 元数据、结构化数据和用户交互。
- BFF 逻辑仅限页面组合、cookie 转发和视图适配，不承载核心业务规则。
- 静态/缓存页面通过 tag/path 失效与短 TTL 保持新鲜。
- 浏览器只能访问公开 API 和预签名上传地址。

### Admin

- 与 Web 分开构建和部署，独立域名、CSP 和访问策略。
- 后台强制 MFA、细粒度权限和敏感动作二次验证。
- 批量操作先预览影响范围，异步执行并提供作业进度。

### API

- 无状态，可水平扩展。
- Nest 模块对应领域边界；应用服务掌握事务和授权。
- Fastify 承担 HTTP；OpenAPI、Problem Details、请求 ID、验证和日志为横切能力。
- 对第三方使用端口/适配器，不把供应商 SDK 渗透到领域层。

### Worker

建议队列：

- `outbox-dispatch`
- `search-index`
- `media-scan`
- `media-transform`
- `notifications`
- `listing-lifecycle`
- `moderation-enrichment`
- `commerce-fulfillment`
- `analytics-export`
- `maintenance`

不同队列可独立并发和限速；高风险/重任务不能阻塞通知等轻任务。

## 7.3 API 模块依赖方向

```text
HTTP Controller
    ↓
Application Use Case / Policy
    ↓
Domain Rules
    ↓
Repository / Provider Ports
    ↓
Prisma, OpenSearch, Redis, S3, Stripe adapters
```

领域规则不依赖 Nest、Prisma 或第三方 SDK。首期不必追求纯粹 DDD 框架，但要保护“控制器—服务—仓储”边界和模块所有权。

## 7.4 写入流程

以发布信息为例：

1. Controller 验证请求形状和身份。
2. Policy 校验 actor 对草稿的权限。
3. Use case 加载聚合，执行状态与字段不变式。
4. 同一 PostgreSQL 事务写 Listing/Revision/Moderation request/Outbox。
5. API 返回数据库确定的状态，不等待 OpenSearch 或通知。
6. Outbox dispatcher 领取事件并投递 BullMQ。
7. Worker 更新索引、发送通知；失败重试，超过阈值进入 DLQ。

所有消费者以 `eventId` 或业务幂等键去重。

`LIST-003` 的草稿写入已按此边界实现：Controller 只解析严格 DTO、会话、`Idempotency-Key` 和强
`If-Match`；application service 组合 API-004 Policy、精确 taxonomy/form-schema 校验与 Listing
领域价格不变式；database store/repository 才执行 actor/organization scoped query、行锁、版本条件、
Listing/AuditLog/Outbox 原子事务。创建使用 actor-scoped advisory transaction lock，使两个同时到达的
同 key 请求只产生一行和一组证据。OpenSearch、Redis 和 Worker 不参与草稿写入的成功判定。

`EVT-001` 的 dispatcher 运行在现有 Worker 进程，不新增服务边界。它短事务领取有界批次，事务提交后
才向配置的 BullMQ 队列写入 versioned envelope；jobId 固定为 eventId。成功/重试/终态失败使用 attempt
版本条件更新，进程在入队后、确认前退出只会形成预期的安全重复。事件 payload 不进入结构日志或指标标签，
队列 envelope 默认限制为 128 KiB。

媒体处理同样留在模块化单体的 API/Worker 进程边界内。API 对 quarantine 对象执行服务端 HEAD 后原子写
SCANNING + Outbox；Worker 消费 `media.upload.completed`，重新验证对象内容、经 ClamAV 和 Sharp
生成三个确定性 WebP key，再原子写 READY + variants + Outbox。对象写可能先于数据库终态，因此 key
必须确定且写入幂等；Worker/对账任务可安全重做，PostgreSQL 的 status + lifecycleVersion 始终是事实源。

## 7.5 读取流程

- 详情和强一致账户页面从 PostgreSQL 读取，可经过短缓存。
- 搜索、聚合、热门词和地理筛选从 OpenSearch 读取。
- 搜索结果中的关键状态可批量回源校验，尤其在下架传播窗口。
- 首页模块由配置服务 + 聚合 API 组合，使用分块缓存和 stale-while-revalidate。
- 管理报表不得在在线主库执行无边界重查询；使用只读副本/物化视图/分析投影。

## 7.6 缓存策略

缓存只用于可重建数据：

| 数据               | 建议               | 失效                  |
| ------------------ | ------------------ | --------------------- |
| 分类/城市/首页配置 | 5–30 分钟 + 版本键 | 配置发布事件          |
| 公开详情           | 30–120 秒          | Listing 变更事件      |
| 聚合页             | 30–300 秒          | tag + TTL             |
| 会话/权限          | 极短或不缓存       | 账号/角色变更主动失效 |
| 热门搜索           | 5–15 分钟          | 滚动计算              |
| 限流计数           | Redis 原子操作     | 窗口自然过期          |

不得缓存完整私密联系方式到共享公开缓存；缓存 key 必须包含语言、城市、授权范围等维度。

## 7.7 可用性与降级

- OpenSearch 不可用：详情、账户和发布仍可用；搜索返回服务降级提示，可对有限数据使用 PostgreSQL fallback。
- Redis 不可用：关闭非关键缓存；登录/关键写入根据会话实现决定 fail closed；异步副作用积压在 Outbox。
- 邮件/短信不可用：站内通知继续，外部渠道重试。
- S3 上传不可用：保留草稿，禁止提交缺失必要媒体的内容。
- Stripe 不可用：浏览/发布不受影响；商业化入口显示维护，不创建不完整订单。
- Admin 不可用：公开站继续；紧急下架可通过受控运维命令执行并审计。

## 7.8 扩展与拆分触发条件

只有满足至少一个证据条件时考虑拆服务：

- 某模块需要与 API 显著不同的扩缩容曲线，且进程隔离仍不足。
- 独立团队需要自主发布，模块边界和契约已稳定。
- 故障隔离有明确收益，且分布式一致性成本可接受。
- 法律/安全要求需要独立数据或网络边界。
- 性能剖析证明单体内部资源竞争是瓶颈。

可能最先拆出的能力是媒体处理、通知或搜索查询，而不是用户/订单等强一致核心。

## 7.9 技术基线

仓库 pin 住主版本/小版本，升级通过单独任务：Node 24 LTS、Next.js 16.2、React 19.2、NestJS 11、Fastify 5、TypeScript 5.9、Prisma 7、PostgreSQL/PostGIS、Redis 8、OpenSearch 2.19、BullMQ 5。

生产数据库版本以云供应商和 PostGIS 兼容性验证为准；本地 Compose 使用明确的兼容镜像。版本不是永恒决策，升级应有兼容测试、数据迁移和回退。

---

<!-- source: docs\08-api-and-integrations.md -->

# 08. API 与外部集成

## 8.1 API 原则

- Base path：`/v1`，HTTPS only。
- 风格：资源导向 REST；复杂行为使用清晰动作子资源，不用含糊 RPC 名称。
- 契约：`openapi/openapi.yaml` 是事实源，生成客户端/测试可由其派生。
- 编码：JSON UTF-8；日期时间 RFC 3339 UTC；货币带 currency。
- 身份：Web 采用安全 Cookie 会话；外部/移动客户端未来可增加受限 OAuth/OIDC token。
- 错误：`application/problem+json`，包含 `type`、`title`、`status`、`detail`、`instance`、`requestId`、可选字段错误。
- 追踪：接受/生成 `traceparent` 和 `X-Request-Id`。

## 8.2 版本策略

`/v1` 只做向后兼容增量：新增可选字段、端点或枚举前必须考虑旧客户端。删除/重命名/改变语义属于破坏性变更，需新版本、迁移窗口和弃用头。数据库版本不直接暴露为 API 版本。

## 8.3 分页、筛选和排序

### Cursor 分页

高变动列表使用不透明 cursor：

```json
{
  "items": [],
  "pageInfo": {
    "nextCursor": "opaque",
    "hasNextPage": true
  }
}
```

cursor 编码稳定排序字段和唯一 ID，需签名/校验，不能接受客户端任意 SQL 片段。

### 过滤

- 使用明确白名单参数，如 `regionId`、`categoryId`、`priceMin`。
- 多值使用重复参数或约定数组格式，并写入 OpenAPI。
- 未知筛选返回 400，不静默忽略造成误解。
- 管理后台报表可用 offset，但必须限制最大页、日期范围和导出大小。

### 排序

公开排序只允许产品定义值：`relevance`、`newest`、`price_asc`、`price_desc`、`distance`。付费权重不伪装成纯自然排序。

## 8.4 并发与幂等

- 可编辑资源返回 `version`/ETag；更新要求 `If-Match` 或版本字段。
- 冲突返回 409，并提供当前版本摘要。
- 订单、付款、退款、推广购买、批量后台任务要求 `Idempotency-Key`。
- 幂等记录绑定 actor、endpoint、request hash；相同 key 不同 payload 返回冲突。
- webhook 以 provider event ID 唯一去重；同步返回不视为支付成功事实。

## 8.5 主要端点组

OpenAPI 已定义核心端点，实施时保持下列模块：

```text
/auth/*
/me, /me/sessions, /me/preferences
/regions, /categories, /homepage
/listings, /listings/{id}, /listings/{id}/submit|publish|archive
/listings/{id}/media, /media/uploads
/search/listings, /search/suggestions
/favorites
/conversations, /conversations/{id}/messages
/businesses, /providers, /reviews
/reports
/notifications
/orders, /payments, /wallet
/ads/campaigns, /ads/placements
/admin/moderation/*, /admin/users/*, /admin/config/*
/webhooks/stripe
```

状态变更尽量用子资源或动作端点清晰表达，不允许客户端直接 PATCH 任意 `status`。

`AUTH-001` 已实现 `GET /auth/session` 与 `DELETE /auth/session`。前者从安全 Cookie 解析认证上下文，
仅返回 OpenAPI `SessionResponse` 并设置 `Cache-Control: no-store`；后者通过应用服务幂等撤销数据库
会话并返回同路径、同安全属性的过期 Cookie。`AUTH-002` 实现 `POST /auth/otp/request` 与
`POST /auth/otp/verify`：请求返回 `challengeId` 和过期时间但不返回验证码或账号状态；验证成功后通过
AUTH-001 的会话服务签发同一安全 Cookie。两个端点要求不含 PII 的 `X-Device-Id`，服务端只保存其
HMAC，用于设备绑定和限频。请求认证 Guard 只附加经过有效期、用户状态和软删除检查的上下文；业务对象
授权继续由 `API-004` 的默认拒绝 Policy 完成。

`AUTH-003` 实现 `GET/PATCH /me`、`GET/DELETE /me/sessions` 与
`DELETE /me/sessions/{sessionId}`。资料响应只包含显示名、简介、locale、首选地区、受控头像引用、
版本和更新时间；邮箱、手机号及内部信任字段不进入 DTO。资料更新只接受
`application/merge-patch+json` 白名单字段，要求强 `If-Match` ETag，并以 profile version 原子检测
并发冲突。会话列表按最近活动时间稳定排序，cursor 用 `SESSION_SECRET` 域分离 HMAC 签名并绑定用户；
投影不含 bearer token、token/IP hash。单会话撤销查询始终绑定 actor user ID，未知/他人 ID 与已撤销
ID 共用幂等 204；注销全部撤销全部会话并清除当前 Cookie。

`API-004` 统一把 Session 投影为最小 Actor/RequestContext，并由显式注册的 Policy 动作控制已保护
Controller。`POST /listings` 的现有 Session 要求现在由 `listing:draft:create` 强制执行；OpenAPI
明确声明未登录 401 和无权限/受限账户 403。`Session.permissions` 是服务端生成的 UI capability hint，
不替代每次请求的 Policy，也不接受客户端回传。对象级 action 必须在 Repository scoped query 后以最小
resource context 评估，未知 action 或规则异常失败关闭。

`ORG-001` 新增 `POST /organizations`、`GET /organizations/{organizationId}` 和
`GET /organizations/{organizationId}/members`。创建仅允许 ACTIVE 用户和可创建的四类外部组织，
服务端原子建立初始 OWNER；`INTERNAL`、状态、验证结论和角色不能由客户端 over-post。详情使用成员范围
Repository，跨组织和未知 ID 共用通用 404。成员列表仅 OWNER/ADMIN 可读，采用 actor + organization
绑定的域分离 HMAC cursor，并排除联系方式、账号状态、验证材料和风险字段。当前切片不提供成员写接口；
邀请、撤销和 Owner 转移保持在 ORG-002。

`TAX-001` 实现公开 `GET /regions` 和 `GET /categories`。默认请求返回稳定 ID/slug、中英名称、
原始受控别名与层级树；父级、type/vertical 与 `q` 提供直接子级或扁平匹配。`q` 最长 80 字符，
拒绝控制/双向字符，Repository 使用参数化查询和受控 NFKC 别名键。公开接口的 `activeOnly` 只能
为 true，响应使用五分钟 public cache 与 stale-while-revalidate；未启用 taxonomy 不通过匿名接口
暴露。

`TAX-002` 实现公开 `GET /categories/{categoryId}/form-schema`。缺省读取当前已发布版本，显式
`version` 只读取不可变历史已发布版本；两者均不返回 draft、actor/audit 字段或内部物化配置。响应
返回强 ETag，历史版本可长期 immutable 缓存。应用层同时提供 draft/preview/publish/rollback 与
按精确版本校验 attributes 的服务端能力。`ADMIN-001` 只交付安全 Admin 壳层和角色导航，不提前开放
taxonomy 写端点；后续管理切片必须复用这些能力并增加 MFA/step-up、原因与审计，不能绕过 Repository
直接写 Prisma。

`ADMIN-001` 新增 `GET /admin/session`。它只接受安全 Cookie Session，由后端从 PostgreSQL 当前
有效的平台角色计算 `admin:console:access` 和工作区导航；客户端不能提交 role、permission 或 scope。
未登录返回通用 401，普通/受限用户返回不泄露角色状态的通用 403。成功响应只含安全用户投影、角色、
导航与安全门状态，所有 `/v1/admin/*` 成功或错误响应统一 `Cache-Control: no-store`。独立 Admin
Next.js app 通过同源 `/v1` BFF 仅代理认证与 Admin session allowlist，过滤 hop-by-hop headers，不把
内部 API 地址或任意代理能力暴露给浏览器。

`AUTH-005` 新增三个 no-store、Cookie + same-origin 保护的端点：

- `POST /admin/mfa/enrollment` 幂等返回当前短效 pending TOTP 设置；
- `POST /admin/mfa/enrollment/verify` 激活 TOTP、一次性返回十枚恢复码并轮换 Session；
- `POST /admin/mfa/verify` 使用未重放的 TOTP 时间步或未消费恢复码建立/刷新 MFA 与近期认证。

`GET /admin/session.security` 返回是否已设置 MFA、`PRIMARY|MFA` 认证强度、验证/step-up 到期时间以及
普通特权与敏感动作两个服务端状态。它仍不是业务授权凭证；真实后台 controller 必须声明对应 Policy。
OpenAPI 不提供禁用/重置接口，防止自助降级；人工恢复流程必须由后续审计、身份核验和会话全撤销切片实现。

`AUTH-004` 新增三个公开、`no-store` 的可选密码端点：

- `POST /auth/password/login` 接受 email/E.164 与密码，成功建立普通 PRIMARY Session；
- `POST /auth/password/recovery` 对存在/不存在目的地返回同形 202，恢复证明经 side channel 交付；
- `POST /auth/password/recovery/confirm` 在冷却后单次消费证明、替换密码并撤销全部 Session，不自动登录。

三个端点都要求 16–128 字符的 opaque `X-Device-Id`；登录和恢复分别按 identifier/destination、IP、
device 限流。错误凭据不区分账号存在、账号状态或密码状态；冷却/限流返回 bounded `Retry-After`。
OpenAPI/共享 Zod 契约只暴露请求 ID、恢复请求 ID 和时间窗，不回传 token、hash、联系方式状态或
provider 错误。

## 8.6 响应投影

不同场景使用明确 DTO：

- `ListingSummary`：列表安全字段，不含联系方式、内部风险分。
- `ListingDetail`：详情公开字段和授权后视图。
- `ListingOwnerView`：草稿、审核原因、指标和管理动作。
- `ListingModerationView`：快照、规则命中、关联风险，仅审核员可见。

不要直接序列化 Prisma 模型；这样可避免新增数据库字段意外泄漏。

`LIST-002` 已在数据库包实现内部 `PublicListingProjection`、`OwnerListingProjection` 和
`ModeratorListingProjection`，三者各有显式 Prisma `select`，不共享“读取整行再删除字段”的实现。
公开读取只查询当前已批准、已发布、未过期、未删除且 taxonomy/发布主体可用的内容；owner 读取在同一
查询中绑定直接 owner 或当前 organization member；moderator 读取先验证当前
`MODERATOR|SENIOR_MODERATOR` grant 的撤销/到期状态，再按 region/category scope 匹配资源。缺失资源
和越权读取均返回内部 `null`，由后续 HTTP use case 统一映射通用 404。

动态 `attributes` 不是无条件 JSON：Repository 使用 Listing 固定的精确历史
`formSchemaVersion` 读取已发布 schema，并按 `PUBLIC`、`OWNER_ONLY`、`MODERATOR_ONLY` 分层白名单
投影。schema 缺失/损坏、重复字段和 schema 外属性都失败关闭为空对象。公开层没有精确坐标、
`contactMode`、审核状态、owner/organization 内部关联或 `qualityScore`；owner 层没有审核员字段或内部
评分；moderator 层也不读取账号邮箱/电话、organization legal name 或精确坐标。

`LIST-003` 已把安全投影接入 `POST /listings`、`GET /listings/{listingId}` 和
`PATCH /listings/{listingId}`。创建必须带 16–128 字符 `Idempotency-Key`，成功返回 201、Location、
强 ETag 和 `no-store`；同 actor/key 精确重试返回原资源，不同 payload 返回 409。详情对当前个人
owner/当前组织成员返回 `ListingOwnerView` 和 `no-store`，未发布草稿对 guest/无关 actor 统一 404；
公开详情只返回 `PublicListingView`。更新是严格 merge patch，要求形如 `"listing-vN"` 的强
`If-Match`；版本竞争返回 409 和当前 ETag，不会静默覆盖。组织 `OWNER|ADMIN|EDITOR` 可更新，
`BILLING|ANALYST` 只读；状态/价格/分类/地区/精确历史 attributes 在服务端再次验证。

`LIST-004` 将 `mediaIds` 纳入 owner 投影和创建/更新契约，数组最多 20 个且必须唯一。应用层不信任
客户端上传完成声明；Repository 在事务中锁定并复核 READY、用途、类型、owner/同 Listing 归属，
无效、跨 owner、跨 Listing 和未扫描 ID 统一映射为字段级 422，且不会先递增 Listing version。

## 8.7 上传 API

1. 客户端请求 upload intent，声明用途、mime、大小、hash。
2. API 校验配额和类型，返回短效预签名 URL/object key。
3. 客户端直传私有 quarantine bucket/prefix。
4. 回调或对象事件进入扫描队列。
5. 扫描、解码、重编码、去 EXIF、生成变体。
6. 状态 `READY` 后才能绑定公开信息；公开使用独立 CDN 域和不可执行 content-type。

服务端不信任扩展名或客户端 MIME。文档/验证材料永不进入公共媒体路径。

`MEDIA-001` 已实现 `POST /media/uploads`：仅 ACTIVE 会话具有 `media:upload:create`，请求必须携带
16–128 字符、仅含字母数字及 `._:-` 的 `Idempotency-Key`，以及安全文件名、白名单 MIME、声明字节数和小写十六进制
SHA-256。API 在 owner 级数据库锁内执行 exact retry、最多 20 个未过期 intent 和滚动 24 小时默认
200 MiB 配额；Avatar/Logo 单文件另限 8 MiB，其余已启用图片限 20 MiB。响应是五分钟 `no-store`
S3/MinIO PUT URL，并把 Content-Type、Content-Length、checksum、hash metadata 和服务端加密作为
签名要求。bucket 与不含文件名的 `quarantine/` key 只由服务端配置/生成。`VERIFICATION` 在
MEDIA-003 独立受限桶、KMS 与访问审批完成前返回 422；PDF 不会回退进入普通媒体隔离区。

`MEDIA-002` 已实现 `POST /media/{mediaId}/complete`。API 仅对当前 ACTIVE owner 的 UPLOADING
asset 调用对象存储 HEAD，使用服务端返回的长度、MIME 和 checksum/受签 metadata 与 intent 对比；
跨 owner/未知 ID 统一 404，过期或不一致对象进入 REJECTED 并返回 422，存储不可用返回不泄露 provider
信息的 503。成功仅返回 `202 SCANNING`，重复请求按资源状态幂等返回 SCANNING/READY，绝不把上传完成
误报为 READY。

同事务 Outbox 驱动 Worker 重新读取有界原始字节并独立复算长度/SHA-256，验证 JPEG/PNG/WebP magic
bytes，执行 ClamAV INSTREAM 和 Sharp 解码/像素上限/方向校正，再生成 THUMBNAIL、CARD、FULL 三个
WebP。重编码不复制 EXIF、ICC 或原始 metadata；变体使用确定性安全 key、SSE 和 immutable cache metadata。
永久内容错误进入 REJECTED，ClamAV/S3 等暂时故障抛回 BullMQ 重试；重复/乱序 event 由
`lifecycleVersion` 关闭。只有数据库 READY 和完整三变体集可供后续 Listing 绑定，原始 quarantine
对象及当前 processed bucket 都不直接匿名公开。

`LIST-004` 新增 owner-scoped `GET /media/{mediaId}`，只返回 UUID、四态
`UPLOADING|SCANNING|READY|REJECTED`、稳定拒绝码和更新时间，并强制 `no-store`；未知、删除和跨 owner
标识统一 404，bucket、object key、hash、原图 URL 与 provider 错误不进入响应。Web 通过同源
`/v1` BFF 的 method + UUID path allowlist 调用 session、taxonomy、form schema、Listing 草稿和媒体
生命周期端点；任意 Admin、DELETE、方法混淆或 malformed 路径失败为 404，代理不开放通用 API 穿透。

## 8.8 Stripe 集成

- API 创建内部 Order，再创建 Checkout Session/Payment Intent，metadata 只放内部引用，不放敏感数据。
- webhook endpoint 使用原始请求体验证签名。
- 先持久化 receipt，再异步处理；重复事件返回成功但不重复履约。
- 付款成功状态只来自受信 webhook/主动查询，不来自浏览器 return URL。
- 退款与 dispute 更新 Order、Payment、Ledger 和广告/推广履约。
- provider 超时采用幂等 key 和查询恢复，不盲目重复创建支付。

## 8.9 邮件、短信和通知

定义端口：`EmailProvider`、`SmsProvider`、`PushProvider`。模板使用稳定 key、locale、版本和变量 schema。通知记录先写库，再由 Worker 发送；provider message id、attempt、失败分类和退订状态可追踪。

`NOTIF-001` 已实现站内通知基线：Listing 状态 Outbox 事件由 Worker 严格校验 envelope，并用
`source_event_id + user_id + channel` 唯一键及事件级 advisory lock 幂等投影；中英文已发布模板行
不可修改或删除，Notification 保存模板版本、locale、渲染后的 title/body、资源引用与聚合版本快照。
`GET /notifications` 使用绑定 user 与 unread filter 的 HMAC 游标，`PUT
/notifications/{notificationId}/read` 仅能更新当前用户记录且可安全重试；两个端点均 `no-store`，外部
ID 与未知 ID 共用 404。当前切片只投递 `IN_APP`，邮件/SMS provider、偏好、退订、回执和重试属于
`NOTIF-002`，不得由空适配器伪装为成功。

OTP 使用独立的 `OtpDeliveryGateway` 端口，以避免把邮件/短信 SDK 渗透进认证领域。当前未确认生产
供应商时适配器 fail closed 并返回通用 503，不记录或回显验证码；测试通过捕获型适配器覆盖 EMAIL/SMS
两条通道。生产投递适配器、重试和供应商回执仍由 `NOTIF-002` 实现，不能用记录明文验证码
或静默丢弃投递代替。

营销与事务通知分开处理。短信/邮件退订不应阻断安全和订单必要通知，但必须遵守法律和用户偏好。

## 8.10 地图/地理编码

通过 `GeocodingProvider` 隔离供应商。只存完成业务所需的规范化地址和坐标；公开输出按 location precision 模糊。对同一地址做缓存和配额保护；用户输入不能直接作为地图 HTML。

## 8.11 Webhook 安全

所有外部 webhook：

- 专用路由和最小 body limit；
- 签名、时间戳和重放窗口校验；
- provider event id 唯一约束；
- 原始 payload 加密/限时保留；
- 快速 ACK，业务异步；
- 失败可重放，处理器幂等；
- 指标覆盖签名失败、积压、处理延迟和永久失败。

## 8.12 Gate 0 HTTP 基线

- Fastify 通用 JSON 请求体默认限制为 1 MiB，可通过受校验的
  `API_BODY_LIMIT_BYTES` 在 1–10 MiB 范围内调整；上传和 webhook 端点使用后续任务定义的更窄限制。
- `X-Request-Id` 只接受最长 128 字符的安全字符集，不合规值会替换为 UUID；所有响应回传
  `X-Request-Id`。
- DTO 对未知字段和未知 query 参数返回 400；字段错误放在 RFC 9457 Problem Details 的
  `errors` map 中。
- CORS 仅允许配置的 Web/Admin origin 并允许凭据。带会话 Cookie 的修改请求必须同时具有受信
  `Origin`；webhook 路由不使用 Cookie，后续由签名与重放保护负责。
- Problem Details 不返回 stack、provider 原始错误或查询字符串，错误响应设置
  `Cache-Control: no-store`。

## 8.13 Gate 0 OpenAPI 契约基线

- `openapi/openapi.yaml` 是唯一 REST 契约事实源；API 启动时读取该文件，Swagger UI、
  `/docs/openapi.json` 与 `/docs/openapi.yaml` 均从同一文档提供，不再从装饰器生成另一份子集。
- Redocly 在本地 `pnpm openapi:lint` 和 CI 中执行 OpenAPI 3.1、引用、operationId 与结构校验。
  所有 endpoint 都有摘要、Tag 描述和明确响应；结构、语义或未使用组件错误会阻断质量门。
  项目负责人尚未确认软件许可证，因此 `info-license` 暂时关闭；`operation-4xx-response` 不适用于
  liveness 等永远不应返回 4xx 的端点，也不作为全局规则。
- 契约测试解析并解引用文档，校验 64 个 path、137 个 schema、74 个唯一 operationId，
  验证所有 schema 示例，并把已实现的健康检查和 Problem Details 实际响应与契约对照。
- API 生产镜像必须携带 `openapi/` 目录；缺失或不可解析的契约会令 API 在绑定端口前启动失败。

## 8.14 契约生成方向

方向固定为 **OpenAPI → TypeScript 类型 → 运行时适配器**：

1. 只在 `openapi/openapi.yaml` 中定义公共 HTTP 结构；运行 `pnpm openapi:generate` 生成
   `packages/contracts/src/generated/openapi.ts`，该文件禁止手改。
2. `@socal/contracts` 从生成的 `components`/`operations` 导出稳定别名。Zod 仅作为运行时输入
   适配器，并以生成类型作为 `ZodType` 输出约束；不能另写一套独立接口。
3. Nest Controller 对已实现请求直接使用共享 Zod schema 与生成类型，不再维护 Swagger
   装饰器 DTO。Swagger 仍只服务 canonical OpenAPI。
4. `pnpm openapi:check` 在本地与 CI 重新生成到内存并检测提交文件漂移；OpenAPI 改动若未重新
   生成会阻断质量门。

数据库模型和内部领域对象不从 OpenAPI 生成；它们通过显式 application mapping 隔离，避免把
私有字段意外暴露为公共响应。

## 8.15 Listing 提交契约

`POST /listings/{listingId}/submit` 无请求体，必须携带强 Listing ETag 的 `If-Match` 和
16–128 字符的 `Idempotency-Key`。成功固定返回 202、`no-store`、新 ETag，以及前后内容/
审核状态、风险层、规则集版本、可空 caseId、发生时间和资源版本。响应不公开命中规则、
阈值或输入摘要。相同 actor/key/Listing 版本返回原结果；同 key 不同请求返回 409。
owner 范围外统一 404，受限账户 403，缺少/错误前置条件 400。

## 8.16 Admin Listing 审核契约

`GET /admin/moderation/cases` 固定 `listing-submission` 队列，默认 OPEN，limit 最大 50；priority、
riskTier 和 cursor 均严格校验。cursor 使用 HMAC 并绑定 actor、队列、状态与筛选，不能跨账号或修改
筛选重放。`GET /admin/moderation/cases/{caseId}` 返回强 ETag、不可变脱敏快照、首提 diff、稳定规则
证据、媒体扫描状态、发布者聚合和可用动作；所有 Admin 响应均 no-store。

`POST /admin/moderation/cases/{caseId}/actions` 要求 `If-Match`、`Idempotency-Key`、recent MFA 和
APPROVE/REQUEST_CHANGES/REJECT/ESCALATE 对应的标准原因码。精确重试返回相同投影；同 key 不同请求、
陈旧版本或并发处置返回 409。401/403/404 均使用通用 Problem Details，不暴露角色、案件或 PII。

## 8.17 ORG-002 成员生命周期契约

- `POST /organizations/{organizationId}/invitations` 要求 OWNER/ADMIN、严格非 Owner 角色和
  `Idempotency-Key`；成功返回 201、Location 和短效邀请投影。
- `PUT /organization-invitations/{invitationId}/accept` 只允许邀请绑定用户接受；过期返回 410，未知、
  撤销或非本人统一 404。`DELETE /organizations/{organizationId}/invitations/{invitationId}` 由
  OWNER/ADMIN 幂等撤销仍处于 PENDING 的邀请。
- `PATCH /organizations/{organizationId}/members/{memberUserId}` 要求强 membership ETag；仅允许
  ADMIN/EDITOR/BILLING/ANALYST，陈旧版本返回 409。同路径 DELETE 不能删除 self 或 Owner。
- `POST /organizations/{organizationId}/owner-transfer` 要求 `Idempotency-Key`、当前 OWNER 和近期
  MFA；响应是不可变 from/to/结果角色/时间凭据。所有写接口均 no-store、同源校验、Repository 再授权，
  且不接受邮箱、手机号、Owner role 或客户端声明的组织角色。

`/auth/mfa/enrollment`、`/auth/mfa/enrollment/verify` 和 `/auth/mfa/verify` 是普通 ACTIVE 用户的
自有 TOTP step-up 别名；不会授予平台角色，仍复用一次性恢复码、重放保护、限频和 Session rotation。

## 8.18 Listing 举报与申诉契约

- `POST /reports` 只接受登录用户对公开 Listing 的稳定原因和可选说明，必须带
  `Idempotency-Key`，返回 202 opaque receipt。精确重试或活动同目标去重返回同一资源并标记
  `deduplicated`；同键不同载荷返回 409，每账号小时配额返回 429。响应不包含举报者、证据正文或内部
  优先级。
- `POST /appeals` 只接受 Listing Owner 针对 30 天内可申诉的下架 Action，必须带
  `Idempotency-Key`，返回 202 receipt 与明确 deadline；同一 Action 只能创建一次。
- `GET /admin/moderation/reports|appeals` 和对应 `{id}` 详情要求 MFA moderator，使用有界签名 cursor、
  `no-store` 与强 Case ETag。详情包含脱敏快照、稳定原因和动作历史，但从契约层移除 reporter identity。
- 两个 `POST /admin/moderation/.../{id}/actions` 端点要求 recent MFA、`If-Match` 和
  `Idempotency-Key`。Report 动作是 DISMISS/REMOVE_CONTENT/ESCALATE；Appeal 动作是 UPHOLD/RESTORE，
  每个动作只接受配套原因码。失效角色、跨资源、原审核员复核、陈旧版本、键冲突和非法状态均返回
  通用 Problem Details，不暴露内部存在性或规则阈值。

---

<!-- source: docs\09-search-and-ranking.md -->

# 09. 搜索、推荐与排序

## 9.1 目标

搜索要解决双语、本地、结构化筛选、新鲜度和信任问题，而不是只做标题模糊匹配。系统必须能解释付费结果、快速下架违规内容，并在 OpenSearch 故障时保留有限核心能力。

## 9.2 索引设计

建议按版本建立 alias：

```text
socal_local_listings_read  -> socal_local_listings_vN
socal_local_listings_write -> socal_local_listings_vN
```

文档包含：

- id/type/status、locale、title/summary/body；
- category path、region path、城市别名；
- 结构化价格、属性、发布时间、过期时间；
- 模糊公开 geo point；
- owner/org 的公开可信信号；
- quality/trust/freshness 特征；
- isSponsored、campaign/placement 引用；
- content version 与 indexedAt。

内部风险分、真实地址、电话/邮箱和审核备注绝不进入公开索引。

## 9.3 文本分析

- 中文：合适的中文分词插件/分析器在目标 OpenSearch 环境验证；若托管环境限制，使用预分词字段 + ngram/edge-ngram 组合。
- 英文：标准/语言分析器、lowercase、词干和 stop words。
- 拼音/别名：为城市、分类、品牌和常见服务维护运营词典，如“蒙市/Monterey Park/MPK”。
- 同义词：版本化、审核、可回滚；避免把高歧义词全局合并。
- 输入规范化：全半角、繁简映射（仅搜索）、大小写、空白、常见单位和数字格式。
- typo 容忍：短词谨慎，手机号/邮编/型号不做宽松模糊。

原始用户内容保持原样展示；搜索规范化不是内容翻译或改写。

## 9.4 查询流程

1. 解析语言、城市上下文和 query intent。
2. 拼写/别名规范化，但保留原 query 用于分析。
3. 构造 bool 查询：公开状态、未过期、分类/地区/价格等过滤。
4. 多字段匹配：title > structured attributes > summary > body。
5. 计算函数分：文本相关性、发布时间衰减、质量、可信、距离。
6. 受控插入推广候选，明确标记且满足同样内容政策。
7. 返回聚合 facets、纠错/建议和不透明 cursor。
8. 记录去敏搜索事件和结果表现。

## 9.5 排序模型

首期可使用可解释线性/函数分数，不依赖 ML：

```text
natural_score =
  0.45 * normalized_text_relevance
+ 0.18 * freshness_decay
+ 0.12 * listing_quality
+ 0.10 * publisher_trust
+ 0.08 * geo_proximity
+ 0.07 * engagement_quality
- penalties
```

权重是起始假设，必须用离线标注和线上指标校准。`engagement_quality` 排除机器人、自己点击、误触和垃圾联系。处罚包括重复、低完整度、频繁编辑、举报确认、过期临近等。

推广结果单独计算资格与 rank，融合策略设置每页/每屏上限、广告间隔和 label。付费不能让已过期、违规或与查询无关内容出现。

## 9.6 索引同步

- Listing 事务写入 Outbox 事件，包含 id、version、operation。
- Worker 从 PostgreSQL 加载当前授权公开投影，不信任事件 payload 作为完整数据。
- 使用外部 version/乐观策略，旧事件不能覆盖新状态。
- 删除/下架优先高队列，目标 p95 10 秒内从搜索消失；一般更新目标 p95 60 秒。
- 定时 reconciliation 比较数据库和索引版本，修复丢失/漂移。
- 全量重建使用新索引、双写/追赶、校验、原子 alias 切换和旧索引保留窗口。

## 9.7 PostgreSQL fallback

`packages/database/sql/search_repository.sql` 提供有限 fallback：标题/正文 trigram/全文、状态/城市/分类过滤。它不替代 OpenSearch 的完整分词、facet 和规模能力。故障模式下应限制日期范围、结果数和复杂筛选，并明确提示。

## 9.8 热门搜索与建议

- 建议来源：运营词典、城市/分类、近期去敏查询、有效结果和点击质量。
- 不展示低频可能含个人信息的原始查询。
- 热门榜排除机器人、成人/违法/诈骗词和操纵流量。
- 榜单带时间窗口和城市维度；不是伪造的“实时数字”。
- 空查询建议优先城市、分类和安全内容。

## 9.9 SEO 与站内搜索边界

搜索组合页默认 `noindex,follow`。只有运营批准的城市+主分类聚合页生成稳定可索引页面。聚合页必须有独特介绍、足够有效内容、canonical 和过期处理，避免数百万薄页面。

## 9.10 搜索质量评估

离线：建立中英双语查询集和 relevance judgments，测 NDCG@10、MRR、Recall、零结果率。

在线：搜索到详情率、有效联系率、筛选使用、改写率、快速返回、举报率和推广点击质量。A/B 实验必须有样本、停止规则和负面指标，不仅追点击率。

---

<!-- source: docs\10-ui-ux-design-system.md -->

# 10. UI/UX 与设计系统

## 10.1 设计原则

1. **信息密集但有层级**：保留设想图的本地门户效率，避免每块都争夺注意力。
2. **移动先完成任务**：移动端不是压缩桌面首页，而是优先搜索、发布、消息和核心列表。
3. **信任可见**：更新时间、状态、验证、推广、地点精度和安全提示清晰。
4. **双语等价**：中文/英文均可完成操作，布局容忍英文变长。
5. **组件可运营**：首页模块、分类、城市、广告位由配置驱动，但组件类型受白名单约束。
6. **不伪装**：广告、置顶和推荐必须标识；模拟统计不能上线。

## 10.2 视觉基线

参考设想图的品牌特征：主蓝色、橙色强调、浅灰背景、白色卡片、紧凑间距和圆角阴影。建议 token：

```css
--color-brand-600: #1265e8;
--color-brand-700: #0b55c7;
--color-accent-500: #ff6a2f;
--color-danger-600: #d92d20;
--color-success-600: #138a52;
--color-text-900: #172033;
--color-text-600: #5e687a;
--color-surface: #ffffff;
--color-canvas: #f5f7fb;
--color-border: #e2e7ef;
--radius-sm: 6px;
--radius-md: 10px;
--radius-lg: 16px;
--shadow-card: 0 2px 12px rgba(24, 39, 75, 0.06);
```

实际 token 放在共享 UI 包，并以语义名而非页面特定名使用。深色模式不是 MVP，但颜色对比和系统放大必须通过。

## 10.3 字体与排版

- 中文字体栈优先系统无衬线，避免把字体文件打包到仓库。
- 正文最小 14–16px（移动端），辅助文本不得因追求密度降到不可读尺寸。
- H1 每页一个；卡片标题保持语义层级，不用视觉字号代替 heading。
- 金额、日期、面积和单位使用 locale formatter，禁止字符串随意拼接。
- 行高至少 1.4；可点击目标建议不小于 44×44 CSS px。

参考首页目前是视觉草图代码，包含较小文本与符号占位，正式实现必须按上述要求修正。

## 10.4 响应式布局

建议断点（组件应根据内容而非设备名称判断）：

| 范围      | 策略                                         |
| --------- | -------------------------------------------- |
| ≥1440     | 三栏门户：首页左快速发布、中主内容、右运营栏 |
| 1200–1439 | 收窄侧栏、部分模块重排                       |
| 768–1199  | 双栏或单栏，右栏下沉，导航可横向滚动         |
| <768      | 单栏、底部/紧凑导航、快捷发布入口固定可达    |
| <480      | 表单和卡片完全单列，避免横向数据表           |

移动首页优先顺序：搜索/地区 → 快速发布 → 核心分类 → 最新信息 → 城市/商家 → 运营模块。热门榜、行情和门户性模块可折叠或下沉。

## 10.5 组件清单

### 基础

Button、IconButton、Link、Input、Textarea、Select/Combobox、Checkbox/Radio、Switch、Badge、Avatar、Card、Divider、Skeleton、Alert、Toast、Dialog/Drawer、Tabs、Pagination/Cursor loader。

### 领域

- RegionPicker、GlobalSearch、SearchSuggestion。
- ListingCard、ListingRow、ListingStatusBadge、PriceDisplay、LocationPrecision。
- FilterBar/FilterDrawer、SortMenu、ResultCount、SponsoredSlot。
- PublisherCard、TrustSignals、ContactPanel、SafetyNotice。
- MediaUploader、MediaGallery、DynamicListingForm、DraftAutosaveIndicator。
- MessageThread、ConversationList、ReportDialog。
- BusinessCard、ProviderCard、RatingSummary。
- OrderSummary、PromotionPicker、AdDisclosure。
- ModerationQueue、RiskSignalList、AuditTimeline。

每个组件定义 loading/empty/error/disabled/focus/keyboard 状态，并拥有 Storybook 或等价可视测试（Gate 4 前完成）。

## 10.6 表单体验

- 动态表单由后端发布的 schema 版本驱动，前端组件映射使用白名单。
- 每步只收集当前决策必要字段；可选高级字段折叠。
- 草稿自动保存采用防抖、版本冲突提示和离线恢复。
- 服务端字段错误映射到具体控件，首个错误获焦并有汇总。
- 不用颜色单独表达错误；错误文本说明如何修复。
- 上传显示进度、扫描、失败、重试和删除；提交前检查 READY 状态。

`LIST-004` 已在 `/{locale}/post/rental/new` 落地首个真实切片：页面只消费已发布的 Rental
`CategoryFormSchema`，按白名单渲染控件；900ms 防抖队列以 `Idempotency-Key` 创建、强 ETag
`If-Match` 更新，并在 409 时明确要求用户装载服务器版本。浏览器恢复数据按 user + locale 分区、
限 250KB 且经过严格形状检查；离线时只保存在当前设备，恢复联网后继续服务端保存。字段错误有汇总、
首错聚焦和 live region，中文/英文及移动宽度由 Chromium E2E 覆盖。

图片上传只接受 JPEG/PNG/WebP、单图 20MiB、最多 20 张；客户端展示直传进度、SCANNING、
REJECTED、重试和移除状态，但只有 owner-scoped 状态端点确认 `READY` 后才把 UUID 写入草稿。
“移除”只解除草稿绑定，不把对象删除冒充已完成的数据删除工作流。

## 10.7 可访问性

- 全站键盘可操作，焦点顺序与视觉顺序一致。
- 跳转到主内容、地标元素、可见 focus ring。
- Modal/Drawer 管理焦点并支持 Escape；不滥用 ARIA。
- 搜索建议使用合适 combobox 模式；状态更新使用节制的 live region。
- 图片有用途明确的 alt；装饰图空 alt。
- 广告 label 对视觉和辅助技术都可识别。
- 自动化 axe 只是底线，关键流程需要键盘和读屏人工检查。

## 10.8 首页配置化

`schemas/homepage-layout.schema.json` 定义允许的模块类型、顺序、城市/语言和数据源引用。运营配置只选择已实现组件，禁止注入任意 HTML/脚本。配置发布具有 draft→preview→publish→rollback，前端按版本缓存。

## 10.9 设计图与真实产品的差异

设想图中的二维码、统计、评级、师傅头像、商家 logo 和广告均视为占位内容。生产实现必须使用授权素材和真实可解释数据。设计图大量采用中文小字号，正式页面应在保持信息密度的同时满足阅读、触控和英文长度要求。

## 10.10 站内通知中心

`NOTIF-001` 的 `/{locale}/account/notifications` 是私有、noindex、移动优先页面。页面先通过同源
Session 边界确认账号，再读取账号范围通知；提供未读总数、未读筛选、稳定分页和单条已读，不把通知
内容写入 URL、缓存或客户端持久存储。中文/英文文案不拼接翻译片段，时间以
`America/Los_Angeles` 展示；加载、错误、空态和状态更新使用节制的 live region，控件保持可见焦点与
至少 44px 触控目标。

`ORG-002` 扩展通知资源为 `ORGANIZATION_INVITATION`；Web parser 只接受契约白名单资源类型并显示本地化
“组织邀请”标签。接受/撤销仍通过受保护 API 完成，通知正文不拼接组织私有字段或联系方式。

---

<!-- source: docs\11-content-workflows-and-moderation.md -->

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

---

<!-- source: docs\12-monetization-payments-ads.md -->

# 12. 商业化、支付、广告与积分

## 12.1 商业化原则

商业化不能破坏内容质量和用户信任。所有付费曝光必须：先通过内容政策、明确标识、可证明履约、支持退款/争议处理，并与自然排序指标分开。

平台从正式公开上线日起的前 12 个自然月保持全站免费，不创建真实资金订单、不发起扣款，也不要求用户保存付款方式。免费期结束后仍不得按日期自动切换为收费；只有价格、条款、退款、税务、支付生产验证和运营准备全部通过，才可通过服务端 Feature Flag 审计启用。详见 ADR-0006。

## 12.2 产品 SKU

| 产品        | 计费方式      | 履约                                   |
| ----------- | ------------- | -------------------------------------- |
| 信息刷新    | 单次/包       | 更新受控排序时间，不修改原发布时间事实 |
| 分类置顶    | 时段          | 在指定城市+分类的置顶槽位              |
| 推荐信息    | 时段/展示     | 融合位，标“推广”                       |
| 首页广告    | 固定日期/库存 | 指定模块、设备和城市                   |
| 列表 Banner | 展示/时段     | 受频控和素材审核                       |
| 商家套餐    | 月/年订阅     | 档案增强、信息额度、分析等             |
| 师傅套餐    | 月/年订阅     | 推荐资格、线索工具等                   |
| 积分包      | 一次性        | 钱包 CREDIT，按规则消费/过期           |

首期避免复杂实时竞价。库存、价格和权益版本化；订单保存购买时快照，后续改价不影响历史订单。

## 12.3 订单状态

```text
PENDING → REQUIRES_PAYMENT → PAID → FULFILLED
    └───────────────→ CANCELLED
PAID/FULFILLED → REFUNDED / PARTIALLY_REFUNDED
```

内部 Order 与外部 Payment 分离。订单可因支付成功但素材未审核而停在 PAID；履约只有在资产和排期满足后进入 FULFILLED。

## 12.4 支付流程

1. 校验用户/组织权限、SKU、目标资源和库存。
2. 在数据库事务创建 Order、line items、price snapshot 和库存临时保留。
3. 使用 Order ID 作为幂等关联创建 Stripe 会话。
4. 浏览器返回仅展示处理中并轮询内部状态。
5. 签名 webhook 持久化、去重并更新 Payment。
6. 同一事务写账本/履约 Outbox。
7. Worker 执行推广/广告激活，写履约记录。
8. 失败可恢复；超时库存锁由 Worker 释放。

## 12.5 积分钱包与账本

钱包采用不可变 entry：CREDIT、DEBIT、HOLD、RELEASE、EXPIRE、ADJUSTMENT。每条包括 amount、currency/unit、source type/id、idempotency key、effectiveAt、expiresAt、actor 和 reason。

余额投影：

```text
available = credits + releases - debits - holds - expirations + adjustments
```

负余额默认禁止；退款应引用原 debit/credit，而不是删除旧记录。任何后台调整需要双人审核阈值和审计。积分不是现金，不暗示可提现，法律/会计定义需确认。

## 12.6 广告域模型

- `AdCampaign`：广告主、目标、预算/日期、状态。
- `Creative`：素材、落地页、语言、审核状态。
- `Placement`：首页 Hero 旁、右栏、列表间插等库存定义。
- `Booking/Flight`：campaign + placement + city/device/date。
- `DeliveryEvent/Aggregate`：合格 impression/click，不保存不必要 PII。

排期必须防止超卖；固定库存可使用数据库排他约束/时间范围冲突检查和短时 reservation。

## 12.7 展示和点击计量

- Impression 需满足最小可视条件和机器人过滤，不以服务端返回即计数。
- Click 通过受控 redirect 记录，验证目标 URL 白名单/安全性。
- 频次控制按匿名标识/用户和 campaign，遵守同意与保留策略。
- 报告区分 raw、filtered、billable；后续纠错可追溯版本。
- 不把敏感类别、私密消息或精确位置用于广告定向。

## 12.8 退款与争议

政策需覆盖：未开始、部分履约、内容违规下架、平台故障、广告主主动取消、支付 dispute。退款计算引用履约快照；自动退款和人工退款都通过同一用例、幂等和账本。

Stripe dispute 到达时冻结相关可退信用、通知 Finance，并保留必要证据。禁止通过删除订单来“修正”账目。

## 12.9 税务和收据

首期由产品/财税确认销售税、广告服务税务和发票要求。系统至少保存：法定商家信息版本、购买方信息、line item、金额、税、折扣、币种、付款/退款引用和收据 URL。不得自行计算未确认的税务规则。

## 12.10 风控

- 付款账户、组织和被推广资源必须关联。
- 高风险支付、快速多次失败、异常退款和卡测试限频。
- 广告落地页和素材持续扫描，批准后变更需重新审核。
- 促销优惠码有次数、主体、日期、SKU 和组合限制。
- 免费额度和积分发放也进入账本，防止后台无痕滥用。

## 12.11 商业化指标

订单转化、支付成功、履约启动时长、广告填充、有效曝光/点击、推广后的有效联系增量、退款/争议、商家续费、违规广告率。不能只优化营收而忽略举报、跳出和自然内容受损。

## 12.12 自动充值预留

未来资源名预留为 `/v1/billing/auto-top-up-policy`。该路径在 `COM-006` 完成前不写入 OpenAPI、不得注册路由。届时采用应用端口隔离业务策略与 Stripe 等 provider adapter，并满足：

- 用户逐人明确 opt-in，策略变更使用版本/ETag；支持立即暂停和删除。
- 配置阈值、固定充值额、周期/金额上限与币种；服务端实施硬上限和异常限频。
- 仅保存 provider payment-method reference，不接触或记录原始卡号/CVC。
- 每次触发创建独立 Order/Payment，以策略版本和触发窗口生成稳定幂等键。
- 签名 webhook、重放防护、乱序处理、失败退避、通知、对账和全局 kill switch 必须先通过测试。
- 免费期和未启用商业化时，服务端即使收到旧任务或重试也必须拒绝扣款。

---

<!-- source: docs\13-seo-i18n-accessibility.md -->

# 13. SEO、国际化与可访问性

## 13.1 SEO 目标

让搜索引擎发现高质量、仍有效的城市/分类/详情内容，同时避免搜索组合、重复信息、过期内容和低质量用户生成内容造成索引膨胀。

## 13.2 可索引页面矩阵

| 页面                         | 默认策略                                |
| ---------------------------- | --------------------------------------- |
| 首页、城市首页               | index, follow                           |
| 主分类城市聚合页             | 运营白名单后 index                      |
| 高质量已发布详情             | index，满足质量/新鲜度阈值              |
| 任意站内搜索与复杂筛选       | noindex, follow + canonical             |
| 草稿、预览、账户、消息、订单 | noindex, nofollow                       |
| 管理后台/API                 | 禁止抓取 + 鉴权                         |
| 过期详情                     | 视替代内容 410、404 或保留 noindex 页面 |
| 下架/删除                    | 404/410，不泄露原因                     |

## 13.3 元数据

每个模板定义 title、description、canonical、hreflang、Open Graph/Twitter、robots 和结构化数据。标题避免机械关键词堆叠；description 使用真实字段且限制长度。用户正文不能直接进入 meta 而不清洗。

建议：

```text
招聘聚合：洛杉矶招聘｜餐馆、仓库、办公室工作 - 南加生活网
租房详情：尔湾主卧出租，近 XXX｜$1,200/月 - 南加生活网
```

## 13.4 结构化数据

按真实内容选择 schema.org：

- `WebSite` + `SearchAction`（确认搜索 URL 可公开使用后）。
- `BreadcrumbList`。
- 招聘详情 `JobPosting`，只填真实、仍有效字段并在过期时移除。
- 商家 `LocalBusiness` 或更具体类型。
- 活动未来使用 `Event`。
- 商品/二手是否使用 `Product/Offer` 需确认内容质量和政策。

禁止为没有真实评价的页面伪造 aggregateRating。结构化数据与页面可见内容必须一致。

## 13.5 Sitemap

- 按语言、资源类型和日期分片，每片受 URL 数/大小限制。
- 仅包含 canonical、可索引、已发布且未过期资源。
- 资源状态变化后异步更新，周期性全量校验。
- sitemap index 暴露最近修改时间；不要把任意搜索 URL 放入 sitemap。

## 13.6 重复与过期处理

- Listing slug 带稳定短 ID，标题修改不产生多个可索引实体。
- 重复检测阻止/合并重复供给，canonical 不是解决业务重复的唯一手段。
- 过期后短期可保留有价值详情并明确状态、推荐替代；无价值或违规内容返回 410/404。
- 城市别名和语言路径使用规范 canonical/301，避免 `/la`、`/los-angeles` 多份内容。

## 13.7 国际化架构

- Locale：`zh-Hans` 与 `en-US`；路由可简化展示为 `/zh-Hans`、`/en`，内部使用标准 locale。
- 文案采用 key + ICU MessageFormat/等价方案，支持复数、数字和日期。
- 翻译资源按 domain 分包：common、auth、listings、search、commerce、admin。
- 用户内容显示原语言，可提供“机器翻译”作为明确标记的辅助视图，不能覆盖原文。
- 分类、城市、政策和 SEO 文案由运营维护正式翻译版本。
- 语言选择写入用户偏好/cookie；不要只依赖浏览器自动重定向。

## 13.8 格式化

统一使用 `Intl`：日期、相对时间、货币、数字、面积、距离。数据库存 UTC 和标准单位；展示时按 locale 转换。中英文的地址顺序和单位不可硬编码拼接。

## 13.9 可访问性目标

目标 WCAG 2.2 AA：

- 语义结构、地标、标题顺序和跳过链接。
- 全键盘操作、可见焦点、合理触控目标。
- 文本/组件对比度、缩放 200% 和 reflow。
- 表单 label、说明、错误关联与状态播报。
- 不依赖颜色/图标单独表达状态。
- 动画尊重 reduced motion。
- 图片 alt、视频字幕（后续）、广告可识别。
- 中英文 `lang` 属性正确，混合语句必要时局部标注。

## 13.10 测试与发布门槛

- Lighthouse/性能预算作为趋势，不是唯一判断。
- 使用 axe 自动化检查主要模板。
- 每个 Gate 对关键流程做键盘手测。
- Beta 前用至少一种主流屏幕阅读器检查搜索、发布、消息和支付。
- Search Console/日志监控索引覆盖、软 404、重复 canonical 和结构化数据错误。
- SEO 变更灰度并跟踪自然流量之外的质量指标，避免靠薄内容换流量。

---

<!-- source: docs\14-security-privacy-compliance.md -->

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
- 重复/并发过期：到期查询有界并使用 `SKIP LOCKED`；只允许 PUBLISHED + approved 五类 Listing 和当前
  version 更新。Audit/Outbox 与状态原子提交，重复轮询不复制证据。

## 14.17 ORG-002 成员与 Owner 转移威胁和缓解

- 邀请枚举/PII：输入只允许 ACTIVE user UUID 和非 Owner 角色；响应、通知 payload、Audit/Outbox
  metadata 不含邮箱、手机号或 token。跨组织、非受邀用户和撤销邀请统一按不可用资源处理。
- 重复/并发接受：组织行和邀请行使用一致锁顺序；PENDING 部分唯一索引、状态约束和事务内
  membership 写入使重复投递收敛，过期邀请惰性转为 EXPIRED。
- 最后 Owner 丢失：通用角色/删除接口拒绝 Owner，数据库 deferred constraint trigger 独立于应用层
  检查事务提交后的 Owner 数量；转移采用先提升目标、再降级 actor。
- 权限提升/重放：Owner 转移要求当前数据库 membership、MFA 强度、recent-MFA 和精确幂等请求摘要；
  普通用户的 `/auth/mfa/*` 只管理自身 credential 并原子旋转 Session，不赋予组织或平台角色。
- Worker 重复/毒事件：邀请通知只接受版本 1 的最小 Outbox envelope，使用 eventId advisory lock 与
  唯一通知键；无效 schema/template 进入永久失败，瞬时数据库失败保留队列重试。

## 14.18 LIST-006 招聘安全与就业政策

- Job 创建/更新要求完整、正数且同周期的薪资上下限；服务层校验 `min <= max`，数据库 check
  防止 repository 旁路产生不一致范围。
- 发布者必须明确确认职位条件、薪资真实且无歧视性要求。确认值仅供 owner/审核证据使用，
  `OWNER_ONLY` 投影规则阻止其进入公开 API。
- v3 风险规则对少量高置信疑似歧视措辞只产生人工审核命中，不保存原文、不自动判定违法，
  以减少错误处罚和敏感内容扩散。
- `visaSupport` 明确标为发布者声明，不视为平台核验或移民法律意见；表单不收集申请人的国籍、
  年龄、证件或其他非必要 PII。
- Web 提交复用 BFF 精确 allowlist、强 ETag 和 actor-scoped 幂等键；Job 草稿、媒体和恢复数据仍
  按账号隔离，公开投影省略联系方式、精确坐标和 owner-only 字段。

## 14.19 LIST-007 转让、二手与服务安全边界

- Transfer 创建/更新要求正数 FIXED 要价、非负租金、0–1200 的整数剩余租期和非空转让原因；
  应用层与数据库约束双层校验。分类策略始终人工审核，发布者还必须确认财务数字未经平台验证。
- Secondhand 只接受 FIXED/NEGOTIABLE/FREE；交付方式不得为空，发布者必须确认合法来源和禁售品政策。
  v3 `PROHIBITED_GOODS_RISK` 对高置信疑似禁售品只保存规则代码/版本/严重度和命中字段名，
  送高优先人工审核，不保存原文、不自动处罚。
- Service 只接受 HOURLY/FIXED/NEGOTIABLE，服务半径限制 1–100 英里且可用时间不得为空。
  `licenseNumber` 和政策确认是 `OWNER_ONLY`；公开 `licenseStatus`、保险和紧急服务均为发布者声明，
  不是平台核验或专业建议。
- 三类详情与 Listing 一对一，应用服务和 Repository 双层执行类型严格耦合，数据库约束独立保护各类
  核心字段；跨类型明细、缺失明细、未知动态字段均失败关闭。
  公开投影省略联系方式、精确坐标、执照号、政策确认和审核证据。

## 14.20 MOD-002 举报与申诉威胁和缓解

- 举报枚举/报复：只对当前可公开 Listing 接收举报，self-report 失败关闭；公共 receipt 与 Admin
  案件 DTO 均不包含 reporter identity，Audit 只记录 actor 受限引用，不把举报者写入用户通知或
  Outbox payload。
- 恶意批量/重复举报：ACTIVE Session、同源校验、每账号每小时 10 条新举报、actor-scoped 幂等摘要、
  target advisory lock 和活动部分唯一索引共同收敛；重复举报不能直接触发处罚。
- 敏感证据扩散：详情有 2000 字上限并拒绝控制字符；不可变快照剔除联系方式、地址、精确点位和
  owner-only/未知动态字段。生产 PostgreSQL 依基础设施合同启用静态加密，读取仅限当前 MFA 平台
  moderator；日志、指标、Problem Details 和通知不包含证据正文。
- 审核账号滥用：队列/详情要求 MFA 和当前角色，动作额外要求近期 step-up、强 ETag、幂等摘要及
  事务内 Session/角色复核；稳定动作/原因组合阻止任意字符串处置。
- 申诉利益冲突/覆盖：仅 Owner 可对 30 天内的下架动作申诉一次；原审核员在 Service 和 Repository
  两层拒绝，独立审核员的维持/恢复使用 Listing/Case 行锁与版本检查，结果、Audit、不可变 Action、
  Outbox 和状态在同一事务提交。

---

<!-- source: docs\15-performance-reliability.md -->

# 15. 性能、容量与可靠性

## 15.1 规划目标

下列是首期 SLO/预算，Beta 前须压测校准：

| 指标                 | 目标          |
| -------------------- | ------------- |
| 公开 Web/API 可用性  | 99.9% / 月    |
| 后台可用性           | 99.5% / 月    |
| API GET p95/p99      | 300ms / 900ms |
| API mutation p95/p99 | 700ms / 2s    |
| OpenSearch p95       | 450ms         |
| 首页 LCP p75         | 2.5s          |
| INP p75              | 200ms         |
| CLS p75              | 0.1           |
| 下架传播至搜索 p95   | 10s           |
| 一般索引新鲜度 p95   | 60s           |
| 通知入队 p95         | 30s           |
| RPO / RTO            | 15m / 2h      |

SLO 不包含用户网络和明确排除的第三方时延，但用户旅程仍需端到端监控。

## 15.2 容量模型

起始假设：100k 用户、500k Listing、10k DAU、100 RPS 持续/500 峰值、消息和媒体随增长。容量计划至少估算：

- 行数、索引大小、数据库连接和 IOPS。
- 搜索文档大小、分片数、查询/索引速率。
- 媒体原图/变体、带宽和生命周期。
- Redis 内存、queue backlog 和 job payload。
- 日志/指标/追踪/分析事件量。

禁止把大正文、图片二进制、完整 webhook payload 长期塞入 Redis/队列。

## 15.3 Web 性能预算

- 初始 HTML 压缩后尽量 <100KB；首屏 JS 按路由拆分，公开详情避免重客户端框架逻辑。
- 图片用响应式尺寸、现代格式、明确 width/height 和 CDN；Hero 不阻塞关键文本。
- 第三方脚本默认不加载，需同意/性能评审。
- 字体使用系统栈或最少授权 webfont，避免 FOIT。
- 首页分块缓存，非首屏门户模块延迟加载但保持 SEO 关键内容服务端输出。
- 监控真实用户 CWV，不只依赖本地 Lighthouse。

## 15.4 API 性能

- 列表仅选择 DTO 所需列，避免 N+1。
- 每个 endpoint 有最大 page size、body size、日期范围和查询复杂度。
- 使用连接池并按实例数计算总连接，避免扩容压垮数据库。
- 慢查询采样、EXPLAIN 评审和索引预算。
- 外部调用设置 connect/request timeout、有限重试、抖动和 circuit breaker。
- 不在请求中同步发送邮件、重建索引或处理大图。

## 15.5 队列可靠性

- 至少一次投递，所有 job 幂等。
- 指数退避 + jitter，按错误类型区分可重试/永久失败。
- 有限 attempts 后进入 DLQ，保留失败上下文但不包含多余 PII。
- 指标：waiting/active/delayed/failed、oldest age、duration、retry、DLQ。
- backpressure：暂停低优先任务、限制生产速率、水平扩 Worker。
- 定期 reconciliation 修复“数据库成功但副作用缺失”。

`EVT-001` 已实现有界 batch、短租约、`SKIP LOCKED` 多实例并发领取、指数退避 + eventId 确定性 jitter、
最大 attempts 和 BullMQ eventId jobId。每次确认都匹配 claim attempt，避免旧 worker 覆盖新租约；
PENDING 事件年龄和 publish/retry/failed/stale 结果直接进入低基数指标。DLQ 管理、人工重放和跨系统
reconciliation 仍属于 `EVT-002`。

## 15.6 数据库可靠性

- Multi-AZ、PITR、自动备份、存储自动扩展阈值。
- 写主 + 可选只读副本；强一致账户/订单不盲目读副本。
- 所有事务短小，明确隔离级别；并发库存/账本使用约束与锁而非应用猜测。
- 迁移前检查锁和表大小，长变更分阶段。
- 每季度恢复演练，记录实际 RTO/RPO。

## 15.7 搜索可靠性

- 索引 alias、版本、全量重建和回滚。
- 分片大小目标基于实测，首期避免过度分片。
- 查询 timeout、terminate/结果窗口限制、昂贵聚合白名单。
- 索引写入与查询可分优先级；下架事件最高优先。
- 监控 cluster health、heap、磁盘水位、rejections、latency、refresh lag。

## 15.8 灾难与故障演练

至少演练：

- RDS 主故障/恢复；
- OpenSearch 整体不可用与重建；
- Redis 数据丢失、队列恢复、Outbox 重投；
- S3 误删/版本恢复；
- ClamAV 不可用/超时、重复媒体事件和对象在 HEAD 后被替换；暂时故障重试，内容 hash 不一致永久拒绝；
- Stripe webhook 延迟/重复/乱序；
- DNS/CDN/WAF 配置错误；
- 错误迁移和应用回滚；
- 密钥泄露与会话全局撤销。

## 15.9 Error Budget

99.9% 月可用性约对应约 43 分钟不可用预算。消耗过快时冻结非必要发布，优先可靠性任务。错误预算策略需在运营成熟后细化，但从首日记录 SLI。

## 15.10 性能测试

- k6/等价工具覆盖：首页/API 列表、详情、搜索、登录、发布、消息和 webhook。
- 数据规模接近目标，避免空数据库压测。
- 逐步负载、突发、耐久、队列积压和依赖故障测试。
- 记录版本、数据集、环境、阈值和瓶颈；性能结果可重复。

---

<!-- source: docs\16-infrastructure-devops.md -->

# 16. 基础设施、环境与 DevOps

## 16.1 环境

| 环境       | 用途                                | 数据             |
| ---------- | ----------------------------------- | ---------------- |
| local      | 单人开发，Docker Compose 依赖       | 生成/种子数据    |
| preview    | PR 临时 Web/Admin，API 可共享或隔离 | 合成数据         |
| dev        | 团队集成                            | 合成/匿名数据    |
| staging    | 生产等价、迁移/压测/演练            | 合成或严格去标识 |
| production | 用户服务                            | 真实数据         |

生产与非生产使用独立云账号/项目、网络、密钥和数据。禁止把生产数据库快照直接恢复到开发。

## 16.2 AWS 生产拓扑

- Route 53：DNS。
- CloudFront：静态/媒体/公开 Web 加速。
- AWS WAF + Shield 基线：机器人、速率、常见攻击和紧急规则。
- ALB：Web/Admin/API 路由与健康检查。
- ECS Fargate：web、admin、api、worker 多 service。
- RDS PostgreSQL/PostGIS Multi-AZ：业务主数据。
- ElastiCache Redis：缓存/队列（根据 BullMQ 兼容性验证部署模式）。
- OpenSearch Service：搜索读模型。
- S3：public-derived media、private quarantine、restricted verification、logs 分桶/前缀。
- SES：邮件；短信适配器可用 SNS/Twilio。
- Secrets Manager/SSM + KMS：密钥和配置。
- CloudWatch/OTel collector：日志、指标、追踪。
- ECR：镜像仓库，开启扫描和不可变标签。

Terraform 蓝图见 `infra/terraform/`。生产实施前需要成本、安全和网络评审。

API 任务角色只需要 private quarantine 的受限 `PutObject`/`HeadObject`；Worker 才能读取 quarantine、
连接 ClamAV 并写 processed-media bucket。两桶都必须启用 Block Public Access、默认加密和生命周期，
不能用同一公开前缀假装隔离。`MEDIA-002` 的本地 Compose 会幂等建立两个 anonymous-none 桶并等待
ClamAV healthy；生产 public-derived 的 Terraform/IAM、独立无 Cookie CDN 和删除/对账策略仍须在发布
基础设施切片落实。restricted-verification 的独立 KMS、访问审计和短保留由 MEDIA-003 完成。

## 16.3 网络

- 公开子网仅 ALB/NAT（若使用）；应用、数据库、Redis、OpenSearch 在私有子网。
- Security Group 以 service-to-service 最小端口，不使用广泛 CIDR。
- ECS 任务出站通过 NAT/VPC endpoint；对 S3/ECR/Logs 使用 endpoint 降低暴露和成本。
- Admin 可在公共 ALB 后使用 SSO/访问代理和 WAF，或使用独立受限入口。
- 数据库无公网地址；运维通过受审计 SSM/临时访问。

## 16.4 容器

- 多阶段构建、非 root、只读根文件系统（可行时）、最小基础镜像。
- 固定 Node 主版本和 lockfile；生产依赖 `--frozen-lockfile`。
- 镜像包含版本/commit/build time OCI labels，不包含 `.env`。
- Web/Admin/API/Worker 独立镜像或共享基础层，按变化和安全权衡。
- 每个进程实现 `/health/live`、`/health/ready`；readiness 检查关键依赖但避免雪崩。

## 16.5 CI 流水线

PR：

1. 静态架构检查与 secret scan。
2. 安装锁定依赖。
3. format、lint、typecheck。
4. Prisma validate/generate，迁移静态检查。
5. unit/contract/integration；必要时启动 PostgreSQL/Redis/OpenSearch。
6. Web/Admin/API build。
7. OpenAPI/JSON Schema 校验、依赖/许可证、SAST/IaC/container scan。
8. Preview 和 Playwright smoke（适用时）。

主分支：构建签名镜像、推 ECR、部署 dev；通过 Gate 后提升同一 artifact 到 staging/prod，不重新构建。

### 16.5.1 GitHub 合并保护

远程仓库创建后，`main` ruleset/branch protection 至少要求以下两个 GitHub Actions check：

- `Static, contracts, tests, and build`
- `Build non-root application images`

同时要求 pull request、解决全部 review conversation，并禁止普通贡献者绕过。当前个人私有仓库只有一名
维护者，不能要求作者自我批准；增加第二维护者后必须再开启至少一名批准者、CODEOWNERS 审查和推送新提交后
撤销过期批准。平台管理员应保存一次失败 PR 被阻止和一次完整绿色 PR 可合并的证据。本地
`pnpm ci:workflow:check` 只能验证 workflow 内容，不能替代 GitHub 执行和 ruleset 证据。

仓库 `songjiahang676-cell/c4-local-life` 已由 PR #1 和 GitHub Actions run `30186346943` 证明两项
check 可完整通过，早期 runs `30185510707`、`30185679624` 保留了干净环境缺陷及修复证据。
项目负责人于 2026-07-25 明确授权将仓库公开，随后 `main` branch protection 配置为：必须经 PR、
两项 required checks、strict/up-to-date、解决全部 conversation、管理员不可绕过、禁止强推和删除。
临时 PR #2/run `30187032798` 故意引入一个内部断链，质量检查失败且 GitHub 返回
`mergeStateStatus=BLOCKED`；验证后 PR 已关闭、临时分支已删除。由此 FND-003 的失败阻止和绿色可合并
两类外部证据均完整。

## 16.6 CD 与发布

- 数据库采用向前兼容迁移，先 migration job 再应用 rollout。
- ECS rolling 或 blue/green；健康检查、错误率和 latency 自动停止。
- Feature Flag 将部署与功能发布分离。
- 生产审批记录版本、迁移、风险、回滚、负责人和监控窗口。
- 回滚代码前确认数据库向后兼容；不能简单回滚的变更采用 roll-forward。

## 16.7 配置

- 非敏感配置按环境注入，敏感值来自 Secret Manager。
- `packages/config` 在启动时做 schema 校验；缺失关键配置直接 fail fast。
- Feature Flag 具有 owner、默认值、目标环境、到期日和删除任务。
- 城市、分类、首页编排、审核规则属于版本化业务配置，不硬编码在环境变量。

## 16.8 数据库迁移部署

- 只运行一个迁移作业，使用数据库 advisory lock/平台机制防并发。
- 部署前自动备份/恢复点，检查迁移 SQL 的锁、扫描和回滚策略。
- 大回填由可观测 Worker 分批执行，不占用发布超时。
- 迁移成功和应用兼容验证后再扩大流量。

## 16.9 成本控制

- 开始阶段选择合理小规格并设自动扩展/告警，不盲目预留大集群。
- CloudFront/S3 图片变体减少原图流量；日志按级别和保留分层。
- OpenSearch 规模和分片需实测，通常是主要固定成本之一。
- 非生产环境定时缩容/停机，Preview 自动过期。
- 每月按服务、环境、功能标签审查成本与单位经济指标。

## 16.10 基础设施事实源

Terraform 是云资源事实源；禁止长期手工改生产。紧急控制台修改必须记录并尽快回写 IaC。AWS Organizations/CloudTrail/Config/GuardDuty 等组织级能力由平台安全方案补齐。

---

<!-- source: docs\17-observability-analytics.md -->

# 17. 可观测性与产品分析

## 17.1 三大信号

- **Logs**：结构化 JSON，事件、级别、service、env、version、requestId、traceId、actor type/hashed id、resource type/id、duration、outcome。
- **Metrics**：RED（rate/errors/duration）、USE（utilization/saturation/errors）、业务与队列指标。
- **Traces**：Web/API/DB/Redis/OpenSearch/worker/provider 关键 span，采样策略保护成本和隐私。

采用 OpenTelemetry 语义与导出接口，后端供应商可替换。

## 17.2 日志规范

不得记录：密码、OTP、session/token、完整 cookie、卡数据、验证材料、消息正文、未脱敏手机号/邮箱/精确地址。必要标识使用稳定但可轮换的 hash 或内部 ID。

错误日志包含错误分类和安全的上下文，不把 provider 原始响应直接返回用户。高频 4xx 采样，安全事件保留必要字段。

## 17.3 核心指标

### 平台

- HTTP 请求率、错误率、p50/p95/p99、实例 CPU/memory、连接池、GC。
- PostgreSQL 连接、CPU、IO、锁、replica lag、慢查询、存储。
- Redis memory、eviction、latency、connections。
- OpenSearch health、heap、disk、search/index latency、rejection。
- S3/媒体扫描失败、CDN hit ratio。

### 业务

- listing draft/submitted/published/rejected/expired 数量和漏斗。
- 审核队列年龄、SLA、误杀/申诉恢复。
- 搜索零结果、有效联系率、索引延迟。
- 会话创建、消息失败、垃圾/举报率。
- 订单/付款/退款/争议、履约延迟、账本 reconciliation。
- 广告库存、活动状态、合格展示/点击。

### Worker

每队列 waiting、active、delayed、failed、oldest age、duration、attempts、DLQ 和吞吐。

Outbox dispatcher 额外暴露：

- `socal_outbox_oldest_pending_age_seconds`：最老 PENDING 事件年龄；
- `socal_outbox_dispatch_total{outcome}`：仅允许 published/retry/failed/stale；
- `socal_outbox_poll_failures_total`：数据库领取或状态写回失败。
- `socal_media_processing_total{outcome}`：仅允许 ready/rejected/stale，区分终态和重复/乱序事件。
- `socal_notification_events_total{outcome}`：仅允许 created/duplicate/ignored/
  recipient_unavailable/failed，不使用 user、Listing、event 或模板 key 作为 label。

事件类型、aggregateId、eventId 和 payload 不作为指标标签；结构日志只保留内部 eventId、attempt、
有界 outcome/errorCode，不序列化 payload 或 provider 原始错误。
媒体指标不使用 mediaId、对象 key、hash、MIME、ClamAV signature 或 rejection code 作为 label；
Worker 的通用 job duration/failure 指标承担依赖超时/重试可见性。

## 17.4 告警

告警必须可操作，绑定 Runbook 和 owner。建议：

- Sev0/1：公开站大面积失败、数据损坏、支付重复、账户接管、RDS 不可用。
- Sev2：错误预算快速消耗、搜索不可用、队列延迟超 SLO、审核高危积压。
- Sev3：单个 provider 失败、成本异常、非关键任务延迟。

避免单点瞬时噪声；使用多窗口 burn-rate、持续时间和依赖关联。告警中不包含 PII。

## 17.5 Dashboard

- Executive：可用性、核心漏斗、内容安全、收入/退款。
- On-call：服务 RED、依赖、队列、近期部署。
- Search：latency、zero-result、freshness、cluster。
- Moderation：队列、SLA、规则、申诉。
- Commerce：订单、webhook、履约、reconciliation。
- Growth/SEO：可索引资源、抓取、CWV、获取与留存。

## 17.6 分析事件

`schemas/analytics-event.schema.json` 定义公共 envelope：event name/version、occurredAt、anonymous/user/session id、locale、region、page、properties 和 consent state。

事件命名示例：

```text
homepage_viewed
search_submitted
search_result_opened
listing_draft_created
listing_submitted
listing_published
contact_revealed
conversation_started
message_sent
report_submitted
promotion_checkout_started
order_paid
ad_impression_qualified
```

属性 schema 版本化，不采集自由文本 query 之外不必要敏感内容；搜索词需做保留与低频隐私控制。

## 17.7 数据质量

- 定义 source of truth 和去重 key。
- 客户端事件可能丢失/重复，关键支付/发布指标以服务端事件为准。
- Bot、员工、测试流量和自交互单独标识。
- 事件发布前有 schema 验证；破坏性字段变化新增版本。
- 每日检查量级突变、空字段、时间漂移和业务对账。

## 17.8 实验

Feature Flag 与实验分开建模，但可关联。实验定义 hypothesis、primary/guardrail metric、targeting、sample、duration、stopping rule 和 owner。严禁只看点击率而忽略举报、有效联系、退款和性能。

## 17.9 隐私与保留

分析标识尊重 consent/opt-out；不跨目的滥用。原始事件短期保留，聚合长期保留；删除请求要能解除/删除用户标识。第三方分析脚本需安全、隐私和性能评审。

## 17.10 当前实施基线

`OBS-001` 的结构日志、Prometheus RED/Worker 指标、W3C Trace 传播、OTLP 导出接口和 PII 脱敏测试记录在 [`observability-baseline.md`](./docs/observability-baseline.md)。Dashboard、SLO、告警、Collector 部署和正式采样策略属于 `OBS-002`/发布 Gate，不在本基础切片中伪造完成。

---

<!-- source: docs\18-testing-quality.md -->

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

统一框架、数据库 URL 防误用规则、事务回滚示例和显式命令见 [`database-integration-testing.md`](./docs/database-integration-testing.md)。每个测试必须通过同一个 `TransactionClient` 完成准备、Repository 调用和断言；成功与失败路径均由框架回滚。CI 设置 `DATABASE_INTEGRATION_URL`，因此不允许把 integration skip 当成 Gate 通过。

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

---

<!-- source: docs\19-delivery-roadmap.md -->

# 19. 交付路线与里程碑

## 19.1 方法

以垂直切片和质量 Gate 交付。时间取决于团队规模，本章提供相对顺序和建议周期，不承诺固定日期。建议核心团队 6–10 人：产品、设计、2–4 全栈/后端、前端、QA/SDET、平台兼职、运营审核负责人。

## 19.2 Gate 0：工程基础（建议 2–3 周）

范围：

- Monorepo、lockfile、CI、环境校验、Docker/本地依赖。
- 统一日志、错误、请求 ID、OpenAPI、配置、Feature Flag 基础。
- PostgreSQL/Prisma migration、种子、测试容器。
- Web/Admin/API/Worker 健康检查和最小部署。

退出标准：干净环境可重复安装/构建；CI 通过；staging 可部署；备份/密钥/日志基线存在。

## 19.3 Gate 1：身份与主数据（建议 3–4 周）

- OTP/会话、用户资料、安全设备。
- 组织与成员角色。
- 地区、分类、表单 schema、首页配置版本。
- 媒体预签名、扫描和安全变体。
- Admin 登录、MFA 和权限骨架。

退出标准：身份和对象级授权负面测试通过；分类配置可回滚；上传不直接公开原件。

## 19.4 Gate 2：分类信息闭环（建议 5–7 周）

先实现 Rental 或 Job 的完整切片，再推广到五类：

- 草稿/自动保存、动态表单、媒体、预览。
- 提交、自动规则、人工审核、发布、编辑、过期。
- 公开列表/详情、用户中心管理。
- 通知和审计。

退出标准：五类核心流程和状态机通过；运营能处理提交/举报；无越权；移动端可完成发布。

## 19.5 Gate 3：搜索与增长基础（建议 3–4 周）

- Outbox、索引 Worker、OpenSearch mapping/alias/rebuild。
- 双语搜索、城市/分类/价格/地理筛选。
- 首页真实数据源、聚合页、SEO、sitemap、结构化数据。
- 热门词与搜索质量仪表盘。

退出标准：索引新鲜度和下架传播达标；相关性样本通过；无薄页规模化索引。

## 19.6 Gate 4：互动与信任（建议 4–5 周）

- 收藏、会话、消息、通知偏好、屏蔽/举报。
- 商家和师傅档案、验证结论、评价资格。
- 信任标签、安全提示和反垃圾。
- 客服/审核工作台增强。

退出标准：消息滥用限频、隐私访问和举报流程通过；师傅/商家信息可运营。

## 19.7 Gate 5：商业化（建议 4–6 周）

- SKU、价格、订单、Stripe、webhook receipt。
- 积分账本、推广履约、固定广告库存和素材审核。
- Finance/Ad Ops 后台、退款和对账。

退出标准：重复/乱序 webhook 测试；账本零差异；广告明确标记；退款可审计。

## 19.8 Gate 6：Beta 与生产就绪（建议 3–5 周）

- 可观测性、SLO、容量/故障/恢复测试。
- 安全审计、隐私流程、政策和运营 Runbook。
- 数据导入（如有）、SEO 发布、客服培训、内容种子。
- 小城市/白名单发布者灰度、Feature Flag、回滚。

退出标准见 `docs/22-acceptance-criteria.md`。建议先 Irvine/SGV 或受控分类 Beta，而不是首日开放所有城市/类别。

## 19.9 Phase 2/3

Gate 6 稳定后再规划优惠、问答、论坛、活动、供应商、订阅、推荐和 App。每项必须重新做内容政策、运营容量和法律评审，不能仅因为首页设想图有入口就默认启用。

## 19.10 依赖与关键路径

关键路径：基础 → 身份/分类/媒体 → Listing 状态机/审核 → 搜索/SEO → 互动 → 支付/广告 → 生产治理。Admin、审核和安全不是“最后再做”的横向工作，必须随每个垂直切片完成。

详细可执行任务见 `tasks/BACKLOG.csv` 和 `tasks/EPICS.md`。

---

<!-- source: docs\20-operations-runbook.md -->

# 20. 运营与故障处置 Runbook

## 20.1 值班准备

每个生产服务、队列和关键业务能力必须有 owner、Dashboard、告警和 Runbook。值班人员能访问只读观测和经过授权的处置工具，但不持有共享永久管理员凭据。

发布时记录：版本、commit、镜像 digest、迁移、Feature Flag、负责人、开始/结束、异常和回滚点。

## 20.2 事件分级

| 等级 | 示例                                           | 响应                               |
| ---- | ---------------------------------------------- | ---------------------------------- |
| Sev0 | 大规模账户/支付/数据完整性事故                 | 立即全员、冻结风险写入、最高负责人 |
| Sev1 | 公开站不可用、RDS 故障、支付重复、重大隐私泄露 | 5–15 分钟确认，持续指挥            |
| Sev2 | 搜索不可用、队列严重积压、部分功能失败         | 30 分钟内处理                      |
| Sev3 | 单 provider、非关键任务、个别错误升高          | 工作时段处理                       |

先保护用户和数据，再恢复服务；不为降低错误率而删除证据。

## 20.3 通用事件流程

1. Acknowledge，指定 Incident Commander、技术负责人和沟通负责人。
2. 建立时间线和单一沟通频道。
3. 判断影响：用户、城市、数据、支付、隐私、安全。
4. Stop the bleeding：Feature Flag、WAF、暂停队列/推广、只读、回滚。
5. 保存日志、审计、webhook、数据库证据。
6. 修复/恢复，逐步放量并监控。
7. 用户/合作方/监管沟通由授权人员决定。
8. 24–72 小时内无责复盘，产生 owner 和期限。

## 20.4 API 错误率/延迟升高

- 检查近期发布、实例、CPU/memory、DB pool、慢查询、Redis/OpenSearch/provider。
- 若单 endpoint，限流或关闭非关键功能；不要全站重启掩盖根因。
- 回滚时确认 migration 向后兼容。
- 扩容 API 前检查数据库总连接和下游容量。

## 20.5 PostgreSQL 故障

- 确认 RDS 事件、连接、存储、锁、replica/Failover。
- 停止大回填/非必要写入，必要时进入只读/维护。
- 不手工 kill 未识别事务；记录 session/query。
- Failover 后验证 schema version、Outbox、支付和搜索同步。
- 从备份恢复时在隔离环境验证，再决定切换；记录实际 RPO/RTO。

## 20.6 OpenSearch 故障

- 切换搜索降级模式，保留详情/发布。
- 检查 health、磁盘水位、heap、rejection、mapping explosion。
- 暂停低优先索引，优先下架事件。
- 无法恢复时创建新索引全量重建、追赶事件、校验后切 alias。
- 不把索引恢复数据写回 PostgreSQL。

## 20.7 Redis/队列故障

- API 对缓存降级；关键 auth/rate-limit 根据安全策略 fail closed。
- Outbox 保留待发送事件，不直接丢弃。
- Redis 恢复后先启动少量 Worker，监控积压和 provider 限额，再扩容。
- 重复 job 预期存在，检查幂等而非清空队列。
- DLQ 重放要按错误原因、代码版本和批次执行。

## 20.8 支付/webhook 事故

- 若签名/重复/履约异常，暂停新商业化订单而非影响免费功能。
- 比较 Stripe 状态、webhook receipts、Payment、Order、Ledger、Fulfillment。
- 不手工直接改余额；通过修复用例和 adjustment/compensation。
- 重放 webhook 前确认处理器幂等。
- 可能重复收费/履约属于 Sev1，及时冻结并通知财务/负责人。

## 20.9 内容安全事件

- 高危诈骗/违法内容：按查询条件批量隐藏可先于完整审核，但操作必须可回滚和审计。
- 规则误杀：暂停规则版本，恢复受影响内容需批量作业和通知。
- 垃圾消息攻击：限频、挑战、冻结发送，不泄露检测细节。
- 敏感类别事件涉及法律/执法时遵循专门流程，普通工程人员不自行披露数据。

## 20.10 密钥泄露

1. 撤销/旋转凭据，评估访问范围和日志。
2. 对会话/签名密钥按影响执行全局或定向撤销。
3. 检查仓库历史、镜像、CI 日志和第三方。
4. 保留证据并触发安全事件；不要只删除当前文件。
5. 更新 secret scanning 规则和根因控制。

## 20.11 发布回滚

- Feature Flag 首选关闭功能。
- 应用 rollback 使用上一已知好 digest。
- 数据库变更通常 roll-forward；只有验证过且无数据损失才执行 down。
- 回滚后核查 Outbox、队列、索引版本、支付和缓存。
- 记录为什么自动保护没有提前阻止。

## 20.12 站内通知异常

- 重复通知先按 `source_event_id + user_id + channel` 与 Worker outcome 指标确认是否来自迁移前数据、
  非法人工写入或消费者回归；不要直接删除审计证据。
- 模板发布后不可原地修改；文案错误发布新版本并修复事件映射，已有 Notification 保留当时的渲染快照。
- 投影积压时保留 PostgreSQL Outbox，暂停故障消费者并按 eventId 重放；确认幂等约束存在后再扩大批次。
- 错发或越权按隐私事件处理：立即停用相关事件映射、核对 canonical owner 和模板变量，不在工单中复制
  完整通知内容或 PII。

## 20.13 定期运维

每日：关键告警、审核/队列 SLA、支付对账、备份状态。

每周：失败任务、慢查询、搜索质量、依赖漏洞、成本异常、管理员审计抽查。

每月：权限审查、Feature Flag 清理、数据保留任务、容量趋势、恢复点验证。

每季度：灾难恢复演练、渗透/威胁模型更新、供应商与合规审查、运行手册演练。

---

<!-- source: docs\21-risk-register.md -->

# 21. 风险登记册

风险分值使用 Likelihood（1–5）× Impact（1–5）。分值和 owner 在项目启动后由团队确认；此表是初始基线。

| ID   | 风险                               |   L |   I | 分值 | 缓解                                              | 触发/指标                       | Owner            |
| ---- | ---------------------------------- | --: | --: | ---: | ------------------------------------------------- | ------------------------------- | ---------------- |
| R-01 | 虚假招聘/租房诈骗伤害用户与品牌    |   4 |   5 |   20 | 分层验证、重复检测、消息提示、举报、快速下架      | 确认诈骗率、退款/投诉、举报集中 | Trust & Safety   |
| R-02 | 内容供给不足，门户看似丰富但数据空 |   4 |   4 |   16 | 城市/分类灰度、种子合作方、供给运营、不要伪造统计 | 有效信息数、城市覆盖、首联时间  | Product/Growth   |
| R-03 | 分类信息低质/重复导致 SEO 惩罚     |   4 |   4 |   16 | 去重、质量阈值、索引白名单、过期策略              | 薄页、软404、重复 canonical     | SEO/Product      |
| R-04 | 审核队列超出运营能力               |   4 |   4 |   16 | 风险分层、自动批准+抽检、SLA、类别灰度            | oldest case、SLA、误杀          | Ops              |
| R-05 | 对象级越权泄露消息/订单/地址       |   3 |   5 |   15 | policy、repository 约束、负面测试、渗透           | IDOR 测试、异常访问             | Security/Backend |
| R-06 | 支付重复或推广重复履约             |   3 |   5 |   15 | webhook receipt、幂等、账本、对账                 | ledger 差异、重复 fulfillment   | Commerce         |
| R-07 | 设想图过度信息密集，移动端不可用   |   4 |   3 |   12 | 移动优先排序、用户测试、可访问性预算              | 发布完成率、CWV、误触           | Design/Frontend  |
| R-08 | 中英搜索相关性差                   |   4 |   3 |   12 | 别名/同义词、标注集、查询分析、运营词典           | 零结果、改写率、MRR             | Search           |
| R-09 | OpenSearch/Redis 运维复杂和成本高  |   3 |   4 |   12 | 托管、容量控制、fallback、可重建                  | 成本、heap、积压                | Platform         |
| R-10 | 第三方短信/邮件/地图/支付故障      |   3 |   4 |   12 | 适配器、timeout、重试、降级、provider status      | error/latency、配额             | Platform         |
| R-11 | 加州隐私/营销/住房/就业合规遗漏    |   3 |   5 |   15 | 法律审查、Feature Flag、政策规则、数据请求        | 投诉、政策变化                  | Legal/Product    |
| R-12 | 身份/执照材料泄露                  |   2 |   5 |   10 | 独立私有桶、KMS、短保留、访问审计                 | 非授权读取、保留超期            | Security/Ops     |
| R-13 | 团队过早微服务化导致延迟           |   3 |   4 |   12 | ADR、模块化单体、拆分触发证据                     | 服务数量、发布/故障成本         | Architect        |
| R-14 | 数据迁移锁表或不可回滚             |   3 |   4 |   12 | expand-contract、staging 演练、分批回填           | 锁、migration duration          | Data/Platform    |
| R-15 | 旧站数据权属/质量不明              |   3 |   4 |   12 | 导入审计、同意/来源、去重、隔离                   | 无来源记录、投诉                | Product/Legal    |
| R-16 | 广告破坏自然结果信任               |   3 |   4 |   12 | 明示推广、槽位上限、相关性/政策门槛               | 举报、跳出、自然联系下降        | Ads/Product      |
| R-17 | 恶意抓取联系方式                   |   4 |   4 |   16 | 站内消息优先、受控 reveal、频控、WAF              | reveal 速率、爬虫模式           | Security/Growth  |
| R-18 | 分析采集过度或数据质量差           |   3 |   4 |   12 | schema、consent、服务端事实、保留                 | PII scan、事件异常              | Data/Privacy     |
| R-19 | 关键人员/运营单点                  |   3 |   3 |    9 | Runbook、轮值、权限分散、培训                     | 未处理告警、休假阻塞            | Management       |
| R-20 | 首页真实指标延迟/错误造成误导      |   3 |   3 |    9 | 定义口径、更新时间、无数据则隐藏                  | 对账差异、用户投诉              | Product/Data     |

## 21.1 风险治理

- 评分 ≥15：每个里程碑审查，有明确 owner 和 mitigation task。
- 评分 10–14：每月审查。
- 风险接受必须记录理由、到期日和批准者；不能永久“接受”。
- 已发生事件转为问题/事故跟踪，不因风险条目存在而替代修复。
- 新类别、供应商、地区、支付产品和数据用途上线前更新风险表。

---

<!-- source: docs\22-acceptance-criteria.md -->

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
安全公开读取和过期。五类垂直基线均已验收；revision/重大编辑复审、账户管理和搜索派生状态仍由
后续任务完成，因此整个 22.4 尚不能标记完成。

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
举报、下架、独立审核员申诉和恢复已由 `MOD-002` 完成。重新提交的历史 revision diff 和搜索索引
消费仍由后续切片负责，因此整个 Listing 生命周期尚未完成。

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

---

<!-- source: docs\23-content-taxonomy.md -->

# 23. 内容分类与动态表单

## 23.1 分类树原则

分类树同时服务导航、表单、审核、搜索、SEO 和商业化，因此必须版本化且有稳定 ID。显示名称可变，ID/slug 的语义不能随意复用。

分类字段建议：

```text
id, parentId, listingType, slug
nameZhHans, nameEn
status, sortOrder, iconKey
formSchemaVersion, moderationTier
defaultExpiryDays, requiredVerificationLevel
seoTitle/Description per locale
allowedRegionTypes, promotionEligibility
```

## 23.2 首期分类建议

### 招聘

餐饮、仓库物流、办公室行政、销售客服、司机运输、美容美甲、建筑装修、教育培训、医疗护理、家政照护、技术/专业、其他。

关键字段：岗位、雇主、employment type、薪资 min/max/unit、地点、经验、语言、排班、远程、签证支持声明、福利。政策禁止歧视性条件和误导工资。

`LIST-006` 已把这组字段落为 Job v1 动态表单：通用 `title` 表示岗位，通用 `price`
表示最低薪资，`wageMax` 表示同周期最高薪资；允许 HOURLY/DAILY/WEEKLY/MONTHLY/YEARLY，
且应用层和 PostgreSQL 都要求 `0 < min <= max`。`employerName`、`employmentType`、
`experienceLevel`、`remoteType`、`schedule` 必填，语言、签证支持声明和福利可选。
`employmentPolicyAcknowledged` 必须明确为 true，但属于 OWNER_ONLY，不进入公开详情或列表。

平台统一要求所有 Job 提供薪资范围，这是内容完整性规则，不代表平台判断某发布者的法律适用性。
加州官方材料说明就业反歧视义务覆盖招聘广告，且特定雇主的职位发布须包含 pay scale：
[California Civil Rights Department — Employment](https://calcivilrights.ca.gov/employment/)、
[California Labor Commissioner — Equal Pay Act FAQ](https://www.dir.ca.gov/dlse/California_Equal_Pay_Act.htm)。
规则仅把疑似歧视或误导内容送人工审核，不自动作出违法结论；正式政策和阈值仍须法律/运营批准。

### 租房

单间/主卧、整租公寓、独立屋、ADU/后屋、合租找室友、商业/仓库（可后续独立频道）、短租（需政策确认）。

关键字段：property type、bed/bath、租金、押金、available date、lease term、furnished、pets、parking、utilities、公开地点精度。公平住房规则强制。

### 转让

餐馆、奶茶/咖啡、美容美甲、零售、超市/便利、办公室、仓库/工厂、设备/库存、其他生意。

关键字段：asking price、monthly rent、lease remaining、面积、营业/收入声明（需免责声明）、inventory、转让原因、许可。财务数字需标“发布者提供，平台未验证”。

`LIST-007` 已落地 Transfer v1：通用 `price` 是正数 FIXED 要价，`businessType`、`monthlyRent`、
`leaseRemainingMonths`、`reasonForTransfer` 和发布者声明的 `licenseStatus` 必填，
`includesInventory` 可选。`financialDisclaimerAcknowledged` 必须明确为 true 且为 OWNER_ONLY。
分类策略固定人工审核，不能因未命中自动规则而直接公开。

### 二手

家具家电、电子数码、车辆配件（车辆整车是否启用需政策）、母婴、服饰、美容、办公/商业设备、运动户外、收藏/其他。

禁止/限制：武器、毒品、处方药、假货、盗窃物、危险品、成人内容等，正式政策确认。

`LIST-007` 已落地 Secondhand v1：价格只允许 FIXED/NEGOTIABLE/FREE；`condition` 与非空
`deliveryOptions` 必填，品牌/型号可选。`marketplacePolicyAcknowledged` 必须明确为 true 且为
OWNER_ONLY。v3 高置信禁售品规则只把字段名送高优先人工审核，不复制疑似原文，也不代替正式政策、
人工判断或执法结论。

### 服务

装修、水电、空调、屋顶、园艺、搬家、清洁、汽车、家政、摄影、会计税务、法律/移民（资质严格）、保险/地产（执照）、教育、IT、餐饮活动、其他。

关键字段：service area/radius、执照/保险、经验、报价单位、紧急服务、可用时间。受监管职业必须验证或明确“未验证”。

`LIST-007` 已落地 Service v1：价格只允许 HOURLY/FIXED/NEGOTIABLE；`serviceRadiusMiles` 限制
1–100，`licenseStatus`、非空 `availability` 和 `servicePolicyAcknowledged` 必填，保险和紧急服务
可选。`licenseNumber` 与政策确认属于 OWNER_ONLY；公开的执照/保险状态必须继续标为发布者声明，
不能呈现为平台核验。

## 23.3 地区层级

Seed 已提供南加州常用城市。正式数据建议：

```text
US
└── California
    ├── Los Angeles County
    │   ├── Los Angeles
    │   ├── Monterey Park
    │   ├── Alhambra
    │   ├── Arcadia
    │   ├── San Gabriel
    │   ├── City of Industry
    │   ├── Walnut
    │   └── Long Beach ...
    └── Orange County
        ├── Irvine
        ├── Anaheim
        ├── Costa Mesa
        └── ...
```

城市别名（洛杉矶/LA、蒙市/MPK、尔湾/Irvine）存入 alias 表/搜索词典，不作为重复 Region。

`TAX-001` 将此原则落为 `region_aliases` / `category_aliases`：原始别名保留 locale 与显示值，
另存 NFKC、大小写和常见分隔符归一化键用于参数化查询。别名表通过 FK 依附稳定 taxonomy ID，
删除父节点时级联清理；同一父节点、locale、归一化键唯一。公开 API 只返回 active 主数据、原始
别名和中英名称，不返回内部归一化键，也不允许 `activeOnly=false` 绕过。无筛选时返回树；
`parentCode` / `parentId` 返回直接子级，type/vertical 或 `q` 查询返回扁平匹配节点。

## 23.4 动态表单版本

`schemas/listing-form.schema.json` 定义表单配置 envelope。每次发布 schema 形成不可变版本：

- 字段 key 和类型一旦有数据不可随意改变。
- required 的新增需考虑旧草稿/已发布内容。
- UI component 只允许系统白名单。
- 条件逻辑采用受控表达式，不执行任意 JavaScript。
- 服务端根据保存时 schema/version 验证；前端 schema 只是体验增强。
- 搜索可筛选字段必须有规范化映射，不从自由 JSON 临时推断。

`TAX-002` 将上述约束落为 `category_form_schema_versions`。每个 Category 最多有一个未发布
draft；draft 用 `revision` 做乐观并发，发布前再次核对 Category 当前版本。发布在同一事务内写入
`publishedAt/publishedById`、推进 `categories.form_schema_version`，并重建受控的
`category_fields` 投影。数据库触发器禁止更新或删除已发布记录；回滚复制目标历史定义并发布为新的
单调递增版本，`basedOnVersion` 保存来源，绝不把当前指针倒退或覆盖历史。

每条 Listing 保存 `form_schema_version`。服务端校验草稿时读取该 Category 的精确已发布版本，
因此 version 2 新增 required 字段不会让 version 1 草稿失效。公开
`GET /categories/{categoryId}/form-schema` 默认返回当前已发布版本，也可用正整数 `version`
读取历史已发布版本；draft、停用 Category 和未知版本统一不可见。当前版本短缓存，显式历史版本使用
immutable cache，并以 SHA-256 内容哈希作为强 ETag。

表单字段和选项均有数量/长度上限，key/option value 唯一。SELECT/MULTISELECT 必须来自显式
option；可筛选类型进入白名单。PHONE/EMAIL 必须是非公开、不可搜索/筛选字段。pattern 禁止回溯引用、
lookaround 和嵌套量词等高风险构造，不接受脚本或任意 UI component。管理端 draft/preview/publish/
rollback HTTP adapter 必须等 `ADMIN-001` 的 SSO/MFA/RBAC shell 完成后接入；本切片已提供可复用的
应用服务和原子 Repository，不会先暴露匿名管理写口。

## 23.5 分类变更治理

Draft → Review → Preview → Publish → Observe → Rollback。分类合并/移动需：slug redirect、旧 Listing 映射、搜索重建、SEO canonical、报表连续性和推广库存影响评估。

## 23.6 标签与属性

自由标签很容易产生垃圾和同义词碎片。MVP 只允许运营词表和类型化属性；用户可在正文表达其他信息。高频有价值属性经分析后进入 schema，并提供迁移/索引。

---

<!-- source: docs\24-data-retention.md -->

# 24. 数据保留、归档与删除

> 具体期限需法律、财务、安全和产品确认。本表是工程默认值，生产前必须批准。

## 24.1 原则

- 目的限制与最小化：不因“以后可能有用”无限保存。
- 保留期限按数据类别、用途和法定义务定义。
- 删除覆盖主库、搜索、缓存、对象存储、队列、分析和第三方；备份按自然周期到期并限制恢复用途。
- 财务/安全例外保留最小必要字段并限制访问。
- 删除、匿名化和 legal hold 都有可审计工作流。

## 24.2 初始保留表

| 数据                | 在线保留                  | 归档/删除建议          | 说明                |
| ------------------- | ------------------------- | ---------------------- | ------------------- |
| 活跃用户资料        | 账户期间                  | 删除请求后去标识       | 阻塞未结订单/争议   |
| 会话 token          | 到期/撤销后 30 天内元数据 | 删除 token hash        | 安全调查最小化      |
| OTP                 | 10 分钟有效               | 24 小时内删除/聚合     | 不记录明文          |
| Listing 当前快照    | 活跃+过期窗口             | 2–3 年后归档/去标识    | 类别政策可不同      |
| Listing revisions   | 2 年                      | 聚合/删除              | 审核与争议          |
| 公共媒体            | 资源期间+删除缓冲         | 30–90 天清理           | S3 version 生命周期 |
| 身份/执照原件       | 验证所需+最短周期         | 30–90 天或法律批准期限 | 结论与到期可更久    |
| Messages            | 12–24 个月                | 删除/去标识            | 用户设置与举报 hold |
| 举报/审核证据       | 案件结束后 1–3 年         | 删除敏感证据，保留结论 | 高风险类别另定      |
| Audit logs          | 1–7 年分层                | WORM/归档              | 财务/安全动作更久   |
| 订单/支付/账本      | 7 年基线                  | 加密归档               | 财税确认            |
| 原始 Stripe webhook | 30–90 天                  | 保留摘要/哈希          | 不存多余支付数据    |
| 通知内容            | 90–180 天                 | 状态聚合               | 退订证据可更久      |
| IP/设备风险数据     | 30–180 天                 | 聚合/轮换 hash         | 风险与隐私平衡      |
| 原始分析事件        | 13 个月或更短             | 聚合长期保留           | consent/delete      |
| 搜索 query          | 30–90 天去敏              | 低频删除、聚合         | 防止个人信息泄漏    |
| 应用日志            | 14–90 天                  | 分层冷存储             | 级别和环境不同      |
| 备份                | 35 天+月度策略            | 自动过期               | 恢复受严格限制      |

`AUTH-002` 的 `otp_challenges` 在读取时强制 10 分钟失效，数据库只保留验证码、账号查找、IP 和设备标识的
域分离 HMAC；投递/建档所需联系方式仍按 Confidential PII 管理。24 小时物理删除/聚合由 `PRIV-001`
维护任务执行并监控，不能把在线过期误当作已经完成保留清理。

`AUTH-003` 的设备管理投影只读取活跃 session UUID、清理后的 User-Agent、创建/最近活动/有效期；
不返回 token、token hash 或 IP hash。撤销和到期后的 metadata 仍按上表 30 天上限清理，不能因为用户
界面不再显示就无限保留。用户状态或软删除变化会即时标记全部会话已撤销，物理删除仍由保留任务完成。

## 24.3 账户删除编排

1. 创建 `deletion_request`，验证身份，记录范围和法定例外。
2. 冷静期内撤销营销，允许用户取消请求。
3. 检查 Owner 转移、订单、dispute、legal hold。
4. 取消会话、隐藏公开资源、去标识 profile。
5. 任务删除/匿名化消息、媒体、搜索、缓存、通知、分析标识。
6. 对财务/审计记录替换非必要 PII，保留内部不可公开引用。
7. reconciliation 报告每个系统状态，失败重试/人工处理。
8. 发送完成通知（在联系方式删除前），保留最小完成证明。

## 24.4 Legal Hold

仅授权法律/安全角色可设置，包含 case、范围、理由、批准、到期和审查。Hold 不应成为无限保留借口；到期自动提醒并需续批。用户隐私请求响应需说明适用例外，而非静默不执行。

## 24.5 备份中的删除

不可现实地逐条修改不可变备份时：备份保持加密、严格访问、仅灾难恢复、按短周期过期；若恢复，必须重新应用删除 tombstone/任务后才可投入生产。此流程需在恢复演练中验证。

---

<!-- source: docs\25-team-operating-model.md -->

# 25. 团队协作与系统所有权

## 25.1 建议团队

- Product Lead：范围、优先级、指标和政策协调。
- UX/Product Designer：双语、移动、可访问性和设计系统。
- Tech Lead/Architect：边界、ADR、质量 Gate 和跨模块风险。
- Frontend Engineers：Web/Admin、SEO、性能、可访问性。
- Backend Engineers：API、领域、数据、集成、Worker。
- QA/SDET：自动化、测试数据、迁移、E2E、性能。
- Platform/SRE（可兼职起步）：CI/CD、云、可观测、恢复、安全基线。
- Trust & Safety/Ops：规则、审核、举报、培训和内容政策。
- Growth/Content：城市/分类供给、SEO 内容和商家合作。
- Legal/Privacy/Finance advisors：关键 Gate 审查。

## 25.2 模块所有权

| 模块                 | Primary        | Secondary       |
| -------------------- | -------------- | --------------- |
| Web/SEO              | Frontend       | Growth/Backend  |
| Admin                | Frontend       | Ops/Backend     |
| Identity/Permissions | Backend        | Security/QA     |
| Listings/Taxonomy    | Backend        | Product/Ops     |
| Search               | Backend/Search | Growth/Platform |
| Messaging/Trust      | Backend        | T&S/QA          |
| Commerce/Ads         | Backend        | Finance/Ad Ops  |
| Database/Migrations  | Backend/Data   | Platform        |
| Infra/Observability  | Platform       | Backend         |
| Policies/Moderation  | T&S/Product    | Legal/Backend   |

每个 owner 维护代码、Runbook、Dashboard、SLO、Backlog 和文档。所有权不意味着单人可绕过审查。

## 25.3 工作节奏

- 每周产品/运营/工程风险与指标复盘。
- 每次 Gate 前做架构、隐私、安全、运营容量和发布评审。
- ADR 用于材料决策，不用来记录每个小实现。
- RFC/设计评审应包含目标、非目标、数据流、权限、失败、迁移、测试和观测。
- 技术债必须有影响、owner、期限，不能只列“以后重构”。

## 25.4 Definition of Ready

任务进入开发前应有：用户价值、范围/非范围、设计或流程、验收标准、数据/权限影响、契约变化、依赖、Feature Flag 和分析事件。高风险功能还需威胁模型/政策意见。

## 25.5 Codex 与人工协作

Codex 适合按清晰任务生成实现、测试、迁移和文档，但关键决策、生产凭据、法律政策、数据迁移执行和发布批准必须有人负责。

建议流程：

1. 人工选定 Backlog ID 和上下文。
2. Codex 阅读仓库事实源并提出最小实施计划。
3. Codex 编码并运行测试，报告未运行项。
4. 人工审查业务规则、安全、迁移和 UX。
5. CI/staging 验证；高风险功能做双人批准。

不得让 Agent 自行选择生产资源、创建付费云服务、接触真实密钥或执行不可逆生产迁移。

## 25.6 质量与事故文化

- 无责复盘，聚焦系统和流程而非个人。
- 事故 action item 进入正常 Backlog，有 owner 和期限。
- 交付速度必须同时看变更失败率、MTTR、诈骗/误杀、用户任务完成率。
- 临时手工操作应尽快转化为受控工具或 Runbook。

## 25.7 GitHub 所有权与合并治理

`.github/CODEOWNERS` 覆盖应用、契约、数据库 schema/迁移、基础设施、安全、商业化和 ADR。当前个人
私有仓库的全部路径映射到真实维护者 `@songjiahang676-cell`，因此 GitHub 可以解析规则；建立 organization
并增加第二维护者后，应按 25.2 的角色拆分为真实 team，并为关键路径启用 code-owner review。

`.github/pull_request_template.md` 要求每个变更填写 Backlog ID、范围、契约/数据影响、授权/隐私/幂等、
回滚、实际测试、未运行项、可观测和已知缺口。高风险检查不得以“不适用”掩盖实际影响；确实不在范围时
应明确说明原因。

`pnpm governance:check` 验证关键路径存在真实格式的 owner、没有遗留 `*-owners`/`*-maintainers`
角色占位符，并检查 PR 模板必填审查项。个人仓库阶段由 required CI check 提供合并保护；至少有两名
维护者后再启用 required approval 和 code-owner review，避免要求作者批准自己的 PR。

当前真实 owner 映射和 PR 模板已在 PR #1 被 GitHub 解析。项目负责人明确授权仓库公开后，`main`
已启用 required checks、PR、conversation resolution 和管理员不可绕过保护；PR #2 的失败检查被
真实阻止合并。增加第二维护者后仍须启用至少一名独立批准者和 code-owner review。

---

<!-- source: docs\26-homepage-component-map.md -->

# 26. 首页设想图组件映射

参考图：`docs/homepage-concept.png`。当前 `apps/web` 提供静态参考实现，正式开发按本章拆分和接真实 API。

## 26.1 页面区域

| 设想图区块              | 建议组件               | 数据源                       | MVP 行为                            |
| ----------------------- | ---------------------- | ---------------------------- | ----------------------------------- |
| 品牌/地区/搜索/账户     | `GlobalHeader`         | session、region、suggest API | 响应式、sticky（桌面）              |
| 主导航                  | `PrimaryNav`           | taxonomy/navigation config   | Feature Flag 隐藏未上线频道         |
| 左侧快速发布            | `QuickPublishRail`     | listing type config          | 未登录保存 return URL               |
| Hero                    | `HomepageHero`         | homepage config              | 品牌文案+授权图片，不用伪造 skyline |
| Hero 统计               | `PlatformMetrics`      | aggregate API                | 有口径/更新时间；无真实数据隐藏     |
| 热门搜索排行            | `TrendingSearches`     | privacy-filtered trends      | 城市/窗口，支持换一批               |
| 热门城市                | `PopularRegions`       | config + inventory           | 跳转 canonical 城市页               |
| 置顶信息                | `PinnedListings`       | promotion query              | 明确“置顶/推广”                     |
| 17 个功能入口           | `ServiceDirectoryGrid` | nav config                   | 移动端优先核心入口                  |
| 最新招聘/房源/转让/二手 | `LatestListingModule`  | listings API                 | 每块独立缓存/错误边界               |
| 需求大厅                | `RequestBoard`         | Phase 2 或服务需求模型       | MVP 可 Feature Flag 关闭            |
| 行情中心                | `MarketInsights`       | verified aggregate data      | 无可靠样本不展示                    |
| 老板/行业专区           | `IndustryCollections`  | editorial collection         | 运营配置、SEO landing               |
| 跨境货源                | `SupplierSpotlight`    | Phase 2/3                    | 法律/审核通过后启用                 |
| 首页广告                | `AdPlacement`          | ad delivery API              | label、频控、fallback               |
| 优质商家                | `FeaturedBusinesses`   | trust + editorial            | 真实评分/验证                       |
| 推荐师傅                | `FeaturedProviders`    | provider ranking             | 不用头像/评分占位上线               |
| 积分/增值服务           | `CommerceShortcuts`    | SKU/entitlement              | 未启用项隐藏                        |
| 平台保障                | `TrustStrip`           | localized content config     | 链接政策/帮助                       |
| 多角色后台入口          | `RolePortalLinks`      | session permissions          | 只显示有权限入口                    |
| 页脚                    | `GlobalFooter`         | config                       | 政策、联系、sitemap、备案按适用     |

## 26.2 推荐组件树

```text
Homepage
├── GlobalHeader
├── PrimaryNav
├── MainGrid
│   ├── QuickPublishRail
│   ├── CenterColumn
│   │   ├── HeroRow
│   │   │   ├── HomepageHero
│   │   │   └── TrendingSearches
│   │   ├── ServiceDirectoryGrid
│   │   ├── LatestVerticalsGrid
│   │   └── DiscoveryModules
│   └── RightColumn
│       ├── PopularRegions
│       ├── PinnedListings
│       └── RightRail
│           ├── AdPlacement
│           ├── FeaturedBusinesses
│           ├── FeaturedProviders
│           └── CommerceShortcuts
├── TrustStrip
├── RolePortalLinks
└── GlobalFooter
```

每个数据模块使用独立 Suspense/error boundary；一个推荐模块失败不应让整页 500。

## 26.3 首页 API

避免浏览器首屏请求十几个 endpoint。服务端可调用组合 endpoint：

```http
GET /v1/homepage?locale=zh-Hans&regionId=<id>&device=desktop
```

响应包含 layout version、模块列表、模块级 data/version/cache policy。高变化内容（消息数、登录状态）独立请求/服务端 session 读取；广告可在合规延迟加载。

首页配置和数据分离：配置决定模块/参数，API 决定实时内容。配置不能包含任意 HTML。

## 26.4 响应式映射

### Desktop

三栏保持门户效率；Hero 与排行并列；右侧商家/师傅/广告可见。

### Tablet

快速发布改为横向快捷卡；右侧下沉；最新四类 2×2；减少 sticky 元素。

### Mobile

- Header：品牌、地区、消息/账户，搜索独占一行。
- 主导航横滑或“更多”菜单。
- 快速发布变 2–3 列快捷入口/底部主按钮。
- Hero 缩短；统计最多 2–3 个核心真实指标。
- 热门排行、行情、行业专区折叠或后置。
- 右栏全部进入主流，广告不阻断任务。

## 26.5 数据真实性与免责声明

设想图数字 `2,318`、`256,893`、评分、价格行情、商家 logo 和师傅信息均为视觉占位。正式实现必须：

- 有数据口径、采样、更新时间和最低样本阈值；
- 无数据时隐藏/显示“暂无足够数据”，不得生成假数字；
- logo/头像有授权和 fallback；
- 评分来自真实评价并显示数量；
- 广告明确 label；
- 行情说明来源和非专业建议。

## 26.6 性能和 SEO

- H1、核心频道、真实最新内容服务端输出。
- 用户特定数据不进入共享 HTML cache。
- 模块级 `cacheTag`：homepage config、region、listing type、ads。
- Hero 图片优化且不压过文本 LCP。
- 非首屏模块延迟 hydration；避免每个小卡片成为 client component。

---

<!-- source: docs\27-route-catalog.md -->

# 27. 路由目录

`[locale]` 为 `zh-Hans` 或 `en`；`[city]`、`[category]` 是规范 slug；私有页面全部 noindex。

## 27.1 公开 Web

| Route                            | 模板/说明                | Auth | SEO            |
| -------------------------------- | ------------------------ | ---- | -------------- |
| `/`                              | locale 选择/重定向       | 否   | noindex 或短页 |
| `/[locale]`                      | 地域化首页               | 否   | index          |
| `/[locale]/search`               | 全站搜索                 | 否   | noindex        |
| `/[locale]/jobs`                 | 招聘频道                 | 否   | index          |
| `/[locale]/jobs/[city]`          | 城市招聘                 | 否   | 白名单 index   |
| `/[locale]/jobs/[city]/[slugId]` | 招聘详情                 | 否   | 条件 index     |
| `/[locale]/rentals...`           | 租房列表/详情            | 否   | 同上           |
| `/[locale]/transfers...`         | 转让列表/详情            | 否   | 同上           |
| `/[locale]/marketplace...`       | 二手列表/详情            | 否   | 同上           |
| `/[locale]/services...`          | 服务信息列表/详情        | 否   | 同上           |
| `/[locale]/providers`            | 师傅目录                 | 否   | index          |
| `/[locale]/providers/[slugId]`   | 师傅档案                 | 否   | 条件 index     |
| `/[locale]/businesses`           | 商家目录                 | 否   | index          |
| `/[locale]/businesses/[slug]`    | 商家档案                 | 否   | 条件 index     |
| `/[locale]/cities/[city]`        | 城市门户                 | 否   | index          |
| `/[locale]/deals`                | 优惠（Phase 2）          | 否   | Feature Flag   |
| `/[locale]/questions`            | 问答（Phase 2）          | 否   | Feature Flag   |
| `/[locale]/community`            | 论坛（Phase 2）          | 否   | Feature Flag   |
| `/[locale]/events`               | 活动（Phase 2）          | 否   | Feature Flag   |
| `/[locale]/suppliers`            | 国内货源（Phase 2/3）    | 否   | Feature Flag   |
| `/[locale]/help/*`               | 帮助与安全               | 否   | index          |
| `/[locale]/policies/*`           | 条款/隐私/内容/广告/退款 | 否   | index          |
| `/[locale]/about`                | 关于                     | 否   | index          |

五类详情路由可由统一内部 route builder 生成，公开 URL 保持垂直清晰。

## 27.2 发布与账户

| Route                                | 说明          |
| ------------------------------------ | ------------- |
| `/[locale]/post`                     | 选择发布类型  |
| `/[locale]/post/[type]/new`          | 创建草稿/表单 |
| `/[locale]/post/[type]/[id]/edit`    | 编辑          |
| `/[locale]/post/[type]/[id]/preview` | 私有预览      |
| `/[locale]/account`                  | 总览          |
| `/[locale]/account/listings`         | 我的信息      |
| `/[locale]/account/favorites`        | 收藏          |
| `/[locale]/account/messages`         | 会话列表      |
| `/[locale]/account/messages/[id]`    | 会话          |
| `/[locale]/account/notifications`    | 通知          |
| `/[locale]/account/orders`           | 订单          |
| `/[locale]/account/wallet`           | 积分/信用     |

当前五类规范创建路由为 `/[locale]/post/rental/new`、`/[locale]/post/job/new`、
`/[locale]/post/transfer/new`、`/[locale]/post/secondhand/new` 和
`/[locale]/post/service/new`；首页相应快速发布入口指向各自页面。它们均为 noindex 私有草稿页，
复用账号/locale/vertical 隔离恢复、动态 schema、READY 媒体绑定、强并发控制和幂等提交审核动作。
| `/[locale]/account/organizations` | 组织与成员 |
| `/[locale]/account/profile` | 资料 |
| `/[locale]/account/verification` | 验证 |
| `/[locale]/account/security` | 会话/MFA |
| `/[locale]/account/privacy` | 数据请求/删除 |
| `/[locale]/auth/login` | 登录 |
| `/[locale]/auth/verify` | OTP 验证 |

## 27.3 Admin

```text
/admin
/admin/moderation/listings
/admin/moderation/reports
/admin/moderation/appeals
/admin/users
/admin/organizations
/admin/businesses
/admin/providers
/admin/taxonomy/regions
/admin/taxonomy/categories
/admin/config/homepage
/admin/config/rules
/admin/commerce/orders
/admin/commerce/refunds
/admin/commerce/ledger
/admin/ads/inventory
/admin/ads/campaigns
/admin/notifications
/admin/audit
/admin/system/jobs
/admin/system/health
```

Admin route 只是视图入口，权限以 API action 为准。没有权限的菜单不显示，直接访问仍必须返回 403。

## 27.4 路由规则

- Route builder 统一生成 canonical、locale switch 和 breadcrumb。
- 不使用标题作为唯一 ID；详情 slug 尾部包含短 ID 或稳定 key。
- 所有账户/Admin 页 `noindex`，响应设置防缓存私密 header。
- 旧 slug 用持久 redirect 表 301；违规/删除资源 404/410。
- 任意筛选 query 参数按 canonical 策略处理，不自动 index。

---

<!-- source: docs\28-admin-console.md -->

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

## 28.10 ADMIN-002 Listing 审核工作台

- `/admin/moderation/listings` 只有 API 返回 moderation navigation 时才挂载真实工作台。Admin BFF
  只增加 queue GET、UUID detail GET 和 UUID action POST；路径穿越、方法混淆及其他 Admin 资源 404。
- 队列固定使用 PostgreSQL canonical Case，按 priority、createdAt、UUID 排序；高风险 15 分钟、
  中风险 4 小时的计划 SLA 与数据时间可见。列表 limit 最大 50，cursor 对 actor 和全部筛选签名。
- 详情来自提交时不可变快照；动态联系方式/地址和精确坐标已移除。界面展示首提 ADDED diff、
  非 LOW 规则证据、媒体状态和发布者聚合，不加载 email/phone、原图 key、内部 hash 或假指标。
- 读取要求当前 MODERATOR/SENIOR_MODERATOR + MFA；动作另要求 recent MFA。批准、要求修改、拒绝、
  升级与稳定原因码绑定，并携带强 `If-Match` 和 actor-scoped `Idempotency-Key`。
- 写事务同时更新 Listing/Case version，追加 immutable ModerationAction、最小 Audit 和 Outbox。
  客户端 409 后重新加载当前案件，不静默覆盖另一审核员的决定。
- 中文/英文与移动布局共用语义结构；队列可用 J/K/方向键切换，R 刷新，Alt+A 聚焦动作，状态/错误
  使用 live region，focus 保持可见。

---

<!-- source: docs\29-migration-and-launch.md -->

# 29. 数据迁移、内容冷启动与上线

## 29.1 适用场景

若已有旧网站、Excel、数据库或商家名单，迁移必须作为独立项目处理。未知来源的数据不能直接导入公开生产，更不能自动制造用户账号或评价。

## 29.2 导入流水线

```text
Source Inventory
→ Legal/Consent Review
→ Extract to immutable staging
→ Normalize/Map
→ Validate/Quarantine
→ Deduplicate
→ Dry-run report
→ Import canonical DB
→ Media copy/scan
→ Moderation sampling
→ Search index
→ Reconciliation
```

每批次有 `import_batch_id`、来源、时间、hash、映射版本、记录数、失败、操作者和回滚策略。

## 29.3 来源审查

- 谁拥有数据和内容授权？
- 用户是否同意迁移及新的隐私/条款？
- 联系方式能否继续公开/营销？
- 评价是否真实、可验证、允许迁移？
- 内容是否过期、违法、重复或包含敏感 PII？
- 图片是否有版权和原始 EXIF？

无法确认时，只可作为内部线索/待认领档案，不能公开声称由该商家/用户发布。

## 29.4 映射与去重

- 城市/分类映射到稳定 ID，无法映射进入 quarantine。
- 用户按经验证邮箱/手机号匹配需谨慎，避免错误合并；优先邀请认领。
- Listing 使用来源 ID + source 唯一，内容/联系方式/图片 hash 做近似重复。
- 商家采用名称、地址、电话等匹配并人工复核冲突。
- 不迁移明文密码；要求重置/OTP 激活。

## 29.5 内容冷启动

上线前需要真实供给而非占位数字：

- 与少量可信招聘方、房东、商家、师傅合作导入/发布。
- 运营创建的 editorial collection 明确来源和时间。
- 首页没有可靠数据的模块隐藏，而非伪造统计/评分。
- 为首发城市设最低有效信息阈值，未达标不生成 SEO 城市页。
- 安全/帮助/政策内容中英完整。

## 29.6 上线阶段

### Internal Alpha

员工/合作方，测试完整发布、审核、搜索、消息和后台。生产级安全但可无公开 SEO。

### Closed Beta

邀请发布者 + 1–2 城市/少量分类。观察审核负荷、诈骗、搜索成功、首联时间和性能。

### Public Beta

扩大城市和用户；商业化可保持邀请制。启用 sitemap/SEO 的批准页面。

### GA

通过生产就绪验收、运营 SLA、安全/法律审查和恢复演练后开放。

## 29.7 灰度控制

Feature Flag 维度：环境、城市、listing type、用户 cohort、组织、角色。发布顺序通常：读取 → 创建草稿 → 提交 → 自动审批 → 商业化。任何新高风险类别先人工审核 100%，再根据数据降低比例。

## 29.8 Cutover 清单

- DNS/CDN/WAF/TLS、域名 canonical、robots/sitemap。
- 数据库迁移、备份点、搜索索引、对象桶策略。
- 生产密钥/provider webhook、邮件域/SPF/DKIM/DMARC。
- 隐私/条款/内容/退款/广告政策链接。
- Admin 用户、MFA、权限、值班和沟通模板。
- Dashboard/告警、状态页、Runbook。
- 真实首页配置、广告 fallback、无占位信息。
- Rollback 决策点和负责人。

## 29.9 上线后 72 小时

发布窗口加强值班；密切监控错误、搜索、审核、消息垃圾、付款、SEO 抓取和成本。避免同时上线大量新 Feature Flag。每日两次 Go/No-Go 复盘，并保持快速关闭高风险入口能力。

---

<!-- source: docs\30-reference-implementation.md -->

# 30. 参考实现说明

## 30.1 当前代码包含什么

### `apps/web`

- Next App Router 基础结构。
- `/` 到 `/zh-Hans` 的入口。
- 响应式首页视觉参考，映射设想图的主要区域。
- 静态模拟数据和纯 CSS，用于让开发者快速理解布局。
- `NOTIF-001` 已增加私有、noindex 的中英文通知中心，具备登录门、未读筛选、稳定分页、已读和严格
  同源 BFF allowlist。

它尚未连接 API、身份、真实图片、i18n 库、无障碍测试、SEO 元数据、缓存和设计系统。因此不得把当前首页直接当作生产完成品。

### `apps/admin`

- Next 后台壳和仪表盘占位。
- 后续按 `docs/28-admin-console.md` 建立鉴权、导航和工作区。

### `apps/api`

- NestJS + Fastify 启动、Swagger、全局验证和 Problem Details 异常过滤器。
- Health 模块。
- Listing HTTP 不再使用进程内数组示例；`LIST-001` 已增加纯领域状态机，覆盖五类
  type-detail、价格、审核/内容双状态、版本和过期不变式。`LIST-002` 已增加 PostgreSQL Repository
  及 public/owner/moderator 显式安全投影，包含对象范围、当前审核角色 scope 和精确历史动态字段
  visibility 过滤；`LIST-003` 已接入数据库草稿创建/owner 读取/条件更新、actor-scoped 幂等、
  API-004 对象 Policy、强 ETag/409，以及同事务最小化 Audit/Outbox。`LIST-004` 已接入 Rental
  中英/移动动态表单、防抖自动保存、user + locale 隔离恢复、同源 allowlist BFF、owner 媒体状态
  轮询及事务化 READY 绑定；`LIST-005` 已接公开安全列表/详情、归档/软删除和批量过期；
  `LIST-006`/`LIST-007` 已把完整链扩展到 Job、Transfer、Secondhand 和 Service；
  `NOTIF-001` 已接账号私有通知列表/已读 API 与 Policy。

### `apps/worker`

- BullMQ/Redis 队列与 Worker 进程。
- 示例 search/media/notification job 类型。
- `EVT-001` 已接 PostgreSQL Outbox dispatcher、SKIP LOCKED 租约领取、eventId jobId、发布重试和
  oldest-age/结果指标。
- `MEDIA-002` 已接真实媒体消费者：有界 S3/MinIO 读取、内容 hash/magic-byte、ClamAV INSTREAM、
  Sharp 解码/方向校正/去 metadata、三个确定性 WebP 变体和 lifecycleVersion 幂等终态。
- `NOTIF-001` 已接 Listing 状态通知消费者：严格 envelope、eventId 幂等投影、canonical recipient、
  风险分支和有界结果指标。
- 仍需搜索等其他领域真实幂等消费者、通知 provider adapter，以及 `EVT-002` 的
  DLQ/replay/reconciliation 工具。

### `packages/database`

- Prisma 7 配置和 client adapter。
- 覆盖用户、组织、地区、分类、Listing、媒体、消息、商家/师傅、评价、审核、通知、订单、支付、积分、广告、Outbox 和审计的初始 Schema。
- 安全的扩展引导迁移、需合并到首个建表迁移后的 PostGIS/trigram/约束 SQL，以及 fallback SQL。
- Listing 的公开、owner 和 moderator 三类显式读取投影；对象授权条件及动态字段 visibility 在
  Repository 边界失败关闭，不直接返回 Prisma 模型。
- Listing 草稿 Repository 对创建使用 advisory lock + owner/key 唯一证据，对更新使用行锁 +
  version predicate，并在相同事务写 Audit/Outbox。
- Listing 媒体绑定按 UUID 加行锁，只接受 owner 或同一可编辑 Listing 已绑定的 READY 图片；
  `media_assets_listing_binding_check`、外键和稳定 sort order 提供数据库兜底。
- Moderation Case Repository 提供 MFA/current-role 范围队列与安全详情，并以 actor/key advisory
  lock、Case/Listing 行锁和 version predicate 原子提交 Action/Audit/Outbox。快照在 submission
  事务按历史表单 visibility 脱敏，数据库阻止 snapshot/action 改写。
- Notification Repository 以 eventId advisory lock 和复合唯一键投影 Listing Outbox，只从 canonical
  Listing 读取 owner/locale；已发布双语模板不可变，通知保存静态渲染快照并提供账号范围稳定分页/已读。

Schema 是详细起点，不替代首次 `prisma validate`、migration 生成、约束/索引评审和集成测试。

### 契约与数据

- `openapi/openapi.yaml`：当前 64 个 path、74 个 operation 和 137 个 schema 的 REST 契约。
- `schemas/`：Listing 动态表单、首页编排、分析事件。
- `seed/`：分类、地区、首页和示例 Listing。
- `diagrams/`：系统/容器/部署/流程/ER Mermaid 图。

## 30.2 首次实施应做的代码调整

1. 生成并提交 `pnpm-lock.yaml`，锁定依赖。
2. 修复任何在真实 Node 24/pnpm 11 环境暴露的构建问题。
3. 运行 Prisma validate/generate；用 `--create-only` 生成首个建表迁移，并按 `packages/database/prisma/sql/README.md` 合并后置 SQL、补全 relation/constraint。
4. 建立统一 ESLint/Prettier/Vitest/Playwright 配置。
5. 为各 app 添加可构建容器和健康检查。
6. 将 API 模块按领域目录重构，接 database package。
7. 建立 session/auth、policy、request context 和 audit middleware。
8. 选择 OpenAPI 与 Zod/DTO 的生成方向，防止三份契约漂移。
9. 把首页 mock 分解为 Server Components 和 API-backed modules。
10. 逐个 Backlog 任务实现，不一次性大爆炸替换全部代码。

## 30.3 推荐代码目录演进

```text
apps/api/src/modules/listings/
├── domain/
│   ├── listing.ts
│   ├── listing-status.ts
│   └── listing.policy.ts
├── application/
│   ├── commands/create-listing.ts
│   ├── commands/submit-listing.ts
│   └── queries/get-listing.ts
├── infrastructure/
│   ├── prisma-listing.repository.ts
│   └── listing-outbox.publisher.ts
├── http/
│   ├── listings.controller.ts
│   └── listings.dto.ts
└── listings.module.ts
```

不过不要为了目录形式引入过多样板；当模块小、规则简单时可合并文件，但依赖方向不变。

`MOD-001` 保持该依赖方向：`moderation-risk.ts` 是无 I/O 的版本化规则模块，
`ListingsService.submit` 负责 Policy、历史表单策略和领域状态转换，
`ListingSubmissionRepository` 只负责 PostgreSQL 范围复核、幂等锁与原子证据持久化。
Controller 不导入 Prisma，Web/Admin 也不导入数据库 adapter。

`ADMIN-002` 延续相同边界：`ModerationController` 只做严格契约、Policy 和 HTTP 映射；
`ModerationService` 管理签名 cursor、ETag、原因与 Listing 领域转换；数据库 adapter 复核 Session/
角色并持久化。Admin React 组件只调用同源 BFF，不导入 Prisma 或数据库模型。

`LIST-005` 使用同一模块化单体边界：`ListingsController` 只解析严格 query、ETag 和 Problem Details；
`ListingsService` 负责签名 cursor、对象 Policy 与领域状态机；`ListingRepository` 负责 PostgreSQL
公开投影、锁后授权复核、状态/version predicate 和 Audit/Outbox 原子提交。Worker 的
`ListingExpiryDispatcher` 只编排轮询、指标与结构化结果，实际领取/转换仍由 database package 完成。

`LIST-006`/`LIST-007` 不新增服务边界：`ListingsService` 按 type 构造并验证五类 detail，
`ListingDraftRepository` 在同一事务 upsert 匹配明细并清理错配明细；公共读与过期仍走共享
`ListingRepository`。Web 五类发布页复用同一个 schema-driven 组件，但保持路由、本地恢复 key 和
动态字段按 vertical 隔离。

`NOTIF-001` 继续保持相同方向：Worker 的 `ListingNotificationHandler` 只校验/分派事件并分类永久与
瞬时错误；`NotificationRepository` 持有模板选择、canonical recipient、幂等事务和查询；API 的
`NotificationsService` 持有 Policy 与签名 cursor；Web 只调用同源 BFF。

`ORG-002` 保持同样边界：`OrganizationsService` 执行 Policy、请求摘要与 DTO 映射；
`OrganizationRepository` 独占行锁、membership/邀请/转移持久化和 Audit/Outbox 原子性；Controller
不导入 Prisma。`OrganizationInvitationNotificationHandler` 只解析最小 envelope，
`NotificationRepository` 从 canonical invitation/invitee 生成私有投影。Owner 转移的最终不变量由
PostgreSQL deferred trigger 兜底，不依赖前端隐藏或单次队列执行假设。

`MOD-002` 使用独立 `trust-safety` 应用模块但不增加进程边界：Controller 解析严格公共/Admin
契约和 Policy，Service 管理 opaque receipt、签名 queue cursor、ETag、原因与 Listing 状态转换，
database adapter 独占 actor/session 复核、advisory/row lock、去重和 Report/Appeal/Case/Action/
Audit/Outbox 原子写入。站内通知继续由既有 Worker 从最小 Listing 事件投影，举报证据或举报者身份
不会进入队列 payload。

## 30.4 生成与手写边界

- Prisma client：生成，不手改。
- OpenAPI client/types：确定工具后生成，不把生成文件作为业务逻辑来源。
- JSON Schema/seed：手写并由 CI 校验。
- Migration：Prisma 生成后人工审查；PostGIS/复杂索引可手写。
- Mermaid：手写事实源，可在 CI 渲染检查。

## 30.5 未完成即不能声称完成的事项

本包没有替代：真实品牌资产/版权、用户研究、法律意见、生产云资源、provider 账号、真实测试数据、安全渗透、依赖安装后的完整构建、性能实测和运营团队。Codex 应把这些作为明确 Gate，而不是用占位值默认为已解决。
