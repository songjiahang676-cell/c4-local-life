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
