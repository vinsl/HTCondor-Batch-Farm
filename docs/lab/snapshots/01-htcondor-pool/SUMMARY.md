# Lab snapshot: 01-htcondor-pool

> First working pool: three AlmaLinux 9 nodes provisioned by OpenTofu, bootstrapped by Ansible, converged by OpenVox (roles, profiles, Hiera) into an HTCondor 25.0 pool with a self-exclusion health check.

Captured 2026-10-06T19:51:09+00:00 from commit `65a28e6` (branch `feat/phase2-puppet`). Full data: `snapshot.json`.

## Infrastructure (AWS)

- Region **eu-west-3**, VPC `10.0.0.0/16`, one public subnet `10.0.1.0/24`, internet gateway: True, no NAT.
- Image: AlmaLinux OS 9.8.20261005 x86_64. SSH key pair: `batchfarm`.

| Machine | Role | Type | vCPU | RAM (MiB) | Private IP | Disk | IMDSv2 |
|---|---|---|---|---|---|---|---|
| **cm-01** | central_manager | m7i-flex.large | 2 | 7519 | 10.0.1.195 | 20 GiB gp3 encrypted | yes |
| **wn-01** | execute | t3.small | 2 | 1649 | 10.0.1.199 | 20 GiB gp3 encrypted | yes |
| **wn-02** | execute | t3.small | 2 | 1649 | 10.0.1.231 | 20 GiB gp3 encrypted | yes |

### Security group rules

| Direction | Ports | Protocol | Peer | Purpose |
|---|---|---|---|---|
| outbound | all | -1 | anywhere (0.0.0.0/0) | Outbound: package repositories, DNS, NTP |
| inbound | 9618-9618 | tcp | members of batchfarm-cluster | HTCondor daemons (collector, shared port) |
| inbound | 8140-8140 | tcp | members of batchfarm-cluster | OpenVox agent to server (catalog requests) |
| inbound | 22-22 | tcp | admin workstation (single /32) | SSH from the Codespace |

## Nodes

### cm-01

AlmaLinux 9.8 (Olive Jaguar), kernel 5.14.0-687.53.1.el9_8.x86_64, SELinux Enforcing, 2 vCPU, 7519 MiB, root disk 18.7 GiB (89.4 % free), up 8 hours, 6 minutes.

| Service | Enabled | Active | Since |
|---|---|---|---|
| sshd | enabled | active | Tue 2026-10-06 16:06:11 UTC |
| chronyd | enabled | active | Tue 2026-10-06 16:06:11 UTC |
| firewalld | enabled | active | Tue 2026-10-06 16:06:14 UTC |
| puppet | enabled | active | Tue 2026-10-06 14:12:06 UTC |
| puppetserver | enabled | active | Tue 2026-10-06 14:12:11 UTC |
| condor | enabled | active | Tue 2026-10-06 17:25:54 UTC |

Listening TCP ports: 22 (sshd:), 111 (rpcbind), 1027 (condor_schedd), 1699 (condor_collector), 8140 (java), 9618 (condor_shared_port), 19871 (condor_schedd), 30965 (condor_collector).

Firewall (zone public): services cockpit, dhcpv6-client, ssh; ports 8140/tcp, 9618/tcp.

Packages: openvox-agent 8.29.0-1.el9, openvox-server 8.16.0-1.el9, openvox8-release 1-1.el9, condor 25.0.14-1.el9, htcondor-release 25.0-1.el9, epel-release 9-9.el9, chrony 4.8-1.el9, firewalld 1.3.4-20.el9_8, python3 3.9.25-7.el9_8.3.

### wn-01

AlmaLinux 9.8 (Olive Jaguar), kernel 5.14.0-687.53.1.el9_8.x86_64, SELinux Enforcing, 2 vCPU, 1649 MiB, root disk 18.7 GiB (91.0 % free), up 8 hours, 7 minutes.

| Service | Enabled | Active | Since |
|---|---|---|---|
| sshd | enabled | active | Tue 2026-10-06 16:05:18 UTC |
| chronyd | enabled | active | Tue 2026-10-06 19:08:57 UTC |
| firewalld | enabled | active | Tue 2026-10-06 16:05:22 UTC |
| puppet | enabled | active | Tue 2026-10-06 13:12:31 UTC |
| condor | enabled | active | Tue 2026-10-06 19:05:50 UTC |

Listening TCP ports: 22 (sshd:), 111 (rpcbind), 9618 (condor_shared_port).

Firewall (zone public): services cockpit, dhcpv6-client, ssh; ports 9618/tcp.

Packages: openvox-agent 8.29.0-1.el9, openvox8-release 1-1.el9, condor 25.0.14-1.el9, epel-release 9-9.el9, chrony 4.8-1.el9, firewalld 1.3.4-20.el9_8, python3 3.9.25-7.el9_8.3.

### wn-02

AlmaLinux 9.8 (Olive Jaguar), kernel 5.14.0-687.53.1.el9_8.x86_64, SELinux Enforcing, 2 vCPU, 1649 MiB, root disk 18.7 GiB (91.0 % free), up 8 hours, 7 minutes.

| Service | Enabled | Active | Since |
|---|---|---|---|
| sshd | enabled | active | Tue 2026-10-06 16:05:50 UTC |
| chronyd | enabled | active | Tue 2026-10-06 16:05:50 UTC |
| firewalld | enabled | active | Tue 2026-10-06 16:05:54 UTC |
| puppet | enabled | active | Tue 2026-10-06 19:47:47 UTC |
| condor | enabled | active | Tue 2026-10-06 19:05:55 UTC |

Listening TCP ports: 22 (sshd:), 111 (rpcbind), 9618 (condor_shared_port).

Firewall (zone public): services cockpit, dhcpv6-client, ssh; ports 9618/tcp.

Packages: openvox-agent 8.29.0-1.el9, openvox8-release 1-1.el9, condor 25.0.14-1.el9, epel-release 9-9.el9, chrony 4.8-1.el9, firewalld 1.3.4-20.el9_8, python3 3.9.25-7.el9_8.3.

## Configuration management (OpenVox)

- Autosign policy: `/etc/puppetlabs/puppet/autosign.sh`. Pending requests: 0.
- JVM: `JAVA_ARGS="-Xms2g -Xmx2g"`. Environments: production.
- Hiera hierarchy (first match wins): `secrets.yaml` -> `nodes/%{trusted.certname}.yaml` -> `roles/%{trusted.extensions.pp_role}.yaml` -> `common.yaml`.

| Signed certificate | pp_role (in the certificate) | Challenge password stored | Expires |
|---|---|---|---|
| cm-01 | central_manager | False | Oct  5 14:12:10 2031 GMT |
| wn-01 | execute | False | Oct  5 14:12:37 2031 GMT |
| wn-02 | execute | False | Oct  5 14:12:47 2031 GMT |

| Node | Role | Last agent run | Resources | Changed | Failed | Out of sync | Role and profiles |
|---|---|---|---|---|---|---|---|
| cm-01 | central_manager | 2026-10-06T19:42:09+00:00 | 29 | 0 | 0 | 0 | profile::base, profile::htcondor, profile::htcondor::central_manager, profile::htcondor::submit, role::central_manager |
| wn-01 | execute | 2026-10-06T19:42:42+00:00 | 31 | 0 | 0 | 0 | profile::base, profile::htcondor, profile::htcondor::execute, role::execute |
| wn-02 | execute | 2026-10-06T19:47:51+00:00 | 31 | 0 | 0 | 0 | profile::base, profile::htcondor, profile::htcondor::execute, role::execute |

## Batch system (HTCondor)

| Node | Version | Configured daemons | Running processes | Pool key |
|---|---|---|---|---|
| cm-01 | 25.0.14 | MASTER COLLECTOR NEGOTIATOR SCHEDD | condor_collector, condor_master, condor_negotiator, condor_procd, condor_schedd, condor_shared_port | True |
| wn-01 | 25.0.14 | MASTER STARTD | condor_master, condor_procd, condor_shared_port, condor_startd | True |
| wn-02 | 25.0.14 | MASTER STARTD | condor_master, condor_procd, condor_shared_port, condor_startd | True |

### Slots seen by the central manager

| Slot | State | Activity | CPUs | Memory (MiB) | Healthy | Health reason |
|---|---|---|---|---|---|---|
| slot1@wn-01 | Unclaimed | Idle | 2 | 1649 | True | ok |
| slot1@wn-02 | Unclaimed | Idle | 2 | 1649 | True | ok |

- Queue now: empty.
- Job history: {'completed': 37, 'removed': 2}; completed per worker: {'wn-02': 20, 'wn-01': 17} (from 2026-10-06T17:28:21+00:00 to 2026-10-06T19:11:37+00:00).
- START expression on the workers: `(True) && (NODE_IS_HEALTHY=?=True)`.

