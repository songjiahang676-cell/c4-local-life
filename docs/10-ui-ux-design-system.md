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
