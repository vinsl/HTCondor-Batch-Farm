# Demo: A sick worker removes itself from the pool, then heals

> When a critical service stops on a worker, its health check makes it refuse new jobs by itself; Puppet then repairs the service and the worker takes jobs again, with no human decision.

Recorded 2026-10-07T09:33:41+00:00 from commit `6035cb2`, 11 steps in 02:32. Result: **success**. Full data: `record.json`.

## 1. Baseline: both workers are healthy  `+00:00`

Each worker publishes NODE_IS_HEALTHY and the reason, as seen by the central manager.

On **cm-01**:

```bash
condor_status -af Machine NODE_IS_HEALTHY NODE_HEALTH_REASON State
```

Exit code 0, 1.0 s.

```text
wn-01 true ok Unclaimed
wn-01 true ok Claimed
wn-01 true ok Claimed
wn-02 true ok Unclaimed
wn-02 true ok Claimed
wn-02 true ok Claimed
```

## 2. Break a service on wn-01  `+00:01`

chronyd (time synchronisation) is one of the services a worker cannot run jobs without. An operator or a crash could stop it.

On **wn-01 (root)**:

```bash
systemctl stop chronyd; echo "chronyd is now: $(systemctl is-active chronyd)"
```

Exit code 0, 1.5 s.

```text
chronyd is now: inactive
```

## 3. The worker declares itself sick  `+00:02`

The health check runs every 60 seconds. As soon as its output changes the startd publishes it to the collector.

Waited for a condition on **cm-01**, met after 56.1 s (6 checks):

```bash
condor_status -af Machine NODE_IS_HEALTHY | grep -q '^wn-01 false'
```

Once the condition holds, on **cm-01**:

```bash
condor_status -af Machine NODE_IS_HEALTHY NODE_HEALTH_REASON
```

```text
wn-01 false service chronyd is not active
wn-02 true ok
```

## 4. Submit 8 jobs of 25 seconds  `+00:59`

The queue holds more jobs than the healthy worker can run at once.

On **cm-01**:

```bash
cd ~/jobs && condor_submit sleep.sub
```

Exit code 0, 1.0 s.

```text
Submitting job(s)........
8 job(s) submitted to cluster 3.
```

## 5. Only the healthy worker runs jobs  `+01:00`

wn-01 is excluded by its own START expression: none of the running jobs is on it.

Waited for a condition on **cm-01**, met after 0.9 s (1 checks):

```bash
test $(condor_q -run -nobatch | grep -c '@wn-02') -ge 1
```

Once the condition holds, on **cm-01**:

```bash
condor_q -run -nobatch | grep -oE '@wn-[0-9]+' | sort | uniq -c; test $(condor_q -run -nobatch | grep -c '@wn-01') -eq 0
```

```text
      2 @wn-02
```

## 6. Why an idle job waits  `+01:02`

condor_q -better-analyze separates 'the job asks too much' from 'the machines refuse the job': here the machines refuse.

On **cm-01**:

```bash
condor_q -better-analyze $(condor_q -idle -af ClusterId ProcId | head -1 | tr ' ' .) 2>&1 | grep -E 'slots|Requirements expression'
```

Exit code 0, 1.0 s.

```text
The Requirements expression for job 3.002 is
The Requirements expression for job 3.002 reduces to these conditions:
003.002:  Run analysis summary ignoring user priority.  Of 2 slots on 2 machines,
      0 slots are rejected by your job's requirements
      1 slots reject your job because of their own requirements
      0 slots match and are willing to run your job
      1 slots would match if drained
```

## 7. Puppet repairs the service  `+01:03`

The next Puppet run notices chronyd is stopped, which is a drift from the desired state, and starts it.

On **wn-01 (root)**:

```bash
/opt/puppetlabs/bin/puppet agent -t --detailed-exitcodes >/tmp/run.log 2>&1; rc=$?; grep -E 'Service.chronyd' /tmp/run.log | sed 's/\x1b\[[0-9;]*m//g' | cut -c1-140; echo "puppet exit code: $rc (2 = changes applied)"; test $rc -eq 2
```

Exit code 0, 5.3 s.

```text
Notice: /Stage[main]/Profile::Base/Service[chronyd]/ensure: ensure changed 'stopped' to 'running' (corrective)
Info: /Stage[main]/Profile::Base/Service[chronyd]: Unscheduling refresh on Service[chronyd]
puppet exit code: 2 (2 = changes applied)
```

## 8. The worker declares itself healthy again  `+01:08`

The health check sees chronyd running, publishes True, and START accepts jobs again.

Waited for a condition on **cm-01**, met after 45.0 s (5 checks):

```bash
condor_status -af Machine NODE_IS_HEALTHY | grep -q '^wn-01 true'
```

Once the condition holds, on **cm-01**:

```bash
condor_status -af Machine NODE_IS_HEALTHY NODE_HEALTH_REASON
```

```text
wn-01 true ok
wn-02 true ok
wn-02 true ok
wn-02 true ok
```

## 9. Let the first batch finish  `+01:54`

So the next batch starts from an empty queue.

Waited for a condition on **cm-01**, met after 33.9 s (4 checks):

```bash
test $(condor_q -nobatch -af ClusterId | wc -l) -eq 0
```

Once the condition holds, on **cm-01**:

```bash
condor_q -nobatch | tail -1
```

## 10. A new batch runs on both workers  `+02:29`

The proof that wn-01 is back in service.

On **cm-01**:

```bash
cd ~/jobs && condor_submit sleep.sub
```

Exit code 0, 2.0 s.

```text
Submitting job(s)........
8 job(s) submitted to cluster 4.
```

Waited for a condition on **cm-01**, met after 2.0 s (1 checks):

```bash
test $(condor_q -run -nobatch | grep -oE '@wn-[0-9]+' | sort -u | wc -l) -ge 2
```

## 11. Jobs per worker  `+02:31`

Running jobs, grouped by worker.

On **cm-01**:

```bash
condor_q -run -nobatch | grep -oE '@wn-[0-9]+' | sort | uniq -c
```

Exit code 0, 0.9 s.

```text
      2 @wn-01
      2 @wn-02
```

