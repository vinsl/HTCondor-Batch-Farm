#!/usr/bin/env bash
# Collect the evidence of a working fleet into resources/ (run from the repository root, fleet up).
# Every file is plain text meant to be quoted in the README. Public IP addresses are masked and no
# secret is printed (only secret-free commands are run).
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$ROOT/resources"
mkdir -p "$OUT"
cd "$ROOT/ansible" || exit 1

mask() { sed -E 's/\x1b\[[0-9;]*m//g; s/\b(3|13|15|18|35|51|52|54|63)\.[0-9]+\.[0-9]+\.[0-9]+\b/<public-ip>/g'; }
remote() { ansible "$1" -b -m shell -a "$2" 2>&1 | grep -vE 'WARNING|CHANGED|^\s*$' | mask; }

echo "== 01 idempotence (second Ansible run must report changed=0, second Puppet run exit=0)"
{
  echo "# Ansible, full playbook, run twice"
  for run in 1 2; do
    echo "--- ansible-playbook site.yml (run $run)"
    ansible-playbook site.yml 2>&1 | grep -E 'PLAY RECAP|^(cm|wn)-[0-9]+ +:' | sed -E 's/ +/ /g'
  done
  echo
  echo "# Puppet agent, run on each node (exit 0 = no change, 2 = changes applied)"
  for n in cm-01 wn-01 wn-02; do
    printf '%s -> ' "$n"
    ansible "$n" -b -m shell -a '/opt/puppetlabs/bin/puppet agent -t --detailed-exitcodes >/dev/null 2>&1; echo exit=$?' 2>&1 | grep -o 'exit=[0-9]*'
  done
} | tee "$OUT/01-idempotence.txt"

echo "== 02 certificates and trusted role"
{
  echo "# Certificates known to the OpenVox CA (all signed by the autosign policy)"
  remote cm-01 '/opt/puppetlabs/bin/puppetserver ca list --all' | sed -E 's/\(SHA256\) +[0-9A-F:]+/(SHA256) <fingerprint>/'
  echo
  echo "# pp_role extension (OID 1.3.6.1.4.1.34380.1.1.13) inside each signed certificate"
  for n in cm-01 wn-01 wn-02; do
    printf '%s: ' "$n"
    ansible cm-01 -b -m shell -a "openssl x509 -in /etc/puppetlabs/puppet/ssl/ca/signed/$n.pem -noout -text | grep -A1 '1.3.6.1.4.1.34380.1.1.13' | tail -1 | tr -d ' .'" 2>&1 | grep -vE 'WARNING|CHANGED|^\s*$'
  done
  echo
  echo "# The challenge password must NOT be stored in the certificate (count of matches, expected 0)"
  remote cm-01 "openssl x509 -in /etc/puppetlabs/puppet/ssl/ca/signed/wn-01.pem -noout -text | grep -ci challenge || true"
} | tee "$OUT/02-certificates.txt"

echo "== 03 hiera hierarchy (the first file defining the key wins)"
{
  echo "# Data files, from the most specific level to the least specific (see puppet/hiera.yaml)"
  echo "--- puppet/data/roles/central_manager.yaml"; grep -v '^#' "$ROOT/puppet/data/roles/central_manager.yaml"
  echo "--- puppet/data/common.yaml (profile::base::firewall_ports only)"
  sed -n '/^profile::base::firewall_ports/,/^$/p' "$ROOT/puppet/data/common.yaml"
  echo
  echo "# Result applied on each node by profile::base (permanent firewalld ports)"
  for n in cm-01 wn-01 wn-02; do
    printf '%s: ' "$n"
    ansible "$n" -b -m shell -a 'firewall-cmd --permanent --list-ports' 2>&1 | grep -vE 'WARNING|CHANGED|^\s*$'
  done
} | tee "$OUT/03-hiera.txt"

echo "== 04 htcondor pool"
{
  echo "# Daemons per node"
  for n in cm-01 wn-01 wn-02; do
    printf '%s: ' "$n"; ansible "$n" -b -m shell -a 'condor_config_val DAEMON_LIST' 2>&1 | grep -vE 'WARNING|CHANGED|^\s*$'
  done
  echo
  echo "# condor_status: the slots of the two workers"
  remote cm-01 'condor_status'
  echo
  echo "# Health attributes published by each startd"
  remote cm-01 'condor_status -af Machine NODE_IS_HEALTHY NODE_HEALTH_REASON | sort -u'
} | tee "$OUT/04-pool.txt"

echo "== 05 infrastructure (tofu plan must report no changes)"
{
  ( cd "$ROOT/tofu" && tofu plan -no-color 2>&1 | grep -E '^(No changes|Plan:|Error)' )
  echo
  echo "# Versions"
  ( cd "$ROOT/tofu" && tofu version | head -1 )
  ansible --version | head -1
  remote cm-01 'rpm -q openvox-server openvox-agent condor'
} | tee "$OUT/05-infrastructure.txt"

echo "Evidence written to $OUT"
