# Gate 检查清单

## G0 Foundation

- [x] Lockfile、工具链、托管 CI 可重复。
- [x] JSON/YAML/OpenAPI/Prisma/TypeScript/Lint/Build/Test 通过。
- [x] 四应用容器以非 root 启动并通过最小运行栈健康检查。
- [x] Secret/配置/日志脱敏基线。
- [ ] `main` 必须由 required checks 阻止失败合并（私有仓库的 GitHub Free 套餐限制）。

## G1 Identity / Taxonomy / Media

- [ ] Auth/OTP/session/organization 权限负面测试。
- [ ] Admin MFA 与最小权限。
- [ ] 地区/分类/表单版本可发布回滚。
- [ ] 上传 quarantine、扫描、重编码和私有验证文件。

## G2 Listings / Moderation

- [ ] 五类 Listing 状态机和动态字段。
- [ ] 草稿/提交/审核/发布/编辑/过期完整。
- [ ] 审核、举报、申诉、审计和通知。
- [ ] 移动端中英文发布 E2E。

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
