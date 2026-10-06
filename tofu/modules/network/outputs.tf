output "vpc_id" {
  description = "ID of the VPC (needed by the security group)."
  value       = aws_vpc.this.id
}

output "public_subnet_id" {
  description = "ID of the public subnet (needed by the instances)."
  value       = aws_subnet.public.id
}
