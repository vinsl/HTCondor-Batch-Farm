# HTCondor Batch Farm as Code

A 3-node HTCondor pool on AWS, built end to end as code:
OpenTofu provisions AlmaLinux 9 VMs, Ansible bootstraps them, an OpenVox server converges them
(Puppet roles/profiles + Hiera) into a working HTCondor pool.

> Status: work in progress.

## Goal

_TODO_

## Architecture

```mermaid
flowchart LR
    subgraph CS[Codespace]
        TOFU[OpenTofu]
        ANS[Ansible]
    end
    subgraph AWS[AWS eu-west-3 - VPC, public subnets, one SG]
        CM["cm-01 (t3.medium)<br/>OpenVox server<br/>HTCondor collector + negotiator<br/>schedd (submit)"]
        W1["wn-01 (t3.small)<br/>OpenVox agent<br/>HTCondor startd"]
        W2["wn-02 (t3.small)<br/>OpenVox agent<br/>HTCondor startd"]
    end
    TOFU -- provisions --> AWS
    TOFU -- generates inventory --> ANS
    ANS -- "SSH bootstrap" --> CM
    ANS -- "SSH bootstrap" --> W1
    ANS -- "SSH bootstrap" --> W2
    W1 -- "8140: catalog (CSR with pp_role)" --> CM
    W2 -- "8140: catalog (CSR with pp_role)" --> CM
    W1 -- "9618: startd ad" --> CM
    W2 -- "9618: startd ad" --> CM
```

Each node's role is the `pp_role` trusted fact (a CSR extension), mapped to `role::<pp_role>` and then to profiles.

## Design choices

See [docs/DECISIONS.md](docs/DECISIONS.md).

## Quick start

_TODO_

## Proofs

_TODO (idempotence, drift correction, scale-out, health check, jobs, CI)_

## Cleanup

_TODO_

## Limitations

_TODO_

## What would change at CERN scale

_TODO_
