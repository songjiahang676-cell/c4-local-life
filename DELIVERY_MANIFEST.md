# 南加生活网架构包交付清单

本文件是给项目负责人和 Codex 的交付索引。该包是“完整架构书 + 机器可读契约 + 实施 Backlog + 参考 Monorepo”，不是已经上线的生产网站。

## 一、交付规模

- 31 章架构正文，合并版约 3,000 行；
- 6 份架构决策记录（ADR）；
- 101 个带依赖与验收条件的实施任务；
- 31 个 OpenAPI path、52 个 schema；
- 36 个初始 Prisma model；
- 3 份 JSON Schema、4 组种子数据；
- 9 张 Mermaid 架构/流程/ER 图；
- Web、Admin、API、Worker 四个应用骨架；
- Config、Contracts、Database、UI 四个共享包；
- Docker Compose 本地依赖、GitHub Actions CI、Terraform 模块合同；
- 原始首页设想图与响应式首页参考实现。

## 二、Codex 必读入口

按以下顺序读取：

1. [`CODEX_START_HERE.md`](./CODEX_START_HERE.md)
2. [`AGENTS.md`](./AGENTS.md)
3. [`README.md`](./README.md)
4. [`tasks/IMPLEMENTATION_SEQUENCE.md`](./tasks/IMPLEMENTATION_SEQUENCE.md)
5. [`tasks/BACKLOG.csv`](./tasks/BACKLOG.csv)
6. 当前任务关联的 `docs/`、`adr/`、OpenAPI、Prisma 与 JSON Schema

可直接把 [`tasks/CODEX_PROMPT.md`](./tasks/CODEX_PROMPT.md) 的内容作为 Codex 首条项目提示词。

## 三、关键事实源

| 主题               | 事实源                                                                        |
| ------------------ | ----------------------------------------------------------------------------- |
| 总体架构           | `docs/07-system-architecture.md`、`adr/`                                      |
| 产品和范围         | `docs/02-product-requirements.md`、`docs/19-delivery-roadmap.md`              |
| 信息架构/路由      | `docs/03-information-architecture.md`、`docs/27-route-catalog.md`             |
| 数据               | `packages/database/prisma/schema.prisma`、`docs/06-domain-and-data-model.md`  |
| API                | `openapi/openapi.yaml`                                                        |
| 动态表单/首页/埋点 | `schemas/`                                                                    |
| 安全与隐私         | `docs/14-security-privacy-compliance.md`、`SECURITY.md`                       |
| 搜索               | `docs/09-search-and-ranking.md`、`adr/0002-*`                                 |
| 审核/风控          | `docs/11-content-workflows-and-moderation.md`                                 |
| 广告/支付/积分     | `docs/12-monetization-payments-ads.md`                                        |
| DevOps/运维        | `docs/16-infrastructure-devops.md`、`docs/20-operations-runbook.md`、`infra/` |
| 验收               | `docs/22-acceptance-criteria.md`、`tasks/GATE_CHECKLISTS.md`                  |
| 当前验证状态       | `VALIDATION_REPORT.md`                                                        |

发生冲突时，按 `README.md` 的“事实源优先级”处理。

## 四、第一次交给 Codex 的执行指令

```text
请把本目录作为唯一项目基线。先阅读 CODEX_START_HERE.md 和 AGENTS.md，
然后从 tasks/BACKLOG.csv 的 FND-001 开始。不要提前实现后续功能，
不要改变架构边界，除非新增 ADR。实际运行所有可运行命令，报告真实结果；
未运行的命令必须明确标注。完成后按 CODEX_START_HERE.md 第 3 节格式交付。
```

## 五、项目负责人需要尽快确认的业务输入

- 正式中文/英文品牌名、域名、Logo 和素材权属；
- 首发城市与分类范围；
- 免费发布额度、过期/续期规则、置顶和广告价格；
- 商家/师傅认证材料和审核 SLA；
- 联系方式公开策略、敏感分类和禁止内容；
- 短信、邮件、地图、支付、客服和云账号；
- 隐私政策、用户协议、退款政策和 California 合规法律审查；
- Beta 时间、预算、运营/审核班次与上线责任人。

## 六、交付边界

该包不包含真实生产密钥、生产云资源、法律意见、第三方账号、真实用户数据、完成的支付/登录/审核业务或经实测的容量数据。所有规划数字均为设计假设，必须在 Beta 前验证。
