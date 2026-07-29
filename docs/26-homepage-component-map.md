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
GET /v1/homepage?locale=zh-Hans&regionCode=US-CA-SOCAL&device=desktop
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

## 26.7 TAX-003 可发布布局契约

首页布局现在按 locale 与可选 region code 版本化。一个定义最多 32 个稳定 key slot，类型限定为
Hero、热门搜索、城市、Listing feed、商家、师傅、广告、行情、资源产品和门户链接；每类 source 只
包含其执行所需的有界枚举、ID、content/asset/placement/collection key 和 limit/TTL。配置不含实时
业务数据、任意 HTML、外部 URL、查询表达式或私有字段。草稿可 preview；publish 切换 canonical
版本；rollback 复制历史配置为新版本并发送原子失效事件。`WEB-002` 负责从各领域公开投影装配数据，
模块失败需隔离为真实空态/错误态，不能从 layout seed 伪造 500 条内容或生产指标。

## 26.8 WEB-002 已实现模块映射

公共响应与 SSR 目前只实现具有 canonical 数据口径的四类：

| Layout kind  | API 数据源                                 | Web 组件        | 空/错策略                                  |
| ------------ | ------------------------------------------ | --------------- | ------------------------------------------ |
| HERO         | allowlist 本地化 `contentKey`              | `Hero`          | 无文案时隐藏；无可用 Hero 时显示全页恢复态 |
| HOT_SEARCHES | 隐私安全 Search Discovery                  | `Trending`      | 空集合隐藏；依赖失败令响应 partial         |
| CITY_CHIPS   | active CITY taxonomy                       | `CityModule`    | 空集合隐藏；链接只携带公开 region code     |
| LISTING_FEED | region-scoped PostgreSQL 公共 Listing 投影 | `ListingModule` | 空集合隐藏；推广使用文字披露               |

API 应用服务从已发布 layout 读取顺序并并发装配，Controller 不访问 Prisma；Web 只调用一次
`/v1/homepage` 并在 strict contract 后进行 Server Component 渲染。原参考实现中的 `256,893`、虚构
商家/师傅、评分、广告、价格行情和模拟 Listing 已从生产运行路径移除。BUSINESS_FEATURED、
PROVIDER_FEATURED、AD、PRICE_METRIC、RESOURCE_PRODUCTS、PORTAL_LINKS 即使出现在布局中，也必须等
各自真实领域投影和验收完成后才能加入公共响应。
