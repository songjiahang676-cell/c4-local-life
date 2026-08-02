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

## 10.11 用户中心信息管理

`LIST-009` 的 `/{locale}/account/listings` 先确认 Session，再渲染草稿、审核中、已发布和已归档
四个带计数的 tab。页面保持中英文完整文案、语义 heading/nav/fieldset、可见焦点、live region、
至少 44px 的移动触控目标和无横向溢出；加载、空、失败、未登录、会话不可用和部分批量失败均提供
下一步。类型筛选、选择本页可操作项、20 项上限、批量归档、删除确认和加载更多不会把私有状态写入
URL 或持久客户端缓存。

草稿“继续编辑”进入账号范围编辑路由，从 owner API 读取精确 DRAFT 与 ETag，复用动态表单和 READY
媒体规则；服务器资源优先于设备恢复副本。被审核下架的 SUSPENDED 内容不展示删除动作，以保留申诉
入口。页面、BFF 与 API 都 no-store，metadata noindex/nofollow，公开爬虫不能获得标题或状态列表。

## 10.12 账户中心共享壳

账户总览和子页共享同一个双语响应式壳：身份区只显示安全 display name、受限状态和组织数量，导航按
服务端能力生成并保持可见焦点；桌面为紧凑横向导航，窄屏改为两列/单列触控目标。总览用明确卡片进入
“我的信息”“通知”“发布信息”，只显示已实现能力，不用禁用占位项制造虚假完整度。组织列表将内部
类型/角色枚举映射为中英文用户文案，不显示联系方式。loading、未登录、Session 不可用、重试、受限
账号和无组织均有独立可访问状态；私有页面始终 noindex/no-store。

## 10.12 首页布局配置约束

配置只决定已批准模块的顺序、开关和有界参数，不允许注入组件、任意样式或 HTML。每个 slot 使用稳定
key，用户可见字符串引用可本地化 content key，图片引用受控 asset key；广告模块必须呈现明确赞助标识。
禁用或无真实数据的模块由渲染层隐藏或显示诚实空态，不用占位数字补齐版面。

## 10.13 WEB-003 全局 Header、地区与搜索建议

公开首页、频道列表、搜索结果和详情页共享同一个双语 Header。品牌、主导航、地区选择、全局搜索、
语言切换和账户入口保持一致；当前频道使用 `aria-current`，窄屏允许导航横向滚动，但页面本身不得产生
横向溢出，所有操作目标保持至少 44 CSS px 和可见焦点。

地区选择只读取 active CITY taxonomy，失败时保留“全南加州”这一诚实默认值。搜索建议使用
`combobox` + `listbox` 模式，支持上下方向键、Enter 和 Escape；输入防抖期间立即清除旧结果，loading、
empty 和 unavailable 都有双语可见状态与节制的 live region。地区建议更新地区筛选并清空查询，其余建议
只填充查询；任何状态都不阻止用户直接提交普通 GET 搜索。

地区和建议是匿名公开读取，不转发 Cookie；会话检查仅同源、`no-store`，且 Header 对已登录用户只显示
通用“账户”入口，不把 display name 或联系方式复制到全局 UI。所有三个响应均经过有界 strict parser，
未知顶层字段、重复项、错误 locale、控制/双向字符或越界值失败关闭。
