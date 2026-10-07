# Demo: Scale out: a new worker joins the pool with no manual step

> Adding one entry to the OpenTofu node map is the only decision: the machine is created, admitted by the autosign policy with the role from its request, configured by Puppet, and takes jobs.

Recorded 2026-10-07T09:41:26+00:00 from commit `6035cb2`, 1 steps in 00:14. Result: **FAILED**. Full data: `record.json`.

## 1. Baseline: a pool of two workers  `+00:00`

The slots the central manager sees before the change.

On **cm-01 (root)**:

```bash
condor_status -af Machine State Cpus; echo; /opt/puppetlabs/bin/puppetserver ca list --all | grep -c '^ *wn-' | sed 's/^/signed workers: /'
```

Exit code -1, 14.6 s.

```text
Task failed: Failed to connect to the host via ssh: ssh: connect to host <public-ip> port 22: Connection timed out
```

**This step did not meet its expectation: the demo stopped here.**

