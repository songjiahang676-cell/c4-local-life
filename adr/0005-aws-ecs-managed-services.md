# ADR-0005：生产基线采用 AWS ECS Fargate 与托管数据服务

- 状态：Accepted
- 日期：2026-07-21

## 背景

首期需要可靠、可扩展、运维负担相对可控的生产平台。团队不应在业务未验证时自建 Kubernetes、数据库和搜索集群。

## 决策

生产基线：CloudFront/WAF、ALB、ECS Fargate、RDS PostgreSQL/PostGIS、ElastiCache Redis、OpenSearch Service、S3、ECR、Secrets Manager/KMS、CloudWatch/OTel。基础设施使用 Terraform，应用以容器部署。

## 后果

获得托管备份、Multi-AZ 和减少集群维护；承担 AWS 成本和部分锁定。业务通过 adapter 避免 provider SDK 进入领域层。生产实施前验证 BullMQ 与选定 Redis 模式、PostGIS 版本和 OpenSearch 插件能力。

## 备选

- Kubernetes/EKS：当前拒绝，运维成本大于收益。
- 单 VM：拒绝，隔离、恢复、扩容和部署风险高。
- 全托管 PaaS：可用于 Preview/早期环境，但生产数据、网络、搜索和成本需要评估。
