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

## 9.11 SEARCH-001 可执行索引契约

`apps/worker/src/search/listing-index-definition.ts` 固化首个 Listing 公共搜索投影：

- schema version 为 `1`，物理索引为 `<prefix>_listings_v1`，读写 alias 分别为
  `<prefix>_listings_read` 和 `<prefix>_listings_write`；
- 根对象和所有结构化子对象均为 `dynamic: strict`，mapping `_meta` 固定记录版本、PostgreSQL
  canonical source、公共投影和 PII 排除声明；
- 标题、摘要、正文、分类、地区和公开显示名提供双语、中文 CJK bigram、英文 stop/stem 及前缀字段；
  分类/地区路径、价格、动态属性、模糊公开 `geo_point`、公开发布者信号、推广标志和内容版本保持结构化；
- 电话、邮箱、精确地址、联系方式策略、审核状态/备注、风险分、媒体 object key 和认证材料不在
  `ListingSearchDocument` 或 mapping 中。

`ListingIndexManager` 是可重复执行的 create-or-validate 边界。`pnpm search:index:ensure` 只在目标物理
索引不存在时创建 v1 和两个 alias；已有索引必须同时满足 `_meta` 与 alias 契约，否则失败关闭，禁止
原地悄悄修改 mapping。改变字段或 analyzer 必须提升 schema version，并由 `SEARCH-005` 的重建、
追赶、校验和原子 alias 切换流程发布。该命令不读取或写入 PostgreSQL；索引删除不影响 canonical
业务数据。

本地 Compose 与托管 CI 使用相同的 OpenSearch 2.19.5 基线。CI 对真实节点执行 analyzer、mapping、
读写 alias、中文/英文命中、geo filter 和 strict-mapping PII 拒绝测试；单节点 replica 导致 yellow
是预期可服务状态，生产副本数仍由基础设施模板和容量评审确定。

## 9.12 SEARCH-002 索引消费、优先下架与对账

`apps/worker/src/search/listing-index-handler.ts` 严格校验 Listing Outbox envelope，但事件 payload 只
提供 Listing ID、aggregate version 和发生时间。每次消费都通过
`ListingSearchRepository.findById` 从 PostgreSQL 重新读取当前状态、历史表单的 PUBLIC attributes、
taxonomy path/alias 和最小公开发布者信号；不公开或不存在的 Listing 执行删除，当前有效 Listing 才
构造 `ListingSearchDocument`。EXACT 位置只投影为 Region 的 CITY 点，APPROXIMATE/NEIGHBORHOOD
坐标最多保留三位小数，原精确点不进入 DTO 或 OpenSearch。

写入和删除均使用 Listing canonical version 与 `external_gte`。迟到事件会加载较新数据库版本，
OpenSearch 版本冲突视为 stale 而不是覆盖；若 durable event 版本反而领先数据库则重试并告警，不能
用 payload 补齐数据。下架类事件先在 Outbox `claimBatch` 的有界 priority allowlist 中被领取，再以
BullMQ priority 1（普通事件为 10）入队；同一事件同时驱动搜索和通知时顺序执行，重试依赖各消费者
幂等性。

`ListingIndexReconciler` 每五分钟默认扫描 100 个 canonical Listing 状态，以稳定 UUID cursor 分页。
公开行缺失或版本落后会重建，不公开行若仍存在则删除；完成全表后从头开始。索引版本领先 PostgreSQL
无法安全降级，按失败处理并保留重复告警，后续由 `SEARCH-005` 新索引重建。周期和批量由
`SEARCH_RECONCILIATION_INTERVAL_MS` / `SEARCH_RECONCILIATION_BATCH_SIZE` 有界配置控制。
