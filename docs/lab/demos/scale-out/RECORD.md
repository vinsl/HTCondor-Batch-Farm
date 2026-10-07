# Demo: Scale out: a new worker joins the pool with no manual step

> Adding one entry to the OpenTofu node map is the only decision: the machine is created, admitted by the autosign policy with the role from its request, configured by Puppet, and takes jobs.

Recorded 2026-10-07T09:50:12+00:00 from commit `86fa7f3`, 10 steps in 04:17. Result: **success**. Full data: `record.json`.

## 1. Baseline: a pool of two workers  `+00:00`

The slots the central manager sees before the change.

On **cm-01 (root)**:

```bash
condor_status -af Machine State Cpus; echo; /opt/puppetlabs/bin/puppetserver ca list --all | grep -c '^ *wn-' | sed 's/^/signed workers: /'
```

Exit code 0, 1.4 s.

```text
wn-01 Unclaimed 0
wn-01 Claimed 1
wn-01 Claimed 1
wn-02 Unclaimed 0
wn-02 Claimed 1
wn-02 Claimed 1

signed workers: 2
```

## 2. The only change: one more entry in the node map  `+00:01`

The fleet is data, not code. wn-03 is the same kind of node as the other workers.

On **workspace**:

```bash
cat > /tmp/scale-out.tfvars <<'TFVARS'
nodes = {
  "cm-01" = { role = "central_manager", instance_type = "m7i-flex.large" }
  "wn-01" = { role = "execute", instance_type = "t3.small" }
  "wn-02" = { role = "execute", instance_type = "t3.small" }
  "wn-03" = { role = "execute", instance_type = "t3.small" }
}
TFVARS
cat /tmp/scale-out.tfvars
```

Exit code 0, 0.0 s.

```text
nodes = {
  "cm-01" = { role = "central_manager", instance_type = "m7i-flex.large" }
  "wn-01" = { role = "execute", instance_type = "t3.small" }
  "wn-02" = { role = "execute", instance_type = "t3.small" }
  "wn-03" = { role = "execute", instance_type = "t3.small" }
}
```

## 3. Plan: exactly one machine is added  `+00:01`

OpenTofu compares the data with what exists: nothing else changes.

On **workspace**:

```bash
cd tofu && tofu plan -no-color -var-file=/tmp/scale-out.tfvars | grep -E 'will be (created|updated|destroyed)|Plan:'
```

Exit code 0, 7.0 s.

```text
  # aws_instance.node["wn-03"] will be created
Plan: 2 to add, 0 to change, 1 to destroy.
```

## 4. Apply: the machine is created and the inventory regenerated  `+00:08`

The Ansible inventory is generated from the instances, so wn-03 appears in it automatically.

On **workspace**:

```bash
cd tofu && tofu apply -no-color -auto-approve -var-file=/tmp/scale-out.tfvars | grep -E 'Creating\.\.\.|Creation complete|Apply complete'
```

Exit code 0, 19.5 s.

```text
aws_instance.node["wn-03"]: Creating...
aws_instance.node["wn-03"]: Creation complete after 13s [id=i-0f9c15f22299779f5]
local_file.inventory: Creating...
local_file.inventory: Creation complete after 0s [id=e8ccd86b7ef5b967b476cf618fe84c3b3b4da0fb]
Apply complete! Resources: 2 added, 0 changed, 1 destroyed.
```

## 5. Wait until the machine accepts SSH  `+00:27`

A fresh EC2 instance needs a short time to boot. The check is repeated until Ansible reaches the node.

Waited for a condition on **local**, met after 23.6 s (2 checks):

```bash
cd ansible && ANSIBLE_CONFIG=$PWD/ansible.cfg ansible wn-03 -m ping >/dev/null 2>&1
```

Once the condition holds, on **workspace**:

```bash
cd ansible && ANSIBLE_CONFIG=$PWD/ansible.cfg ansible wn-03 -m ping | grep -E 'SUCCESS|pong'
```

```text
wn-03 | SUCCESS => {
    "ping": "pong"
```

## 6. Bootstrap only the new node  `+00:53`

Ansible installs the agent and sends the certificate request carrying the role and the challenge password. From here on, nothing is configured by hand.

On **workspace**:

```bash
cd ansible && ANSIBLE_CONFIG=$PWD/ansible.cfg ansible-playbook site.yml --limit wn-03 | grep -E 'PLAY RECAP|^wn-03 +:'
```

Exit code 0, 62.8 s.

```text
PLAY RECAP *********************************************************************
wn-03                      : ok=13   changed=10   unreachable=0    failed=0    skipped=0    rescued=0    ignored=0
[WARNING]: Module remote_tmp /root/.ansible/tmp did not exist and was created with a mode of 0700, this may cause issues when running as another user. To avoid this, create the remote_tmp dir with the correct permissions manually
```

## 7. The node joins the pool by itself  `+01:55`

Behind the scenes: the autosign policy signs the request, Puppet compiles the catalog for the role, installs and configures HTCondor, and the startd registers at the collector.

Waited for a condition on **cm-01**, met after 113.0 s (8 checks):

```bash
condor_status -af Machine | grep -q '^wn-03'
```

Once the condition holds, on **cm-01**:

```bash
condor_status -af Machine State Cpus NODE_IS_HEALTHY
```

```text
wn-01 Unclaimed 2 true
wn-02 Unclaimed 2 true
wn-03 Unclaimed 2 true
```

## 8. Its certificate carries the role, signed automatically  `+03:49`

wn-03 was admitted by the policy script, and its role is written in the certificate.

On **cm-01 (root)**:

```bash
/opt/puppetlabs/bin/puppetserver ca list --all | grep -E '^ *wn-03' | cut -c1-30; openssl x509 -in /etc/puppetlabs/puppet/ssl/ca/signed/wn-03.pem -noout -text | grep -A1 '1.3.6.1.4.1.34380.1.1.13' | tail -1 | tr -d ' .' | sed 's/^/pp_role in the certificate: /'
```

Exit code 0, 1.3 s.

```text
    wn-03       (SHA256)  89:0
pp_role in the certificate: execute
```

## 9. Jobs run on the new node  `+03:51`

The proof that wn-03 is a full member of the pool.

On **cm-01**:

```bash
cd ~/jobs && condor_submit sleep.sub
```

Exit code 0, 25.7 s.

```text
Submitting job(s)........
8 job(s) submitted to cluster 7.
```

Waited for a condition on **cm-01**, met after 25.7 s (5 checks):

```bash
condor_q -run -nobatch | grep -q '@wn-03'
```

## 10. Jobs per worker  `+04:16`

Running jobs, grouped by worker.

On **cm-01**:

```bash
condor_q -run -nobatch | grep -oE '@wn-[0-9]+' | sort | uniq -c
```

Exit code 0, 1.0 s.

```text
      2 @wn-01
      2 @wn-02
      2 @wn-03
```

