# Lab documentation

Everything that documents the running lab lives in this folder: two tools, and what they captured.

| Tool | Purpose | Used for |
|---|---|---|
| **A. `snapshot.py`** | Captures, at one instant, the complete state of the infrastructure: AWS resources (from the OpenTofu state) and, on every node, system, services, network, packages, Puppet state and HTCondor state. | The **3 milestones** of the build, the last one being the final lab. |
| **B. `demo.py`** | Runs a demonstration described as a scenario and records every step: command, host, timestamps, exit code, full output, and the conditions it waited for. | The **3 most telling demonstrations**. |

Both tools are read-only on the lab (except the commands a demo scenario explicitly runs), scrub
known secrets and public IP addresses, and refuse to report success if gitleaks finds a leak.
They need the fleet to be up, so a capture always happens **before** `tofu destroy`.

## Milestones (tool A)

| Folder | Milestone |
|---|---|
| `snapshots/01-htcondor-pool/` | First working pool: 3 nodes converged by OpenVox, HTCondor pool with health check. |
| `snapshots/02-scaled-out/` | After the zero-touch scale-out (a fourth node added by one line of OpenTofu data). |
| `snapshots/03-final/` | Final lab, as delivered. Source for the final architecture visual. |

```bash
python3 docs/lab/snapshot.py 01-htcondor-pool "First working pool: ..."
```

Each folder holds `snapshot.json` (all the data, machine readable) and `SUMMARY.md` (the same as tables).

## Demonstrations (tool B)

| Folder | What it proves |
|---|---|
| `demos/health-check/` | A worker with a broken service removes itself from the pool, Puppet repairs it, it comes back. |
| `demos/scale-out/` | A new worker joins the pool with no manual step: OpenTofu, Ansible, autosign, Puppet, HTCondor. |
| `demos/drift-correction/` | A manual change on a node is detected and reverted by Puppet; a second run changes nothing. |

```bash
python3 docs/lab/demo.py docs/lab/demos/health-check/scenario.toml --dry-run   # show the plan
python3 docs/lab/demo.py docs/lab/demos/health-check/scenario.toml             # run and record
```

Each folder holds `scenario.toml` (the steps), `record.json` (everything) and `RECORD.md` (timeline).

## Visuals

`visuals/` holds the 3D model of the lab, built from a snapshot: `index.html` (interactive, self-contained,
published by GitHub Pages at https://vinsl.github.io/HTCondor-Batch-Farm/docs/lab/visuals/) and the images it
exports (`hero-*.png` for the README, `linkedin-*.png` for link previews). How it is built and how each part of
the model maps to the snapshot: [`visuals/README.md`](visuals/README.md).

## Files

- `lablib.py`: shared helpers (Ansible runner, scrubbing of secrets and public IPs, gitleaks scan).
- `node_probe.py`: run as root on each node by `snapshot.py`; prints one JSON document, changes nothing,
  never reads secret material (no CSR attributes, no HTCondor keys or tokens, no catalog parameters).
