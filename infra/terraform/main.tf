# Architecture-only placeholder. This resource has no cloud side effects and
# keeps `terraform validate` useful before REL-001 implements AWS modules.
resource "terraform_data" "architecture_blueprint" {
  input = {
    name_prefix = local.name_prefix
    region      = var.aws_region
    domain      = var.domain_name
    components  = local.architecture_blueprint
    tags        = local.common_tags
  }
}
