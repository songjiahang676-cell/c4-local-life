# CODEX START HERE

你正在实现“南加生活网”，不要把本仓库当成一份仅供参考的设计稿。本仓库已经明确产品边界、技术栈、领域边界、接口契约、数据库模型、验收条件和实施顺序。

## 1. 首次读取顺序

开始编码前依次阅读：

1. `README.md`
2. `AGENTS.md`
3. `VALIDATION_REPORT.md`
4. `docs/00-executive-summary.md`
5. `docs/01-assumptions-and-decisions.md`
6. `docs/07-system-architecture.md`
7. `docs/14-security-privacy-compliance.md`
8. `tasks/IMPLEMENTATION_SEQUENCE.md`
9. 当前任务对应的 `docs/`、`openapi/openapi.yaml`、Prisma Schema 和 ADR

然后执行：

```bash
bash scripts/check-architecture.sh
cp .env.example .env
corepack enable
pnpm install
pnpm db:validate
pnpm typecheck
pnpm lint
```

若环境不能联网或依赖无法下载，记录阻塞，仍可完成不依赖安装的文档、契约、SQL、样式与测试编写；不要伪造通过结果。

## 2. 实施总原则

- 按 `tasks/BACKLOG.csv` 的 ID 工作；一次只完成一个可验收切片。
- 首期保持模块化单体。禁止未经 ADR 新增微服务、GraphQL、Kafka、Kubernetes、第二主数据库或另一个前端框架。
- PostgreSQL 是业务主数据；OpenSearch、Redis 和分析系统均是可重建的派生状态。
- 所有状态变更通过 API 应用层完成，禁止控制器直接操作 Prisma。
- 公共 API 必须与 OpenAPI 保持一致；变更接口时先更新契约和契约测试。
- 涉及支付、积分、退款、广告交付的操作必须幂等、可审计，不允许直接覆盖余额。
- 涉及 PII、登录、权限、审核和上传时，先阅读安全文档并补充滥用测试。
- 新功能必须同时考虑中文/英文、移动端、SEO、可访问性、审核和运营后台。
- 不把模拟数字、伪造评价、占位广告当作真实生产数据。

## 3. 每个任务的完成格式

每个任务结束时在工作记录或 PR 描述中给出：

```text
Task: <ID> <标题>
Changed: <核心文件>
Contracts: <OpenAPI/Schema/DB 是否变化>
Migrations: <有/无，是否可回滚>
Security: <威胁与缓解>
Tests run: <实际命令和结果>
Not run: <未执行项及原因>
Observability: <新增日志/指标/追踪>
Docs: <更新的文档>
Known gaps: <剩余问题>
```

不得仅回复“完成”。

## 4. 推荐执行顺序

严格按以下 Gate 推进，完整清单见 `tasks/IMPLEMENTATION_SEQUENCE.md`：

- **Gate 0 — 基础可重复**：安装、构建、格式、CI、容器、环境校验。
- **Gate 1 — 身份与主数据**：用户、会话、区域、分类、媒体上传。
- **Gate 2 — 分类信息闭环**：草稿、发布、审核、列表、详情、编辑、过期。
- **Gate 3 — 搜索和本地发现**：索引、筛选、地理范围、SEO 落地页。
- **Gate 4 — 互动与信任**：收藏、消息、商家/师傅、评价、举报。
- **Gate 5 — 商业化**：订单、Stripe、积分账本、置顶和广告。
- **Gate 6 — 运营与发布**：后台、可观测性、压测、安全审计、灰度上线。

Gate 未通过前，不提前堆叠后续功能。

## 5. 最先要做的任务

从 `FND-001` 开始：让仓库在干净环境中完成安装、静态检查、类型检查和基础构建。随后完成数据库校验与最小健康检查，再进入业务实现。

首页参考图位于：

- `docs/homepage-concept.png`
- `apps/web/public/reference/homepage-concept.png`

参考首页代码位于 `apps/web/src/components/home-page.tsx`。它用于确认视觉分区和响应式方向，不代表最终组件边界、真实数据或可访问性已经完成。

## 6. 遇到不确定性时

优先做最小可逆决策；把假设写入代码注释或任务记录。下列情况必须新增 ADR：

- 改变进程/服务边界；
- 更换数据库、搜索、队列、对象存储或身份方案；
- 改变 API 范式或版本策略；
- 改变账本、退款或广告计费模型；
- 引入不可逆的数据迁移；
- 接受显著的安全、隐私或可用性权衡。

## 7. 禁止事项

- 禁止将 `.env`、密钥、真实手机号/邮箱、生产数据提交到仓库。
- 禁止用前端隐藏代替后端权限校验。
- 禁止把搜索索引作为唯一数据副本。
- 禁止将支付 webhook 当作普通无签名 POST。
- 禁止在队列任务中假设“只执行一次”。
- 禁止在没有迁移、回滚与备份计划时删除字段或表。
- 禁止为了“通过测试”降低验证、关闭类型检查或跳过安全控制。
