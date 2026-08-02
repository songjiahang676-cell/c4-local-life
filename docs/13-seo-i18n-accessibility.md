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

`WEB-001` 先落实模板级安全基线：全站搜索及带任意筛选/cursor 的频道页为 `noindex,follow`，公开
频道/城市与详情只生成描述性 title/description。`SEO-001` 进一步统一绝对 canonical、中英
`hreflang`/`x-default`、Open Graph/Twitter 与 robots；结构化数据和 sitemap 分片由独立 `SEO-002`
完成，不能把后者误报为当前任务已关闭。页面具备
skip link、main/nav/search/aside/article 语义地标、连续标题、原生 label、44px 控件、可见焦点、
纯文字广告/状态标签、`bdi` 用户内容隔离以及 720/520px reflow。货币和日期使用 `Intl` 与
`America/Los_Angeles`；用户正文保留原语言，不伪装机器翻译。axe、200% zoom 和屏幕阅读器人工基线
仍由 `SEO-004` 验收。

## 13.11 SEO-001 实施矩阵

- `PUBLIC_WEB_URL` 是绝对 canonical、社交 URL 和 robots Host 的部署事实源；只接受无凭据的
  HTTP(S) origin，本地无效配置回退到 localhost，生产无效配置还会强制 noindex；不从请求 Host
  推断可信生产域名。
- 首页和五类频道无查询根页为 `index,follow`，并声明真实存在的 `zh-Hans`、`en-US` 与
  `x-default` 等价路径；任意未知/重复/筛选/cursor 参数都切换为 `noindex,follow`，canonical
  永远移除 query。
- 城市频道默认 `noindex,follow`。Growth/Ops 只有在内容达到最低有效供给并批准后，才可把精确
  `<vertical>:<city-slug>` 加入 `SEO_INDEXABLE_CITY_ROUTES`；任一非法或越界白名单值会使整份配置
  失败关闭为空集。
- 详情只有匿名公共 Listing API 返回的 PUBLISHED、未过期投影可索引；错误垂类/UUID 返回 404，
  非 canonical 城市/slug 永久跳转。title/summary 先 NFKC、移除控制/双向字符和 HTML-like 标签，
  再按 code point 限长；用户正文、联系方式和私有字段不进入 metadata。
- 全站搜索、占位入口、登录、账户、发布草稿和管理页面分别保持 `noindex,follow` 或
  `noindex,nofollow`。Web `robots.txt` 禁止 BFF、健康检查和私有路径但允许抓取搜索页以读取
  noindex；Admin `robots.txt` 全站禁止抓取。
- sitemap、schema.org、索引质量后台与 Search Console 观测仍属于 `SEO-002`/后续运营任务；当前
  robots 不伪造 sitemap 地址，也不为没有真实评价的页面生成评分。

## 13.12 SEO-002 结构化数据与 Sitemap 实施矩阵

- 首页只有无 query 的规范路径输出 `WebSite` 与真实可用的 `/[locale]/search?q={search_term_string}`
  `SearchAction`；频道、获批城市和详情用 `BreadcrumbList` 表达页面可见的同源路径层级。带 query、
  全站搜索、未批准城市、依赖错误和私有模板不输出索引型 JSON-LD。
- `JobPosting` 只为匿名公共 API 当前返回的 PUBLISHED、已发布且未过期 Job 构建；必须存在页面可见的
  summary、雇主和用工形式，只给城市/California/US 粒度位置。它不推断薪资、不读取正文联系方式、
  owner-only/未知属性、精确坐标、审核/风险或评分；缺字段与到期记录直接省略整个 Job schema。
- JSON-LD builder 与 renderer 执行 exact-key runtime Schema、同源 URL、日期顺序、文本/列表上限和
  script-safe escaping。额外 `aggregateRating` 等未知键使整节点失败关闭，不能靠 TypeScript 类型替代
  运行时验证。
- `/sitemap.xml` 是动态 index；静态子分片按 locale，Listing 子分片按
  `locale + vertical + published YYYY-MM`。索引只列出实际含当前 Listing 的月份，并用该月最新
  `updatedAt` 作为 `lastmod`；静态分片不伪造修改时间。
- Listing 子分片只分页读取 canonical `GET /listings` strict 投影，并再次检查 `publishedAt <= now <
expiresAt`、去重稳定 UUID、输出 canonical 与双语 alternate。每次最多读取/输出 10,000 条、200 页、
  15 秒且 XML 不超过 10 MB；超限、cursor 循环、malformed/不可用来源或不可信生产 public origin 均
  无缓存 503，不静默丢 URL。首期不创建另一份 sitemap 数据库或依赖 OpenSearch，因此状态变化无需
  同步两份事实；每次读取都重新从 PostgreSQL 公开投影验证。
- 静态分片仅含双语首页、五个已实现频道和同时通过 `SEO_INDEXABLE_CITY_ROUTES`、active Region API
  校验的城市频道。搜索/query、账户、发布、BFF、健康检查、Admin 和未来占位路由不会出现。Web
  robots 仅在这些真实端点完成后声明 `/sitemap.xml`。
- 成功/失败响应均 `X-Robots-Tag: noindex`、`nosniff`；成功也 `no-store` 以避免到期记录被 CDN stale
  保留。失败只写固定 `seo.sitemap_generation_failed`/scope 结构化事件与低基数 Server-Timing，
  不记录 URL、cursor、Listing/用户 ID、内容或 provider error。

## 13.13 SEO-004 可访问性基线

- 所有当前 Web 模板从 locale layout 获得本地化 skip link；每个实际 `<main>` 提供唯一
  `#main-content` 和程序化焦点目标。激活跳转后主内容获得可见焦点，不能只滚动页面。
- 主要公开、发布、私有和 Admin 边界由固定 axe 4.12.1 在 production standalone Desktop Chrome 与
  Pixel 7 扫描 WCAG 2.0/2.1/2.2 A/AA 标签；隐藏移动文字的按钮仍必须保留显式 accessible name。
- 普通文字对比度至少 4.5:1；交互目标至少满足 WCAG 2.2 的 24 CSS px。表单错误使用 alert 摘要、
  `aria-invalid`、`aria-describedby`，并把焦点移到第一处错误。
- 320 CSS px reflow、forced colors、reduced motion 与横向页面溢出进入生产浏览器回归；该证据不等于
  真实 200% 浏览器缩放或屏幕阅读器人工通过。
- 实际工具、模板、结果和未关闭项只记录在
  [`accessibility-baseline.md`](./accessibility-baseline.md)。真实 Narrator/Edge 与 200% zoom 未完成
  前，`SEO-004` 和 Gate 3 必须保持未关闭。

## 13.14 SEO-003 i18n message/format/routing 基线

- Web 只使用标准 `zh-Hans` 和 `en-US` locale，默认为 `zh-Hans`。`/en` 是仅用于兼容的
  展示别名，必须以 308 保留后缀路径和 query 转到 `/en-US`；canonical、hreflang、内部链接和
  locale switch 始终输出标准 locale。
- 语言切换只替换第一个精确 locale segment，保留后续资源路径；绝对 URL、protocol-relative
  路径、query/hash、反斜杠、重复斜杠、控制字符和双向控制字符均失败关闭。不依据
  `Accept-Language` 静默改变 URL。
- root layout 从请求路径派生的内部 locale header 输出文档级 `<html lang>`。Proxy 每次覆盖
  客户端同名 header，因此客户端不能伪造文档语言；locale layout 仍在局部边界输出同值
  `lang` 和本地化 skip link。
- common/search/listings 资源使用强类型中英 key 等价目录；参数化计数使用
  `Intl.PluralRules` 和 `Intl.NumberFormat`，不拼接翻译片段。日期/相对时间统一使用
  `Intl` 与 `America/Los_Angeles`；固定小数金额先保留字符串精度，用 `BigInt` 和
  `formatToParts` 显示，不先转 IEEE 浮点数。
- 单元测试覆盖 locale/catalog/Intl/路径篡改负例；production Chromium 在桌面和移动端
  验证别名转向、双语文档 `lang`、伪造 header 覆盖与深层 locale switch。
