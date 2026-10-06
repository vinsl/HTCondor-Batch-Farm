terraform {
  required_version = ">= 1.8"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
    local = {
      source  = "hashicorp/local"
      version = "~> 2.5"
    }
  }
}

provider "aws" {
  # Region is set here explicitly so the code does not depend on AWS_DEFAULT_REGION.
  region = var.region

  default_tags {
    tags = {
      Project   = "htcondor-batch-farm"
      ManagedBy = "opentofu"
    }
  }
}
