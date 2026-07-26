# 25. 团队协作与系统所有权

## 25.1 建议团队

- Product Lead：范围、优先级、指标和政策协调。
- UX/Product Designer：双语、移动、可访问性和设计系统。
- Tech Lead/Architect：边界、ADR、质量 Gate 和跨模块风险。
- Frontend Engineers：Web/Admin、SEO、性能、可访问性。
- Backend Engineers：API、领域、数据、集成、Worker。
- QA/SDET：自动化、测试数据、迁移、E2E、性能。
- Platform/SRE（可兼职起步）：CI/CD、云、可观测、恢复、安全基线。
- Trust & Safety/Ops：规则、审核、举报、培训和内容政策。
- Growth/Content：城市/分类供给、SEO 内容和商家合作。
- Legal/Privacy/Finance advisors：关键 Gate 审查。

## 25.2 模块所有权

| 模块                 | Primary        | Secondary       |
| -------------------- | -------------- | --------------- |
| Web/SEO              | Frontend       | Growth/Backend  |
| Admin                | Frontend       | Ops/Backend     |
| Identity/Permissions | Backend        | Security/QA     |
| Listings/Taxonomy    | Backend        | Product/Ops     |
| Search               | Backend/Search | Growth/Platform |
| Messaging/Trust      | Backend        | T&S/QA          |
| Commerce/Ads         | Backend        | Finance/Ad Ops  |
| Database/Migrations  | Backend/Data   | Platform        |
| Infra/Observability  | Platform       | Backend         |
| Policies/Moderation  | T&S/Product    | Legal/Backend   |

每个 owner 维护代码、Runbook、Dashboard、SLO、Backlog 和文档。所有权不意味着单人可绕过审查。

## 25.3 工作节奏

- 每周产品/运营/工程风险与指标复盘。
- 每次 Gate 前做架构、隐私、安全、运营容量和发布评审。
- ADR 用于材料决策，不用来记录每个小实现。
- RFC/设计评审应包含目标、非目标、数据流、权限、失败、迁移、测试和观测。
- 技术债必须有影响、owner、期限，不能只列“以后重构”。

## 25.4 Definition of Ready

任务进入开发前应有：用户价值、范围/非范围、设计或流程、验收标准、数据/权限影响、契约变化、依赖、Feature Flag 和分析事件。高风险功能还需威胁模型/政策意见。

## 25.5 Codex 与人工协作

Codex 适合按清晰任务生成实现、测试、迁移和文档，但关键决策、生产凭据、法律政策、数据迁移执行和发布批准必须有人负责。

建议流程：

1. 人工选定 Backlog ID 和上下文。
2. Codex 阅读仓库事实源并提出最小实施计划。
3. Codex 编码并运行测试，报告未运行项。
4. 人工审查业务规则、安全、迁移和 UX。
5. CI/staging 验证；高风险功能做双人批准。

不得让 Agent 自行选择生产资源、创建付费云服务、接触真实密钥或执行不可逆生产迁移。

## 25.6 质量与事故文化

- 无责复盘，聚焦系统和流程而非个人。
- 事故 action item 进入正常 Backlog，有 owner 和期限。
- 交付速度必须同时看变更失败率、MTTR、诈骗/误杀、用户任务完成率。
- 临时手工操作应尽快转化为受控工具或 Runbook。

## 25.7 GitHub 所有权与合并治理

`.github/CODEOWNERS` 覆盖应用、契约、数据库 schema/迁移、基础设施、安全、商业化和 ADR。当前个人
私有仓库的全部路径映射到真实维护者 `@songjiahang676-cell`，因此 GitHub 可以解析规则；建立 organization
并增加第二维护者后，应按 25.2 的角色拆分为真实 team，并为关键路径启用 code-owner review。

`.github/pull_request_template.md` 要求每个变更填写 Backlog ID、范围、契约/数据影响、授权/隐私/幂等、
回滚、实际测试、未运行项、可观测和已知缺口。高风险检查不得以“不适用”掩盖实际影响；确实不在范围时
应明确说明原因。

`pnpm governance:check` 验证关键路径存在真实格式的 owner、没有遗留 `*-owners`/`*-maintainers`
角色占位符，并检查 PR 模板必填审查项。个人仓库阶段由 required CI check 提供合并保护；至少有两名
维护者后再启用 required approval 和 code-owner review，避免要求作者批准自己的 PR。

当前真实 owner 映射和 PR 模板已在 PR #1 被 GitHub 解析；但个人 GitHub Free 套餐不允许为私有仓库
配置 required checks。该外部限制不通过降低治理要求、伪造团队或擅自公开代码规避。
