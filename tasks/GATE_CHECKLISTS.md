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

Gate 2 的 16 个 Backlog 任务均已实现并通过本地完整质量、真实 PostgreSQL 与生产 Chromium 回归；
最终退出还要求 `WEB-004` 的受保护 Linux 真实服务和四镜像门禁、evidence-head、受保护合并及
merged-main 复验全部通过，证据记录在 `tasks/STATUS.md`。

## G3 Search / Web / SEO

- [ ] Outbox、版本索引、reconciliation。
- [ ] 双语/地理/筛选/排序和推广标识。
- [ ] 首页真实数据与模块隔离。
- [ ] canonical/hreflang/sitemap/schema/a11y/performance。

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
