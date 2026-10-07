# Design decisions

One entry per non-trivial technical choice. Template:

```
## NNN — Title
- **Context**: what problem, what constraints
- **Decision**: what was chosen
- **Rejected alternative**: what was considered and why not
- **At CERN scale**: what would be done differently in production
```

Each entry below is a stub with the facts to cover in a comment. The text is written by hand.

<!-- Entries are written by hand, newest at the bottom. -->

## 001 — Public subnet, no NAT gateway

<!-- Facts to cover: Nodes need package repositories; the lab must stay cheap. Only the single-AZ public subnet, security group as the only barrier (SSH from one /32, 8140 and 9618 between members). Checkov skips CKV_AWS_88 and CKV_AWS_130 for this reason. -->

- **Context**: 
- **Decision**: 
- **Rejected alternative**: 
- **At CERN scale**: 

## 002 — Ansible to bootstrap, Puppet to maintain

<!-- Facts to cover: Ansible pushes once over SSH, in order; Puppet pulls continuously and reverts drift. Ansible only does what must exist before an agent can talk to the server (repository, agent, certificate request attributes, hosts file). -->

- **Context**: 
- **Decision**: 
- **Rejected alternative**: 
- **At CERN scale**: 

## 003 — OpenVox server colocated with the HTCondor central manager

<!-- Facts to cover: 3 machines only. Lab compromise, single point of failure. 8 GiB machine because the server is a JVM (2 GiB heap). -->

- **Context**: 
- **Decision**: 
- **Rejected alternative**: 
- **At CERN scale**: 

## 004 — Admission: autosign by policy, never autosign = true

<!-- Facts to cover: Any machine that reaches port 8140 can send a request, and a signed agent receives its catalog (and secrets). Policy script checks a shared challenge password carried in the request, fails closed (every unexpected case refuses), never prints a secret. Tested with a forged request (wrong password and stolen role): refused. -->

- **Context**: 
- **Decision**: 
- **Rejected alternative**: 
- **At CERN scale**: 

## 005 — The role comes from a trusted fact, not an ordinary fact

<!-- Facts to cover: Ordinary facts are declared by the node and can be forged. pp_role is an extension of the signed certificate, exposed as $trusted['extensions']['pp_role']; site.pp fails the compilation when it is missing. Limit: the node chose its role in the request, so the admission policy is what protects it. -->

- **Context**: 
- **Decision**: 
- **Rejected alternative**: 
- **At CERN scale**: 

## 006 — Hiera: node, role, common, plus a secrets level that is not committed

<!-- Facts to cover: Same code for every node, different values per node or role; secrets must never be in git. First file defining a key wins (no merge by default). puppet/data/secrets.yaml is git-ignored, written on the server by Ansible from files kept outside the repository, converted to Sensitive with lookup_options. -->

- **Context**: 
- **Decision**: 
- **Rejected alternative**: 
- **At CERN scale**: 

## 007 — Control repository deployed by a file copy, not r10k

<!-- Facts to cover: Time, and a single environment. Ansible copy: simple, but does not delete removed files and nothing pulls changes. Say what r10k and branches-as-environments would bring. -->

- **Context**: 
- **Decision**: 
- **Rejected alternative**: 
- **At CERN scale**: 

## 008 — HTCondor security: shared pool key, IDTOKENS, common TRUST_DOMAIN

<!-- Facts to cover: Every daemon must prove it belongs to the pool. POOL key file on every node (from Hiera), each node mints its own token locally with condor_token_create; TRUST_DOMAIN set to the central manager, otherwise a token minted on a worker carries the worker's name and the collector refuses it. -->

- **Context**: 
- **Decision**: 
- **Rejected alternative**: 
- **At CERN scale**: 

## 009 — Instance types: m7i-flex.large for the central manager

<!-- Facts to cover: The AWS free plan refuses t3.medium (only some types are eligible); the server needs more than the 2 GiB of a t3.small. Record the eligible list that was checked. At scale: right-sized instances, several servers. -->

- **Context**: 
- **Decision**: 
- **Rejected alternative**: 
- **At CERN scale**: 

## 010 — HTCondor repository metadata signature check disabled (repo_gpgcheck=0)

<!-- Facts to cover: dnf reported Bad GPG signature on the repository metadata. Package signatures stay verified (gpgcheck=1). A deliberate, documented relaxation; say how you would investigate and fix it with a mirror. -->

- **Context**: 
- **Decision**: 
- **Rejected alternative**: 
- **At CERN scale**: 

## 011 — Health check design: fail closed, =?=, autopublish

<!-- Facts to cover: A sick node must stop taking jobs without a central decision. Check publishes NODE_IS_HEALTHY; START requires NODE_IS_HEALTHY =?= True so a missing attribute refuses jobs; STARTD_CRON_AUTOPUBLISH = If_Changed because the startd otherwise updates the collector only every 300 s. The startd has the last word on every job. -->

- **Context**: 
- **Decision**: 
- **Rejected alternative**: 
- **At CERN scale**: 

## 012 — Known limit: the pool key is visible in the compiled catalog

<!-- Facts to cover: It is passed to condor_store_cred through an environment variable of an exec. Root-only cache and TLS, but not good practice. hiera-eyaml or a vault, and a file resource written with show_diff false. -->

- **Context**: 
- **Decision**: 
- **Rejected alternative**: 
- **At CERN scale**: 

## 013 — Checkov: which checks are skipped and why

<!-- Facts to cover: Some findings conflict with the cost or scope of a lab. Each skip is in .checkov.yaml with its reason: public IP/subnet, detailed monitoring, flow logs, instance profile, AZ pinning. -->

- **Context**: 
- **Decision**: 
- **Rejected alternative**: 
- **At CERN scale**: 
