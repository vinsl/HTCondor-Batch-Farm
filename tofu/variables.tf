variable "region" {
  description = "AWS region."
  type        = string
  default     = "eu-west-3"
}

variable "admin_cidr" {
  description = "Public IP of the Codespace in /32 form. It changes at every Codespace restart. Allowed to SSH in."
  type        = string

  validation {
    condition     = can(regex("/32$", var.admin_cidr))
    error_message = "admin_cidr must be a single address in /32 form, for example 203.0.113.7/32."
  }
}

variable "ssh_public_key_path" {
  description = "Path to the SSH PUBLIC key registered in AWS. The private key never leaves ~/.ssh."
  type        = string
  default     = "~/.ssh/batchfarm.pub"
}

# The fleet is data, not code: scale-out (wn-03) is one more entry in this map, nothing else.
variable "nodes" {
  description = "Nodes to create, keyed by hostname. role becomes the pp_role trusted fact."
  type = map(object({
    role          = string
    instance_type = string
  }))
  default = {
    "cm-01" = { role = "central_manager", instance_type = "m7i-flex.large" } # 8 GiB: OpenVox server (JVM) + HTCondor; t3.medium is refused by the AWS free plan
    "wn-01" = { role = "execute", instance_type = "t3.small" }
    "wn-02" = { role = "execute", instance_type = "t3.small" }
  }
}
