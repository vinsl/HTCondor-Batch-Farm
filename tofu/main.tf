data "aws_availability_zones" "available" {
  state = "available"
}

# Official AlmaLinux 9 image, resolved at plan time: no AMI ID hardcoded in the repository.
data "aws_ami" "alma9" {
  most_recent = true
  owners      = ["764336703387"] # AlmaLinux OS Foundation

  filter {
    name   = "name"
    values = ["AlmaLinux OS 9*x86_64*"]
  }

  filter {
    name   = "state"
    values = ["available"]
  }
}

module "network" {
  source = "./modules/network"

  name              = "batchfarm"
  availability_zone = data.aws_availability_zones.available.names[0]
}

resource "aws_key_pair" "admin" {
  key_name   = "batchfarm"
  public_key = file(pathexpand(var.ssh_public_key_path))
}

# --- Security group -------------------------------------------------------------------------
# One group for the whole fleet. "Members of the group" is expressed by a rule whose source is
# the group itself (referenced_security_group_id), not by a CIDR: a node added later is covered
# automatically.

resource "aws_security_group" "cluster" {
  name        = "batchfarm-cluster"
  description = "SSH from the admin IP, OpenVox and HTCondor between fleet members only"
  vpc_id      = module.network.vpc_id
}

# Example (complete): SSH comes from outside, so its source is a CIDR.
resource "aws_vpc_security_group_ingress_rule" "ssh" {
  security_group_id = aws_security_group.cluster.id
  description       = "SSH from the Codespace"
  ip_protocol       = "tcp"
  from_port         = 22
  to_port           = 22
  cidr_ipv4         = var.admin_cidr
}

resource "aws_vpc_security_group_ingress_rule" "openvox" {
  security_group_id            = aws_security_group.cluster.id
  description                  = "OpenVox agent to server (catalog requests)"
  ip_protocol                  = "tcp"
  from_port                    = 8140
  to_port                      = 8140
  referenced_security_group_id = aws_security_group.cluster.id # any member of the group, not an IP range
}

resource "aws_vpc_security_group_ingress_rule" "htcondor" {
  security_group_id            = aws_security_group.cluster.id
  description                  = "HTCondor daemons (collector, shared port)"
  ip_protocol                  = "tcp"
  from_port                    = 9618
  to_port                      = 9618
  referenced_security_group_id = aws_security_group.cluster.id
}

resource "aws_vpc_security_group_egress_rule" "all" {
  security_group_id = aws_security_group.cluster.id
  description       = "Outbound: package repositories, DNS, NTP"
  ip_protocol       = "-1"
  cidr_ipv4         = "0.0.0.0/0"
}

# --- Instances ------------------------------------------------------------------------------

resource "aws_instance" "node" {
  # One instance per entry of var.nodes: each.key is the hostname, each.value is { role, instance_type }.
  for_each = var.nodes

  ami                         = data.aws_ami.alma9.id
  subnet_id                   = module.network.public_subnet_id
  vpc_security_group_ids      = [aws_security_group.cluster.id]
  key_name                    = aws_key_pair.admin.key_name
  associate_public_ip_address = true
  ebs_optimized               = true
  instance_type               = each.value.instance_type

  metadata_options {
    http_tokens = "required" # IMDSv2 only
  }

  root_block_device {
    volume_size = 20
    volume_type = "gp3"
    encrypted   = true
  }

  tags = {
    Name = each.key
    Role = each.value.role
  }
}

# --- Ansible inventory ----------------------------------------------------------------------
# Generated from the instances so it can never drift from reality. Ignored by git.

resource "local_file" "inventory" {
  filename        = "${path.module}/../ansible/inventory/generated.ini"
  file_permission = "0644"

  # path.module makes the path independent of the directory tofu is run from.
  # The second argument is a map of variables visible in the template: the template reads "nodes",
  # so the map key is "nodes" and its value is the whole aws_instance.node map.
  content = templatefile("${path.module}/templates/inventory.ini.tftpl", {
    nodes = aws_instance.node
  })
}
