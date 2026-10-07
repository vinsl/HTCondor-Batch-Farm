# Design decisions

One entry per non-trivial technical choice. Template:

```
## NNN — Title
- **Context**: what problem, what constraints
- **Decision**: what was chosen
- **Rejected alternative**: what was considered and why not
- **At CERN scale**: what would be done differently in production
```

## 001 — Public subnet, no NAT gateway

- **Context**: The nodes need to reach package repositories, and the lab must stay cheap and short-lived. A NAT gateway has an hourly charge plus a data-processing charge, which is out of proportion for three machines that live a few hours.
- **Decision**: One availability zone, one public subnet, an internet gateway and public addresses. The security group is the only barrier: SSH (22) only from one administrator address (/32, refreshed with `admin_cidr` at every session), OpenVox (8140) and HTCondor (9618) only between members of the group (the rule's source is the group itself, so a node added later is covered), outbound open for repositories, DNS and time.
- **Rejected alternative**: Private subnets with a NAT gateway (or a mirror reachable only internally), considered and dropped for cost. SSM Session Manager instead of SSH was considered as the access method and dropped to keep the lab self-contained.
- **At CERN scale**: No public addresses at all. Machines on a private network, access through a bastion or an audited session service, outbound traffic only to internal package mirrors and proxies.

## 002 — Ansible to bootstrap, Puppet to maintain

- **Context**: A node that has just booted has no agent, so nothing can pull a configuration yet. Once an agent runs, configuration must be kept true over time.
- **Decision**: Ansible pushes once over SSH, in order, and only does what must exist before an agent can talk to the server: the OpenVox repository, the agent, the hostname, the fleet entries in `/etc/hosts`, `puppet.conf`, and the certificate request attributes (role and challenge password). Puppet then pulls every 30 minutes, compares each node to its desired state, and reverts drift. The playbook is idempotent (a second run reports `changed=0`).
- **Rejected alternative**: Doing everything with Ansible: no continuous convergence, so drift would last until someone reruns the playbook. Doing everything with Puppet: impossible, the first agent has to be installed by something else.
- **At CERN scale**: Machines would be created already enrolled by the provisioning system (Foreman), so the Ansible step disappears; Puppet is the only tool that touches a running node.

## 003 — OpenVox server colocated with the HTCondor central manager

- **Context**: Three machines in total, so one of them must carry both control roles.
- **Decision**: `cm-01` runs the OpenVox server (a JVM with a 2 GiB heap), the HTCondor collector and negotiator, and the schedd. It is the only larger machine (8 GiB); the two workers have 2 GiB.
- **Rejected alternative**: A dedicated server machine (a fourth node) was dropped for cost and simplicity.
- **At CERN scale**: The configuration service and the batch scheduler are separate services on separate, redundant machines (compile servers behind a load balancer, several collectors), so that restarting or losing one does not stop the other. In this lab `cm-01` is a single point of failure.

## 004 — Admission by autosign policy, never `autosign = true`

- **Context**: Any machine that can reach port 8140 can send a certificate request, and a signed agent receives its catalog, which can contain secrets.
- **Decision**: The server runs a policy script for every request. It signs only if the challenge password embedded in the request equals the secret stored on the server, and it fails closed: a missing certname, an unreadable secret file, an empty or wrong password, or garbage input all end in a refusal. Its messages name the node but never contain a secret. It was tested with real requests (good password, wrong password, no password, empty secret, empty input) and with a forged request asking for another node's role with a wrong password, which was refused and logged by the server.
- **Rejected alternative**: `autosign = true` (signs everything) and manual signing with `puppetserver ca sign` (does not scale and invites mistakes) were both rejected.
- **At CERN scale**: The shared password proves membership of the fleet, not the identity of one machine, and anyone holding it can request any role. In production the request would be tied to an identity the platform vouches for (for example signed instance metadata), or signing would be done per machine by the provisioning system.

## 005 — The role comes from a trusted fact, not from an ordinary fact

- **Context**: Ordinary facts are declared by the node and can be forged; the role decides what a node receives.
- **Decision**: The role is the `pp_role` extension of the node's signed certificate, read in `site.pp` as `$trusted['extensions']['pp_role']` and mapped to `role::<role>`. A node without a role makes the compilation fail (`fail()`), so it receives nothing instead of a default configuration. The challenge password is deliberately not kept in the certificate: it is read by the policy script from the request only. A test checks that the certificate does not contain it.
- **Rejected alternative**: Choosing the role from a custom fact or from the node name, both of which the node controls.
- **At CERN scale**: The node chose its own role in its request, so the admission policy is what protects the roles. At scale the role would be assigned by the system that provisions the machine, outside the node's reach.

## 006 — Hiera with node, role and common levels, plus a secrets level that is not committed

- **Context**: The same code must serve every node with different values, and secrets must never reach git.
- **Decision**: `hiera.yaml` has four levels, most specific first: `secrets.yaml`, `nodes/<certname>.yaml`, `roles/<pp_role>.yaml`, `common.yaml`. The first file that defines a key wins, with no merge by default: `roles/central_manager.yaml` replaces the list of firewall ports with `[8140, 9618]` rather than adding to `[9618]`. `puppet/data/secrets.yaml` is git-ignored, written on the server by Ansible from files kept outside the repository, and converted to the `Sensitive` type with `lookup_options`. The ignore rule had to be written as `puppet/data/secrets*`: the root-anchored `data/secrets*` did not match that path.
- **Rejected alternative**: Passing parameters directly in the code with the resource-like class declaration (one declaration per class, values frozen in code), and keeping secrets in plain data files in the repository.
- **At CERN scale**: Encrypted data (`hiera-eyaml`) or a secret store, so that even the server's disk does not hold secrets in the clear, and data per environment and per site.

## 007 — The control repository is deployed by a file copy, not r10k

- **Context**: One environment, one server, and limited time.
- **Decision**: Ansible copies `puppet/` into `/etc/puppetlabs/code/environments/production/` and writes the secrets file next to it. It is simple and idempotent, but it does not delete files removed from the repository and nothing pulls changes automatically.
- **Rejected alternative**: r10k (deploys from git, one environment per branch) was kept as a bonus and not done.
- **At CERN scale**: r10k or Code Manager deploying from git: a branch per environment, review before merge, and promotion of a change through a small canary group before the whole fleet.

## 008 — HTCondor security: a shared pool key, IDTOKENS, and one trust domain

- **Context**: Every daemon must prove it belongs to the pool, otherwise anyone could register as an execute node.
- **Decision**: The package already ships `use security:recommended`. The pool key is the file `/etc/condor/passwords.d/POOL`, created on every node by `condor_store_cred` from a value supplied by Hiera. Having the key is not enough: each daemon authenticates with an IDTOKEN, which each node mints locally with `condor_token_create` since it holds the key. `TRUST_DOMAIN` is set to the central manager on all nodes. Without it the default is the machine's own name, a token minted on a worker carries that name, and the collector refuses it (`AUTHENTICATE ... Failed to authenticate` in the startd log).
- **Rejected alternative**: The default token-request flow (each daemon requests a token and an administrator approves it) needs a manual step per node, which defeats zero-touch scale-out.
- **At CERN scale**: Per-node or per-group signing keys with rotation, tokens with limited lifetime and scope, and authorization lists written explicitly rather than relying on the recommended defaults.

## 009 — Instance types: `m7i-flex.large` for the central manager

- **Context**: The AWS free plan refuses instance types that are not eligible: `t3.medium` was rejected at the first `apply`. The OpenVox server is a JVM and a `t3.small` has only 2 GiB.
- **Decision**: The eligible types were listed with the AWS API (t3, t4g and t8i in micro and small, `c7i-flex.large`, `m7i-flex.large`). `cm-01` uses `m7i-flex.large` (8 GiB), the workers `t3.small`.
- **Rejected alternative**: `c7i-flex.large` (4 GiB) would run the server but leaves little room next to HTCondor.
- **At CERN scale**: Instances sized from measured load, in several availability zones, for the services that matter (configuration, scheduling).

## 010 — HTCondor repository metadata signature check disabled (`repo_gpgcheck=0`)

- **Context**: `dnf` reported `Bad GPG signature` on the repository metadata (`repomd.xml`), which made every install fail.
- **Decision**: `repo_gpgcheck` is 0 for the HTCondor repository, while `gpgcheck=1` keeps verifying the signature of every package against the vendor key. This is a deliberate, documented relaxation, not an oversight.
- **Rejected alternative**: Leaving the check on (nothing installs) and mirroring the repository locally (more work than the lab justifies).
- **At CERN scale**: A local mirror of vetted packages signed by the site, so a transient metadata problem upstream never reaches the fleet, and the metadata check stays on.

## 011 — Health check: fail closed, `=?=`, and autopublish

- **Context**: A sick node must stop taking jobs without a central decision, and a broken check must not look like a healthy node.
- **Decision**: A Python script run by `STARTD_CRON` every 60 seconds checks the free disk space and that `chronyd` is active, and prints `NODE_IS_HEALTHY` and the reason. `START = ($(START)) && (NODE_IS_HEALTHY =?= True)`: the `=?=` operator makes a missing attribute false, so a node whose check crashed refuses jobs. The macro is wrapped in parentheses because it is a text substitution that would otherwise change operator precedence. `STARTD_CRON_AUTOPUBLISH = If_Changed` is needed because the startd otherwise updates the collector only every 300 seconds. The startd always has the last word: even after a match, it re-evaluates `START` when the job is claimed. Unit tests with fakes did not catch a wrong argument (`service_active(tuple)`); running the script on a real node did.
- **Rejected alternative**: A central decision to drain a node (needs a monitoring system and an operator in the loop) and `==` instead of `=?=` (an undefined attribute is not false).
- **At CERN scale**: More checks (disk errors, network, memory, a test job), the result sent to monitoring as well, and node removal ordered from the central system with drain (`condor_drain`) so running jobs finish.

## 012 — Known limit: the pool key is visible in the compiled catalog

- **Context**: The key reaches `condor_store_cred` through an environment variable of an `exec`, which puts the value in the catalog.
- **Decision**: The catalog is cached readable by root only on each node and travels over TLS, so the exposure is limited, but a secret in a catalog is not good practice. This is documented rather than hidden; the evidence tools only export resource names and never catalog parameters, and a test asserts that the signed certificate holds no secret.
- **Rejected alternative**: A file resource with the key as content has the same problem (the content is in the catalog too); creating the key out of band would break the principle that Puppet provides everything.
- **At CERN scale**: Encrypted data (`hiera-eyaml`) or a secret store read by the agent at run time, and a rotation procedure for the key.

## 013 — Checkov: which checks are skipped and why

- **Context**: Some findings contradict the cost or scope of a short-lived lab. Skipping them silently would hide them.
- **Decision**: Two findings were fixed (the default security group of the VPC is emptied, EBS optimization is explicit). Six are skipped in `.checkov.yaml`, each with its reason: public addresses and public subnet (no NAT by design), detailed monitoring (cost), VPC flow logs (cost and a log destination), instance profile (nothing calls AWS APIs), and availability-zone pinning.
- **Rejected alternative**: Making every check pass by adding the resources it asks for would add cost and attack surface for no benefit here.
- **At CERN scale**: Most of these would be fixed rather than skipped: flow logs and monitoring are standard, and nodes would not hold public addresses.
