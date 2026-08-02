# 实施顺序与 Gate

本文件是 Codex/工程团队的执行主线。不要同时铺开所有 Epic。

## Gate 0 — Foundation

顺序：

1. `FND-001` 可重复安装与 lockfile。
2. `FND-002` 统一 TypeScript/ESLint/Prettier/Test 配置。
3. `FND-003` CI 与静态契约检查。
4. `FND-004` 环境配置 schema、secret 处理。
5. `FND-005` 容器、健康检查、本地 Compose。
6. `DATA-001` Prisma validate/generate 和初始 migration。
7. `OBS-001` 请求 ID、结构日志、基础 metrics/traces。
8. `API-001` API 基础 middleware、Problem Details、OpenAPI serving。

Gate 验收：`docs/22-acceptance-criteria.md#221-gate-0-验收`。

## Gate 1 — Identity / Taxonomy / Media

1. `AUTH-001` session model and auth context。
2. `AUTH-002` OTP request/verify + rate limits。
3. `AUTH-003` profile/sessions/security endpoints。
4. `ORG-001` organization/membership + policy。
5. `TAX-001` regions/categories repository + seed。
6. `TAX-002` schema version/publish/rollback。
7. `MEDIA-001` upload intent/quarantine。
8. `EVT-001` 最小 production Outbox dispatcher；这是 MEDIA-002 和 NOTIF-001 的共同显式依赖。
9. `MEDIA-002` scan/transform/READY lifecycle。
10. `ADMIN-001` admin auth/RBAC shell 与 fail-closed MFA gate。
11. `AUTH-005` TOTP MFA、恢复码、step-up 与近期认证。
12. `AUTH-004` 可选密码登录、恢复冷却、通知与会话全撤销。

先完成权限负面测试，再进入 Listing。

## Gate 2 — Listings / Moderation

选择 Rental 作为第一垂直切片：

1. `LIST-001` domain state machine/invariants。
2. `LIST-002` repository + public/owner projections。
3. `LIST-003` draft create/read/update + concurrency。
4. `LIST-004` dynamic rental form + autosave/upload。
5. `MOD-001` submit/risk evaluation/case creation。
6. `ADMIN-002` moderation queue/detail/action。
7. `LIST-005` publish/detail/list/expire/archive。
8. `NOTIF-001` listing status notifications。
9. `LIST-006` replicate pattern to Job。
10. `LIST-007` Transfer/Secondhand/Service。
11. `MOD-002` reports/appeals/audit。

不要先复制五套 CRUD；先证明一条完整状态链。

## Gate 3 — Search / Homepage / SEO

1. `EVT-001` production Outbox dispatcher + idempotency。
2. `SEARCH-001` mapping/analyzers/versioned index。
3. `SEARCH-002` indexing worker + delete priority/reconciliation。
4. `SEARCH-003` query/facets/cursor/geo。
5. `SEARCH-004` synonyms/suggestions/trending privacy。
6. `WEB-001` listing pages and filters。
7. `WEB-002` homepage module API + component refactor。
8. `SEO-001` metadata/canonical/hreflang/robots；结构化数据和 sitemap 由独立 `SEO-002` 验收。
9. `PERF-001` cache and Web performance budgets。
10. `SEO-002` strict schema.org + canonical locale/vertical/month sitemap partitions。
11. `SEO-004` automated/manual accessibility baseline and Gate evidence。
12. `EVT-002` controlled DLQ replay/reconciliation、Admin Policy/audit and PII-minimized evidence。
13. `SEARCH-005` durable rebuild/catch-up/validation、atomic alias switch and retained-source rollback。

## Gate 4 — Interaction / Trust

1. `FAV-001` favorites。
2. `MSG-001` conversation/message model/API。
3. `MSG-002` UI + realtime strategy/polling first。
4. `MSG-003` blocking/rate limits/reporting。
5. `TRUST-001` business/provider profiles。
6. `TRUST-002` verification conclusion/secure documents。
7. `REV-001` review eligibility/response/moderation。
8. `NOTIF-002` preferences/email/SMS adapters。
9. `ADMIN-003` support/user/org workspaces。

首期消息可从轮询/短刷新开始；确有需求再加 WebSocket，不因“聊天”默认复杂化。

## Gate 5 — Commerce / Ads

1. `COM-001` catalog/SKU/price version/order。
2. `COM-002` Stripe checkout/payment/webhook receipt。
3. `COM-003` ledger/wallet/reconciliation。
4. `COM-004` promotion fulfillment/refund。
5. `COM-005` subscription/package entitlement（默认关闭）。
6. `COM-006` opt-in auto top-up policy/provider port（默认关闭）。
7. `ADS-001` placements/inventory/reservation。
8. `ADS-002` campaign/creative/review/schedule。
9. `ADS-003` qualified impression/click/report。
10. `ADMIN-004` finance/ad ops workspaces。

支付测试先证明重复、乱序、超时和退款，再开放真实模式。
正式公开上线后的前 12 个月保持全站免费；周年日只触发商业化准备复核，不自动开启收费或自动充值。

## Gate 6 — Production

1. `REL-001` IaC production implementation。
2. `REL-002` deployment/migration/rollback automation。
3. `OBS-002` SLO/dashboard/alerts/runbooks。
4. `QA-001` full E2E/accessibility/migration suites。
5. `PERF-002` load/soak/failure tests。
6. `SEC-001` threat model/security scan/pentest remediation。
7. `PRIV-001` privacy requests/retention jobs/legal hold。
8. `LAUNCH-001` import/cold start/closed beta。
9. `LAUNCH-002` public beta/SEO/operations readiness。

## Gate discipline

- 每个 Gate 退出前更新 `CHANGELOG.md` 和验收证据。
- 后续 Gate 可做 spike，但不可合并未受控的生产功能。
- 任务依赖/优先级以 `BACKLOG.csv` 为准；发生变化更新文件和理由。
