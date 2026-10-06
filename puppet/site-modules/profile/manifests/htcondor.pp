# profile::htcondor: what EVERY HTCondor node needs, whatever its role in the pool:
# the package repository, the package, the shared settings, the pool key, and the service.
# The role-specific profiles (central_manager, submit, execute) only add a small config file and
# rely on this class for the package and the service.
#
# HTCondor vocabulary used below (details in the chat):
#   condor_master    the daemon started by the "condor" service; it starts the other daemons of the node
#   DAEMON_LIST      which daemons the master starts (set per role with "use ROLE: ...")
#   CONDOR_HOST      the machine running the collector: every node must know where to find it
#   pool key         the secret shared by all nodes, stored in /etc/condor/passwords.d/POOL; daemons use it
#                    to prove to each other that they belong to the pool (IDTOKENS authentication)
class profile::htcondor (
  String            $condor_host,
  # Sensitive: Puppet hides the value in logs and reports. Call .unwrap only where the real value is needed.
  Sensitive[String] $pool_password,
) {
  # The release repository of the 25.0 LTS channel. gpgcheck=1 verifies every PACKAGE signature.
  # repo_gpgcheck is 0 because the repository metadata signature is currently reported as bad by dnf
  # (recorded in docs/DECISIONS.md): packages stay verified, only the metadata signature is skipped.
  yumrepo { 'htcondor':
    descr         => 'HTCondor 25.0 LTS for Enterprise Linux 9',
    baseurl       => 'https://htcss-downloads.chtc.wisc.edu/repo/25.0/el9/$basearch/release',
    enabled       => 1,
    gpgcheck      => 1,
    repo_gpgcheck => 0,
    gpgkey        => 'https://research.cs.wisc.edu/htcondor/repo/keys/HTCondor-25.0-Key',
  }

  # The condor package depends on packages that only EPEL provides (voms, scitokens-cpp, apptainer).
  # epel-release is in AlmaLinux's own repositories and installs the EPEL repository definition.
  package { 'epel-release':
    ensure => installed,
  }

  package { 'condor':
    ensure  => installed,
    require => [Yumrepo['htcondor'], Package['epel-release']],
  }

  # Settings common to all nodes, rendered from an EPP template (Embedded Puppet).
  file { '/etc/condor/config.d/10-common.conf':
    ensure  => file,
    owner   => 'root',
    group   => 'root',
    mode    => '0644',
    content => epp('profile/htcondor/common.conf.epp', { 'condor_host' => $condor_host }),
    require => Package['condor'],
    notify  => Service['condor'],
  }

  # The pool key. condor_store_cred reads the secret on its standard input and writes the key file.
  # The secret goes through an environment variable, never on a command line (visible in ps).
  # Idempotence: once the key file exists the command must not run again.
  exec { 'htcondor-pool-key':
    command     => 'printf "%s" "$POOL_KEY" | /usr/sbin/condor_store_cred -c add -i -',
    provider    => 'shell',
    environment => ["POOL_KEY=${pool_password.unwrap}"],
    logoutput   => false,
    creates     => '/etc/condor/passwords.d/POOL',
    require     => Package['condor'],
    notify      => Service['condor'],
  }

  # The pool key alone is not enough: each daemon authenticates with an IDTOKEN signed with it.
  # Every node holds the key, so each one mints its own token locally (no token to distribute).
  # The identity is condor@<trust domain>, and the trust domain is the central manager (see
  # common.conf.epp): a token is only accepted when its domain matches the collector's.
  exec { 'htcondor-daemon-token':
    command => "/usr/bin/condor_token_create -identity condor@${condor_host} -token condor@${condor_host}",
    creates => "/etc/condor/tokens.d/condor@${condor_host}",
    require => Exec['htcondor-pool-key'],
    notify  => Service['condor'],
  }

  service { 'condor':
    ensure  => running,
    enable  => true,
    require => Package['condor'],
  }
}
