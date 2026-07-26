# Terraform 实施蓝图

当前 `.tf` 文件只定义架构 metadata、输入和输出，不会部署 AWS 资源。原因是生产账号、区域、域名、网络 CIDR、数据分级、成本预算、证书和 provider 选择尚未确认。Codex 在任务 `REL-001` 中应按下列模块逐步实现，而不是把所有资源堆在一个文件。

## 模块

```text
modules/
├── network        VPC、三 AZ、public/private/data subnet、endpoints、flow logs
├── edge           Route53、ACM、CloudFront、WAF、ALB
├── compute        ECS cluster/services、autoscaling、task roles、ECR
├── data           RDS、Redis、OpenSearch、S3、backup/KMS
└── observability  logs、metrics、alarms、dashboards、OTel collector
```

## 环境组合

`environments/dev|staging|prod` 各自使用远程 state、独立账号/角色和参数。生产至少 Multi-AZ；非生产可按成本降级，但不能共享生产数据/密钥。

## 实施顺序

1. Remote state、OIDC CI role、provider/version lock。
2. Network/KMS/logging foundation。
3. Data stores（先 staging 验证 PostGIS、BullMQ Redis 模式和 OpenSearch analyzer）。
4. ECR/ECS/ALB/CloudFront/WAF。
5. Secrets、deployment roles、backup/restore、alarms。
6. Staging plan/apply、security review、cost estimate、failure test。
7. Production plan with approval。

## 强制要求

- 所有资源 tags：project、environment、owner、data_classification、cost_center。
- 数据服务无公网地址，传输/静态加密。
- IAM 最小权限、任务角色，不使用长期 access key。
- RDS PITR/Multi-AZ、S3 versioning/lifecycle、CloudTrail/Config 由组织基线或模块覆盖。
- Terraform plan 进入 PR；apply 只能从受保护环境。
- 生产 destroy 被 policy 阻止；关键资源 `prevent_destroy` 与备份确认。
