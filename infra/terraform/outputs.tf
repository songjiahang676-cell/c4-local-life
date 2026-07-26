output "architecture_blueprint" {
  description = "Metadata-only deployment plan; no AWS resources are created yet."
  value       = terraform_data.architecture_blueprint.output
}
