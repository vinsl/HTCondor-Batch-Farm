# Demo: Puppet detects and reverts manual changes

> Manual changes made on a node by hand are detected as drift and reverted by the next Puppet run, and a further run changes nothing.

Recorded 2026-10-07T09:30:52+00:00 from commit `6035cb2`, 6 steps in 00:22. Result: **success**. Full data: `record.json`.

## 1. Baseline: wn-01 matches its desired state  `+00:00`

A Puppet run on a converged node changes nothing: exit code 0.

On **wn-01 (root)**:

```bash
/opt/puppetlabs/bin/puppet agent -t --detailed-exitcodes >/dev/null 2>&1; rc=$?; echo "puppet exit code: $rc (0 = nothing to change)"; test $rc -eq 0
```

Exit code 0, 5.0 s.

```text
puppet exit code: 0 (0 = nothing to change)
```

## 2. Three manual changes, as a careless admin would make  `+00:05`

Edit the time configuration, delete the SSH hardening file, and stop the firewall.

On **wn-01 (root)**:

```bash
echo '# edited by hand' >> /etc/chrony.conf; rm -f /etc/ssh/sshd_config.d/60-hardening.conf; systemctl stop firewalld; echo "chrony.conf hand-edited: $(grep -c 'edited by hand' /etc/chrony.conf) line"; echo "hardening file present: $(test -f /etc/ssh/sshd_config.d/60-hardening.conf && echo yes || echo no)"; echo "firewalld: $(systemctl is-active firewalld)"
```

Exit code 0, 1.2 s.

```text
chrony.conf hand-edited: 1 line
hardening file present: no
firewalld: inactive
```

## 3. Dry run: what Puppet would change  `+00:06`

--noop compares the node to its desired state and reports the drift without touching anything (the equivalent of tofu plan).

On **wn-01 (root)**:

```bash
/opt/puppetlabs/bin/puppet agent -t --noop >/tmp/noop.log 2>&1; sed 's/\x1b\[[0-9;]*m//g' /tmp/noop.log | grep -E '^Notice: /Stage' | cut -c1-150
```

Exit code 0, 5.0 s.

```text
Notice: /Stage[main]/Profile::Base/File[/etc/chrony.conf]/content: 
Notice: /Stage[main]/Profile::Base/File[/etc/chrony.conf]/content: 
Notice: /Stage[main]/Profile::Base/File[/etc/chrony.conf]/content: content changed '{sha256}e5d081a7cdee6859effd3831d1065cf8e54ecfb08be9d7bedd17cfa0fd
Notice: /Stage[main]/Profile::Base/Service[chronyd]: Would have triggered 'refresh' from 1 event
Notice: /Stage[main]/Profile::Base/File[/etc/ssh/sshd_config.d/60-hardening.conf]/ensure: defined content as '{sha256}38cbcb884fc028e8b07d32ea5c4b2ccb
Notice: /Stage[main]/Profile::Base/Service[sshd]: Would have triggered 'refresh' from 1 event
Notice: /Stage[main]/Profile::Base/Service[firewalld]/ensure: ensure changed 'stopped' to 'running' (noop) (corrective)
Notice: /Stage[main]/Profile::Base/Exec[firewalld-open-9618]/returns: executed successfully (noop) (corrective)
Notice: /Stage[main]/Profile::Base/Exec[firewalld-reload]: Would have triggered 'refresh' from 1 event
```

## 4. Real run: Puppet reverts the drift  `+00:11`

Every difference is corrected; the services that depend on a corrected file are refreshed.

On **wn-01 (root)**:

```bash
/opt/puppetlabs/bin/puppet agent -t --detailed-exitcodes >/tmp/run.log 2>&1; rc=$?; sed 's/\x1b\[[0-9;]*m//g' /tmp/run.log | grep -E '^Notice: /Stage' | cut -c1-150; echo "puppet exit code: $rc (2 = changes applied)"; test $rc -eq 2
```

Exit code 0, 5.5 s.

```text
Notice: /Stage[main]/Profile::Base/File[/etc/chrony.conf]/content: 
Notice: /Stage[main]/Profile::Base/File[/etc/chrony.conf]/content: 
Notice: /Stage[main]/Profile::Base/File[/etc/chrony.conf]/content: content changed '{sha256}e5d081a7cdee6859effd3831d1065cf8e54ecfb08be9d7bedd17cfa0fd
Notice: /Stage[main]/Profile::Base/Service[chronyd]: Triggered 'refresh' from 1 event
Notice: /Stage[main]/Profile::Base/File[/etc/ssh/sshd_config.d/60-hardening.conf]/ensure: defined content as '{sha256}38cbcb884fc028e8b07d32ea5c4b2ccb
Notice: /Stage[main]/Profile::Base/Service[sshd]: Triggered 'refresh' from 1 event
Notice: /Stage[main]/Profile::Base/Service[firewalld]/ensure: ensure changed 'stopped' to 'running' (corrective)
puppet exit code: 2 (2 = changes applied)
```

## 5. Verify the node is back to its desired state  `+00:16`

The hand edit is gone, the hardening file is back, the firewall runs again.

On **wn-01 (root)**:

```bash
test $(grep -c 'edited by hand' /etc/chrony.conf) -eq 0 && echo 'chrony.conf: hand edit gone'; test -f /etc/ssh/sshd_config.d/60-hardening.conf && echo 'sshd hardening file: back'; echo "firewalld: $(systemctl is-active firewalld)"; test "$(systemctl is-active firewalld)" = active
```

Exit code 0, 1.1 s.

```text
chrony.conf: hand edit gone
sshd hardening file: back
firewalld: active
```

## 6. A second run changes nothing  `+00:17`

Idempotence: once converged, Puppet does nothing.

On **wn-01 (root)**:

```bash
/opt/puppetlabs/bin/puppet agent -t --detailed-exitcodes >/dev/null 2>&1; rc=$?; echo "puppet exit code: $rc (0 = nothing to change)"; test $rc -eq 0
```

Exit code 0, 4.6 s.

```text
puppet exit code: 0 (0 = nothing to change)
```

