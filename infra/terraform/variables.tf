variable "project_name" {
  description = "Stable project slug used in names and tags."
  type        = string
  default     = "socal-life-platform"
}

variable "environment" {
  description = "Deployment environment."
  type        = string
  default     = "dev"
  validation {
    condition     = contains(["dev", "staging", "prod"], var.environment)
    error_message = "environment must be dev, staging, or prod"
  }
}

variable "aws_region" {
  description = "Primary AWS region, confirmed during REL-001."
  type        = string
  default     = "us-west-2"
}

variable "owner" {
  description = "Team or cost owner tag."
  type        = string
  default     = "platform"
}

variable "domain_name" {
  description = "Production or environment domain. Empty in blueprint mode."
  type        = string
  default     = ""
}
