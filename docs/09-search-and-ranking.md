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

## 9.13 SEARCH-003 查询、facets、cursor 与 geo

`GET /v1/search` 只读取 `<prefix>_listings_read`，不会读取或写回 PostgreSQL，也不参与 Listing
状态变更。请求通过生成 OpenAPI 类型和严格 Zod 边界限制为 query、Listing type、category UUID、
region code、两位十进制价格、成对 lat/lon、1–100 英里半径、五种排序、短效 cursor 和最大 50 条。
文本先 trim + NFKC，空值、控制符、双向控制符、未知参数、单边坐标、无坐标距离排序和倒置价格均拒绝。

每个第一页请求创建最长 120 秒的 OpenSearch PIT；后续 cursor 由独立 HMAC domain 签名并绑定全部
筛选、排序与 limit，只携带 query SHA-256 fingerprint、PIT、固定 `snapshotAt` 和上一页 sort values。
查询以相同 `snapshotAt` 过滤过期和计算 freshness，并通过 `_score/publishedAt/id`、`publishedAt/id`、
`price/publishedAt/id` 或 `distance/publishedAt/id` 稳定排序。读取 `limit + 1` 判断下一页，终页主动
关闭 PIT；篡改/跨查询重放返回 400，cursor/PIT 过期返回 410。

OpenSearch 请求固定 `PUBLISHED`、`expiresAt > snapshotAt`、显式 filter/source/facet allowlist、
`track_total_hits=false`、禁止 partial search、最多 1500 ms 默认执行时间。响应只映射公开 Listing
摘要、固定 type/category/region/price-unit facets 和可选模糊 point；正文、qualityScore、promotion
引用、indexedAt、审核字段、联系方式和精确位置不进入 `_source` 或 HTTP DTO。任何 source/mapping
漂移失败为 503，不用宽松转换掩盖泄漏。OpenSearch transport/查询超时返回 504，不可用返回 503，
因此 Listing 详情、发布和 canonical 写入链仍可独立工作。

`socal_search_queries_total{outcome,sort,geo}` 只接受固定低基数枚举；query、cursor、PIT、资源 ID、
分类/地区、坐标和金额均不记录。SEARCH-004 负责的同义词、建议和热门查询隐私见下一节；
SEARCH-005 才负责全量重建与 alias 回滚。

## 9.14 SEARCH-004 同义词、建议与热门查询隐私

PostgreSQL 的 `search_dictionary_states/search_dictionary_versions` 是词典事实源。词典只有一个草稿，
发布前必须由不同于最后编辑者的审核人确认；已发布版本不可更新或删除，回滚通过复制历史定义为新草稿，
再由第二人审核发布为追加版本完成。定义限制为中英/通用 locale、可选 region scope、最多 500 组同义词和 1,000 个阻止词；
同 scope 的词不能跨组歧义复用。搜索 cursor v2 固定 `dictionaryVersion`，因此翻页期间发布新词典不会
改变已有 PIT 的查询语义。每次最多展开 8 个审核词，组间 OR、每个词内部仍按 AND 匹配。

`GET /search/suggestions` 可省略 q，空查询只返回 active Category/Region；有 q 时按词典、taxonomy、
达到隐私阈值的近期有效查询去重，最多 10 条并使用 `private, no-store`。`GET /search/trending` 支持
1/7/30 天和可选 region，最多 10 条，响应只公开 rank，不公开 count，并使用五分钟公共缓存。
BUSINESS/PROVIDER 实体建议在相应信任档案任务完成前不进入契约，不使用占位实体或伪造热门词。

只有首屏、有公开结果、长度合规、非 bot 的查询可成为内部样本。email、电话、URL、长数字、地址、
联系方式句柄、控制/双向字符和版本阻止词在写前拒绝；来源只保存由服务端可信 IP 经独立 HMAC domain
生成的 64 位十六进制摘要，不保存 IP/User-Agent。相同 query/source/UTC day 只能贡献一次；任何公开
近期建议或热门词都要求至少 5 个不同来源，读取时再次做敏感词筛查。样本默认 30 天到期，数据库强制
不超过 90 天，过期行按有界批次清理；低频行始终内部可见性且绝不进入响应。

## 9.15 SEARCH-005 可恢复全量重建与 alias 回滚

重建由 PostgreSQL `AdminJob/SearchIndexOperation` 驱动，不以进程内状态或 OpenSearch task 作为唯一
证据。Worker 创建 operation UUID 派生、无 alias 的候选索引，按稳定 Listing UUID cursor 从 canonical
PostgreSQL 重载严格公开投影，并再做一轮追赶。正常 Listing 事件使用 external version 同时写当前
write alias 与候选索引；切换阶段同时写 source/target，保证 alias 已切而 durable completion 尚未提交
时仍可安全回滚。

切换前刷新候选索引，按 ID 顺序比较 PostgreSQL 应公开集合与候选索引全部 `id + contentVersion` 的
数量和滚动 SHA-256；遗漏、额外文档、旧版本或索引领先都会失败关闭。read/write alias 只能在一次
`updateAliases` 中从精确 expected source 切到已验证 target，并在提交后再次确认两者共享唯一 write
index。任何 mapping `_meta` 漂移都会中止，不允许原地放宽 strict mapping。

观察窗口内旧 source 索引继续双写且不自动删除。回滚是独立幂等 Admin job，先重新全量校验仍在双写的
旧 source，再原子恢复两个 alias；已接受的回滚即使跨过窗口截止时间也持续双写 target 直到完成。API
只公开 phase、索引名、数量和固定失败 code，不公开扫描 cursor、摘要、Listing 内容、PII、query 或
provider 原始错误。
