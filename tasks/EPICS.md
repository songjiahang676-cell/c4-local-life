# Epic 清单

| Epic                       | 目标                | 关键输出                                          |
| -------------------------- | ------------------- | ------------------------------------------------- |
| FND Foundation             | 可重复开发/构建/CI  | lockfile、工具链、容器、配置、CI                  |
| DATA Data Platform         | 主数据和迁移可靠    | Prisma、PostGIS、migration、seed、backup          |
| API API Platform           | 一致 HTTP 契约      | middleware、Problem Details、OpenAPI、idempotency |
| AUTH Identity              | 安全注册/登录/会话  | OTP、session、profile、MFA、recovery              |
| ORG Organizations          | 多人商家/服务商管理 | org、membership、invites、policy                  |
| TAX Taxonomy               | 城市/分类/表单配置  | version、publish、rollback、translation           |
| MEDIA Media                | 安全上传与变体      | presign、scan、transform、private docs            |
| LIST Listings              | 五类信息闭环        | draft、submit、publish、edit、expire              |
| MOD Moderation             | 风控/审核/举报/申诉 | rules、case、action、audit、SLA                   |
| EVT Async Events           | 可靠副作用          | outbox、queues、DLQ、reconciliation               |
| SEARCH Search              | 双语本地发现        | index、query、facet、geo、trends                  |
| WEB Public Web             | 首页与公开页面      | homepage、list/detail、forms、account             |
| SEO SEO/i18n/a11y          | 可发现和可使用      | metadata、sitemap、i18n、WCAG                     |
| FAV Favorites              | 用户保存            | API/UI/events                                     |
| MSG Messaging              | 安全沟通            | conversation、message、block、spam                |
| TRUST Businesses/Providers | 本地信誉目录        | profiles、verification、signals                   |
| REV Reviews                | 真实评价            | eligibility、moderation、response                 |
| NOTIF Notifications        | 多渠道提醒          | preferences、templates、deliveries                |
| COM Commerce               | 订单/支付/账本      | Stripe、refund、wallet、reconcile                 |
| ADS Advertising            | 固定库存广告        | placements、campaigns、delivery                   |
| ADMIN Operations           | 运营工作台          | moderation、support、finance、config              |
| OBS Observability          | 可监控/可响应       | logs、metrics、traces、alerts                     |
| PERF Performance           | 容量与降级          | budgets、load、failure tests                      |
| SEC Security               | 安全验证            | threat model、scans、pentest                      |
| PRIV Privacy               | 数据权利/保留       | request workflow、retention、hold                 |
| REL Release/Infra          | 云与发布            | Terraform、CD、DR                                 |
| QA Quality                 | 自动化与 Gate       | unit/integration/E2E/accessibility                |
| LAUNCH Launch              | 冷启动与灰度        | import、beta、GA readiness                        |

每个 Epic 的具体任务、优先级和依赖在 `BACKLOG.csv`。
