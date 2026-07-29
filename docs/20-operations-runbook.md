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

## 20.13 Listing 索引同步异常

- 先比较 urgent/normal freshness histogram、Outbox oldest age、BullMQ backlog 和 reconciliation
  outcome，判断延迟位于数据库领取、队列消费、canonical 查询还是 OpenSearch。
- 下架积压时暂停非必要普通消费者并保留 Outbox；不得删除队列或以 payload 直接补文档。确认
  `listing.*` 紧急事件在 claim 与 BullMQ 都保持优先级后再扩容。
- reconciliation 持续 upsert/delete 表示丢事件或索引漂移；持续 failed 或 stale 且索引版本领先
  PostgreSQL 时停止就地修补，保留证据并进入 `SEARCH-005` 新索引重建/alias 切换流程。
- 手工验证只比较 Listing ID、canonical/index version 和是否存在，不把公开索引内容写回 PostgreSQL，
  不在工单复制标题、联系方式、坐标或完整文档。

## 20.14 搜索查询异常

- 先按 HTTP 410/504/503 与 `socal_search_queries_total` 的 expired_cursor/timeout/unavailable 区分
  客户端闲置、慢查询和依赖故障；不得在日志或工单粘贴 query、cursor、PIT、坐标或完整命中文档。
- timeout 增长时检查 cluster rejection/heap/disk、慢查询和固定 facet；不要临时开放脚本、任意聚合、
  更大 limit 或无限 timeout。需要调整时先用版本化数据集和压测证明。
- 410 只要求客户端从第一页重新查询；不要尝试延长或解码用户 cursor。大量 PIT 时确认终页关闭、
  transport 错误清理和 120 秒默认 TTL，必要时先限流而非删除 canonical 数据。
- 503 时保持详情/发布链可用并进入 OpenSearch 故障流程；source/mapping drift 也按 503 fail closed，
  不能忽略字段验证或将索引结果写回 PostgreSQL。

## 20.15 定期运维

每日：关键告警、审核/队列 SLA、支付对账、备份状态。

每周：失败任务、慢查询、搜索质量、依赖漏洞、成本异常、管理员审计抽查。

每月：权限审查、Feature Flag 清理、数据保留任务、容量趋势、恢复点验证。

每季度：灾难恢复演练、渗透/威胁模型更新、供应商与合规审查、运行手册演练。

## 20.16 搜索发现与隐私异常

- `rejected_bot/rejected_sensitive` 突增先检查流量来源、代理解析和阻止词版本，不查看或复制原 query；
  禁止临时降低五来源阈值、关闭筛查或开放 count。
- 词典发布前核对 content hash、编辑者与审核者分离、scope 冲突和 targeted 测试。错误发布通过
  `SearchDictionaryService.rollback` 追加回滚草稿，必须由另一人审核发布为新版本，不更新/删除历史发布行。
- `unavailable` 增长时区分 dictionary/sample/suggestions/trending/retention。普通首屏搜索可降级为
  version 0；建议/热门或已固定非零版本的 cursor 返回 503。不要用手工热门词伪装依赖恢复。
- 每日确认过期清理有进展且最老未过期样本不超过批准窗口；积压时只提高有界批次/调度频率。物理回滚
  按 migration `ROLLBACK.md` 先停写、保留词典审计并让短期样本安全到期。

## 20.17 公共 SSR 页面异常

- 先区分 Search 503/504、cursor 410、taxonomy 部分失败、公开详情 404 和 Web 到 API 的超时/契约失败；
  不在工单复制 query、cursor、正文、发布者标识或完整 API 响应。
- 只有单垂类简单首屏应显示“主数据库最新公开信息”降级横幅；若带 q/价格/cursor 仍出现结果，立即检查
  是否错误放宽了 `canUseCanonicalFallback`。降级页不得发放 canonical 列表 cursor 给 Search。
- 大量通用详情错误时比较匿名 `GET /listings/{id}` 与 OpenAPI 生成类型；不要临时转发用户 Cookie、
  放宽 strict Schema、增加任意代理 path 或把 Owner 响应直接渲染。
- SSR 超时先检查 API origin、网络、响应大小和固定 5 秒预算。禁止把 `API_BASE_URL` 指向用户输入、
  开启 redirect 或为排障记录完整 URL query。
- 回滚 Web 应用不改变 API/数据库；旧 `/housing/rent`、`/business-transfer` 和 `/classified` 当前仅由
  首页链接切换到 canonical 新路由，正式 301/slug 历史表仍由 `SEO-001` 统一处理。

## 20.18 首页布局发布异常

若新首页版本未生效，先核对 scope 当前发布版本、对应 immutable version 和
`homepage.layout.published` Outbox 的 pending/processing/failed 状态。可重试 dispatcher/消费者，
但不得手工 UPDATE 已发布 JSON 或把草稿设为公开。内容错误使用应用层 rollback：复制已知安全历史版本、
追加更高版本并产生新失效事件。只有 migration 故障才按随迁移提供的 roll-forward/rollback 说明处理，
删除表前必须确认版本历史和 Outbox 均已备份。
