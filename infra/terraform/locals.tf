locals {
  name_prefix = "${var.project_name}-${var.environment}"

  common_tags = {
    project             = var.project_name
    environment         = var.environment
    owner               = var.owner
    managed_by          = "terraform"
    data_classification = var.environment == "prod" ? "confidential" : "synthetic"
  }

  # REL-001 replaces this metadata-only object with real module calls.
  architecture_blueprint = {
    edge          = ["route53", "acm", "cloudfront", "waf", "alb"]
    compute       = ["ecs-web", "ecs-admin", "ecs-api", "ecs-worker", "ecr"]
    data          = ["rds-postgresql-postgis", "elasticache-redis", "opensearch", "s3"]
    security      = ["kms", "secrets-manager", "iam-task-roles", "private-subnets"]
    observability = ["cloudwatch", "otel", "alarms", "dashboards"]
  }
}
