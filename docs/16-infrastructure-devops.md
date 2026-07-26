# 16. 基础设施、环境与 DevOps

## 16.1 环境

| 环境       | 用途                                | 数据             |
| ---------- | ----------------------------------- | ---------------- |
| local      | 单人开发，Docker Compose 依赖       | 生成/种子数据    |
| preview    | PR 临时 Web/Admin，API 可共享或隔离 | 合成数据         |
| dev        | 团队集成                            | 合成/匿名数据    |
| staging    | 生产等价、迁移/压测/演练            | 合成或严格去标识 |
| production | 用户服务                            | 真实数据         |

生产与非生产使用独立云账号/项目、网络、密钥和数据。禁止把生产数据库快照直接恢复到开发。

## 16.2 AWS 生产拓扑

- Route 53：DNS。
- CloudFront：静态/媒体/公开 Web 加速。
- AWS WAF + Shield 基线：机器人、速率、常见攻击和紧急规则。
- ALB：Web/Admin/API 路由与健康检查。
- ECS Fargate：web、admin、api、worker 多 service。
- RDS PostgreSQL/PostGIS Multi-AZ：业务主数据。
- ElastiCache Redis：缓存/队列（根据 BullMQ 兼容性验证部署模式）。
- OpenSearch Service：搜索读模型。
- S3：public-derived media、private quarantine、restricted verification、logs 分桶/前缀。
- SES：邮件；短信适配器可用 SNS/Twilio。
- Secrets Manager/SSM + KMS：密钥和配置。
- CloudWatch/OTel collector：日志、指标、追踪。
- ECR：镜像仓库，开启扫描和不可变标签。

Terraform 蓝图见 `infra/terraform/`。生产实施前需要成本、安全和网络评审。

## 16.3 网络

- 公开子网仅 ALB/NAT（若使用）；应用、数据库、Redis、OpenSearch 在私有子网。
- Security Group 以 service-to-service 最小端口，不使用广泛 CIDR。
- ECS 任务出站通过 NAT/VPC endpoint；对 S3/ECR/Logs 使用 endpoint 降低暴露和成本。
- Admin 可在公共 ALB 后使用 SSO/访问代理和 WAF，或使用独立受限入口。
- 数据库无公网地址；运维通过受审计 SSM/临时访问。

## 16.4 容器

- 多阶段构建、非 root、只读根文件系统（可行时）、最小基础镜像。
- 固定 Node 主版本和 lockfile；生产依赖 `--frozen-lockfile`。
- 镜像包含版本/commit/build time OCI labels，不包含 `.env`。
- Web/Admin/API/Worker 独立镜像或共享基础层，按变化和安全权衡。
- 每个进程实现 `/health/live`、`/health/ready`；readiness 检查关键依赖但避免雪崩。

## 16.5 CI 流水线

PR：

1. 静态架构检查与 secret scan。
2. 安装锁定依赖。
3. format、lint、typecheck。
4. Prisma validate/generate，迁移静态检查。
5. unit/contract/integration；必要时启动 PostgreSQL/Redis/OpenSearch。
6. Web/Admin/API build。
7. OpenAPI/JSON Schema 校验、依赖/许可证、SAST/IaC/container scan。
8. Preview 和 Playwright smoke（适用时）。

主分支：构建签名镜像、推 ECR、部署 dev；通过 Gate 后提升同一 artifact 到 staging/prod，不重新构建。

### 16.5.1 GitHub 合并保护

远程仓库创建后，`main` ruleset/branch protection 至少要求以下两个 GitHub Actions check：

- `Static, contracts, tests, and build`
- `Build non-root application images`

同时要求 pull request、解决全部 review conversation，并禁止普通贡献者绕过。当前个人私有仓库只有一名
维护者，不能要求作者自我批准；增加第二维护者后必须再开启至少一名批准者、CODEOWNERS 审查和推送新提交后
撤销过期批准。平台管理员应保存一次失败 PR 被阻止和一次完整绿色 PR 可合并的证据。本地
`pnpm ci:workflow:check` 只能验证 workflow 内容，不能替代 GitHub 执行和 ruleset 证据。

仓库 `songjiahang676-cell/c4-local-life` 已由 PR #1 和 GitHub Actions run `30186346943` 证明两项
check 可完整通过，早期 runs `30185510707`、`30185679624` 保留了干净环境缺陷及修复证据。
项目负责人于 2026-07-25 明确授权将仓库公开，随后 `main` branch protection 配置为：必须经 PR、
两项 required checks、strict/up-to-date、解决全部 conversation、管理员不可绕过、禁止强推和删除。
临时 PR #2/run `30187032798` 故意引入一个内部断链，质量检查失败且 GitHub 返回
`mergeStateStatus=BLOCKED`；验证后 PR 已关闭、临时分支已删除。由此 FND-003 的失败阻止和绿色可合并
两类外部证据均完整。

## 16.6 CD 与发布

- 数据库采用向前兼容迁移，先 migration job 再应用 rollout。
- ECS rolling 或 blue/green；健康检查、错误率和 latency 自动停止。
- Feature Flag 将部署与功能发布分离。
- 生产审批记录版本、迁移、风险、回滚、负责人和监控窗口。
- 回滚代码前确认数据库向后兼容；不能简单回滚的变更采用 roll-forward。

## 16.7 配置

- 非敏感配置按环境注入，敏感值来自 Secret Manager。
- `packages/config` 在启动时做 schema 校验；缺失关键配置直接 fail fast。
- Feature Flag 具有 owner、默认值、目标环境、到期日和删除任务。
- 城市、分类、首页编排、审核规则属于版本化业务配置，不硬编码在环境变量。

## 16.8 数据库迁移部署

- 只运行一个迁移作业，使用数据库 advisory lock/平台机制防并发。
- 部署前自动备份/恢复点，检查迁移 SQL 的锁、扫描和回滚策略。
- 大回填由可观测 Worker 分批执行，不占用发布超时。
- 迁移成功和应用兼容验证后再扩大流量。

## 16.9 成本控制

- 开始阶段选择合理小规格并设自动扩展/告警，不盲目预留大集群。
- CloudFront/S3 图片变体减少原图流量；日志按级别和保留分层。
- OpenSearch 规模和分片需实测，通常是主要固定成本之一。
- 非生产环境定时缩容/停机，Preview 自动过期。
- 每月按服务、环境、功能标签审查成本与单位经济指标。

## 16.10 基础设施事实源

Terraform 是云资源事实源；禁止长期手工改生产。紧急控制台修改必须记录并尽快回写 IaC。AWS Organizations/CloudTrail/Config/GuardDuty 等组织级能力由平台安全方案补齐。
