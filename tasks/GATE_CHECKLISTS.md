# Gate 检查清单

## G0 Foundation

- [x] Lockfile、工具链、托管 CI 可重复。
- [x] JSON/YAML/OpenAPI/Prisma/TypeScript/Lint/Build/Test 通过。
- [x] 四应用容器以非 root 启动并通过最小运行栈健康检查。
- [x] Secret/配置/日志脱敏基线。
- [x] `main` required checks 已用真实失败 PR 阻止合并、绿色 PR 可合并验证。

## G1 Identity / Taxonomy / Media

- [x] Auth/OTP/session/organization 权限负面测试。
- [x] Admin MFA 与最小权限。
- [x] 地区/分类/表单版本可发布回滚。
- [x] 普通媒体 upload quarantine、扫描、重编码和安全变体。

Gate 1 的实施主线与 P0 退出条件已经由受保护 PR #3–#16 验证。`ORG-002` 虽在 Backlog
标记为 G1/P1，但显式依赖 Gate 2 的 `NOTIF-001`，因此按依赖顺序延后；该依赖已由 PR #24
完成，`ORG-002` 的短效邀请、成员变更、至少一名 Owner 和 step-up 转移已由 PR #25
受保护合并。
受限验证文件由 `MEDIA-003`/Gate 4 完成，不能把它混入普通公开媒体的 Gate 1 边界。

## G2 Listings / Moderation

- [x] 五类 Listing 共享状态机、type-detail、价格和过期不变式。
- [x] Public/owner/moderator Repository 查询授权与最小字段投影。
- [x] 草稿创建/owner 读取/组织角色更新、actor-scoped 幂等与强 ETag 并发控制。
- [x] Rental 中英/移动动态表单、防抖自动保存、账号隔离恢复和 READY 图片绑定。
- [x] 提交风险规则版本/命中证据、低风险自动通过和中高风险审核案件。
- [x] Listing 审核队列、脱敏快照/diff、规则证据、并发安全动作和键盘工作流。
- [x] Rental 草稿/提交/审核/发布/编辑/归档/删除/过期完整。
- [x] Job 复用并验收完整状态链。
- [x] Transfer/Secondhand/Service 复用并验收完整状态链。
- [x] 审核、举报、申诉、审计和通知。
- [x] 不可变 revision、真实 diff、owner 原因和重大编辑复审/原期限保护。
- [x] 私有用户中心四状态分组、组织读取边界、强版本批量归档/删除和草稿继续编辑。
- [x] 版本化重复文本/图片/联系方式候选、dry-run、不可变人工反馈与误杀指标。
- [x] 共享账户壳、短效 no-store 能力快照、主动重验、失败关闭和双语错误状态。
- [x] 五类移动端中英文发布 E2E。

Gate 2 的 16 个 Backlog 任务均已实现并通过本地完整质量、真实 PostgreSQL 与生产 Chromium 回归。
`WEB-004` 的受保护 Linux 真实服务和四镜像门禁、evidence-head、受保护合并及 merged-main 复验也已
全部通过，Gate 2 关闭证据记录在 `tasks/STATUS.md`。

## G3 Search / Web / SEO

- [x] Outbox 和 `SEARCH-001` 版本索引/双语 analyzer/geo/公开字段契约。
- [x] `SEARCH-002` 下架优先、external version 和 reconciliation。
- [x] `SEARCH-003` 双语/地理/筛选/排序、PIT cursor 和推广标识。
- [x] `SEARCH-004` 双人词典、同义词、建议、热门隐私阈值、bot/PII 筛查与保留。
- [x] `SEARCH-005` 全量回填、追赶、精确校验、原子 read/write alias 切换、观察窗双写和保留源索引回滚。
- [x] `SEARCH-006` 版本化双语评估集、NDCG@10/MRR/Recall@10/零结果阈值、真实 OpenSearch 回归和隐私安全 Dashboard。
- [x] `WEB-001` 双语 SSR 列表/筛选/详情、公开投影边界、状态/推广标签和错误空态。
- [x] `TAX-003` 严格首页布局白名单、版本草稿/预览/发布/追加回滚和原子缓存失效事件。
- [x] `WEB-002` 首页聚合 API、canonical 公开投影、逐模块错误隔离、真实空态与双语响应式渲染。
- [ ] `WEB-003` 双语响应式全局 Header、公开地区、键盘搜索建议和 PII 最小化账户入口。
- [x] `SEO-001` metadata/canonical/hreflang/robots 与搜索/私有 noindex 矩阵。
- [x] `SEO-002` strict schema.org、真实资源 locale/vertical/month sitemap、过期移除与失败关闭。
- [ ] `SEO-004` a11y。
- [x] `PERF-001` 匿名缓存安全、请求合并、CWV/API 指标和可执行性能预算。
- [x] `EVT-002` 受控 DLQ/Outbox 重放、dry-run 对账、权限审计和 PII 最小化。

## G4 Interaction / Trust

- [ ] 收藏、会话、消息、屏蔽、垃圾限频。
- [ ] 商家/师傅档案和安全验证材料。
- [ ] 评价资格与审核。
- [ ] 支持后台和通知偏好。

## G5 Commerce / Ads

- [ ] SKU/订单/支付/webhook 幂等。
- [ ] 不可变账本和 reconciliation。
- [ ] 推广/广告库存、审核、履约、退款。
- [ ] Finance/Ad Ops 权限分离。

## G6 Production

- [ ] Terraform/CD/灰度/回滚。
- [ ] SLO/告警/值班/Runbook。
- [ ] E2E/压测/故障/恢复演练。
- [ ] 安全审计和隐私/法律/政策批准。
- [ ] 冷启动、Closed Beta、Public Beta、GA 证据。
