# Infrastructure Blueprint

本目录描述生产 AWS 拓扑与 Terraform 模块合同。当前是架构级蓝图，不会创建付费云资源；`REL-001` 负责在目标 AWS Organizations/账号、区域、域名和预算确认后实现并评审真实资源。

- `terraform/`：变量、命名、模块边界和环境契约。
- 生产目标：CloudFront/WAF → ALB → ECS Fargate，RDS PostgreSQL/PostGIS、ElastiCache Redis、OpenSearch Service、S3、ECR、KMS/Secrets Manager、CloudWatch/OTel。
- 本地依赖使用根目录 `docker-compose.yml`。

禁止 Agent 在未获授权时执行 `terraform apply` 或创建付费资源。生产 apply 应由受审计 CI 角色和人工审批执行。
