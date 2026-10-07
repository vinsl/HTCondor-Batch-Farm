# HTCondor Batch Farm as Code

A small batch-computing farm on AWS, built end to end as code and rebuilt from scratch in minutes:
**OpenTofu** creates the machines, **Ansible** gives each one just enough to join, **OpenVox** (the open
source Puppet) configures and keeps them configured, and **HTCondor** runs the jobs.

The lab reproduces, at a small scale, the way a large computing centre operates a batch farm:
nothing is configured by hand, every change is a code change, and a machine that misbehaves leaves
the pool by itself.

> Status: feature complete. Evidence of every claim below is recorded in [`docs/lab/`](docs/lab/).

## What it does

| | |
|---|---|
| **Provision** | OpenTofu builds a VPC, one security group and 3 AlmaLinux 9 machines on AWS (`eu-west-3`) from a single map of nodes. It also writes the Ansible inventory. |
| **Bootstrap** | Ansible installs the OpenVox agent and sends a certificate request that carries the node's role and a shared challenge password. |
| **Admit** | An autosign **policy script** on the OpenVox server signs a request only if the challenge password matches. `autosign = true` is never used. |
| **Configure** | The role written in the signed certificate (a *trusted fact*) selects `role::<role>`, a list of profiles. Hiera supplies the values. Agents re-check their node every 30 minutes and revert any drift. |
| **Compute** | `cm-01` runs the HTCondor collector, negotiator and schedd; `wn-01` and `wn-02` run the startd. Daemons authenticate with tokens signed by a pool key that never enters the repository. |
| **Self-heal** | A Python health check publishes `NODE_IS_HEALTHY`; the worker's `START` expression refuses jobs when it is false. |

## Architecture

```text
Codespace ──tofu──> AWS eu-west-3 : VPC (public subnet) + 1 security group + 3 AlmaLinux 9 machines
          ──ansible (SSH)──> bootstrap of every machine

cm-01  (m7i-flex.large) : OpenVox server + HTCondor central manager (collector, negotiator) + schedd
wn-01, wn-02 (t3.small) : OpenVox agent  + HTCondor execute node (startd) + health check

role of a node = trusted fact pp_role (extension of its certificate) -> role::<pp_role> -> profiles
```

<!-- Architecture diagram: to be added from docs/lab/snapshots/03-final/snapshot.json -->

Security group: SSH only from one administrator address; the OpenVox port (8140) and the HTCondor
port (9618) only between members of the group.

## Repository layout

| Path | Content |
|---|---|
| `tofu/` | OpenTofu: network module, security group, nodes (`for_each` over `var.nodes`), generated inventory |
| `ansible/` | Roles `openvox_bootstrap` and `openvox_server`, playbook `site.yml` |
| `puppet/` | The control repository: `manifests/site.pp`, `site-modules/{role,profile}`, `hiera.yaml`, `data/` |
| `jobs/` | Sample HTCondor jobs used by the demonstrations |
| `spec/`, `tests/` | `rspec-puppet` tests of the profiles; Pytest tests of the health check |
| `docs/DECISIONS.md` | Every non-trivial choice: context, decision, alternative, what changes at CERN scale |
| `docs/lab/` | Recording tools and the captured evidence (see below) |
| `.github/workflows/ci.yml` | Continuous integration (no AWS credentials, nothing is deployed) |

## Quick start

Requirements: an AWS account with credentials in the environment, OpenTofu, Ansible, an SSH key pair
in `~/.ssh/batchfarm`. Two secrets are generated once **outside** the repository:

```bash
mkdir -p ~/.config/batchfarm && chmod 700 ~/.config/batchfarm
openssl rand -hex 24 > ~/.config/batchfarm/autosign_password      # admission policy
openssl rand -hex 32 > ~/.config/batchfarm/htcondor_pool_password # HTCondor pool key
```

```bash
cd tofu
echo "admin_cidr = \"$(curl -s https://checkip.amazonaws.com)/32\"" > terraform.tfvars
tofu init && tofu apply                         # 3 machines + inventory
cd ../ansible
ansible-playbook site.yml                       # bootstrap, server, agents, sample jobs
ssh -i ~/.ssh/batchfarm ec2-user@<cm-01 public ip>
condor_status                                   # the slots of the workers (a few minutes after the playbook)
cd ~/jobs && condor_submit pi.sub               # 20 independent jobs
```

A second `ansible-playbook site.yml` must report `changed=0`, and a second `puppet agent -t` exit code 0.

## Demonstrations

Each demonstration is a scenario run by [`docs/lab/demo.py`](docs/lab/README.md) and recorded step by step
(commands, timestamps, full output).

| Demonstration | What it shows | Record |
|---|---|---|
| **Self-healing worker** | A stopped service makes a worker refuse jobs by itself; Puppet repairs it; it takes jobs again. | [`demos/health-check`](docs/lab/demos/health-check/RECORD.md) |
| **Zero-touch scale-out** | One new entry in the node map: the machine is created, admitted, configured and runs jobs. | [`demos/scale-out`](docs/lab/demos/scale-out/RECORD.md) |
| **Drift correction** | Manual changes on a node are reverted by the next run; a further run changes nothing. | [`demos/drift-correction`](docs/lab/demos/drift-correction/RECORD.md) |

## Infrastructure snapshots

[`docs/lab/snapshots/`](docs/lab/snapshots/) holds three complete captures of the lab state (AWS resources,
and on every node: services, ports, firewall, packages, certificates, Puppet and HTCondor state):
`01-htcondor-pool` (first working pool), `02-scaled-out` (four nodes), `03-final`.

## Quality gates

On every pull request: `puppet parser validate`, `puppet-lint`, `rspec-puppet`, `ansible-lint`,
`tofu fmt -check`, `tofu validate`, Checkov, Gitleaks, Ruff and Pytest. The pipeline never has AWS
credentials. Every skipped Checkov check is written down with its reason in [`.checkov.yaml`](.checkov.yaml).

## Clean-up

```bash
cd tofu && tofu destroy
```

The lab is designed to be destroyed after every session: a full rebuild takes a few minutes.

## Limitations

- **One shared admission secret.** The challenge password proves membership of the fleet, not the identity of
  one machine; anyone holding it can request any role. In production the role would be bound to an
  identity provided by the platform.
- **The pool key appears in the compiled catalog** (it is passed to a command through an environment
  variable). The catalog is cached readable by root only and travels over TLS, but a secret store or
  `hiera-eyaml` would be the right tool.
- **The OpenVox server shares a machine with the central manager.** Convenient for a lab, a single point of
  failure otherwise.
- **The control repository is deployed by a file copy.** It does not delete removed files and nothing pulls
  changes; r10k would deploy from git.
- **Single availability zone, no NAT gateway, no monitoring stack.** Cost and scope choices.

## What would change at CERN scale

- **Foreman** for provisioning, inventory and the node lifecycle, instead of OpenTofu and Ansible driving a handful of machines.
- **PuppetDB** for facts and reports over the whole fleet, and the ability to query it.
- **Environments and code review**: a git branch per environment (r10k or Code Manager), changes promoted through a canary group before the whole fleet.
- **Compile servers and a load-balanced CA** instead of one server; secrets in eyaml or a vault.
- **HTCondor at the scale of hundreds of thousands of cores**: several collectors, several schedds, a tuned negotiation cycle, accounting groups and fair share, and a pool that keeps working when the central manager restarts.
- **Detection**: a change that breaks 10 % of the fleet must be caught by a canary group, and by monitoring of failed Puppet runs, before it reaches the other 90 %.

See [`docs/DECISIONS.md`](docs/DECISIONS.md) for the reasoning behind each choice.
