# profile::htcondor::execute: runs the startd, the daemon that advertises the machine's resources
# (CPUs, memory) as a ClassAd and runs the jobs that the negotiator matched to it.
# It also installs the health check: a sick node stops accepting jobs by itself.
class profile::htcondor::execute {
  include profile::htcondor

  $health_script = '/usr/local/libexec/condor/health_check.py'

  file { '/etc/condor/config.d/20-role.conf':
    ensure  => file,
    owner   => 'root',
    group   => 'root',
    mode    => '0644',
    content => "use ROLE: Execute\n",
    require => Package['condor'],
    notify  => Service['condor'],
  }

  # The health check program, taken from the files/ directory of the profile module.
  file { ['/usr/local/libexec', '/usr/local/libexec/condor']:
    ensure => directory,
    owner  => 'root',
    group  => 'root',
    mode   => '0755',
  }

  file { $health_script:
    ensure  => file,
    owner   => 'root',
    group   => 'root',
    mode    => '0755',
    source  => 'puppet:///modules/profile/htcondor/health_check.py',
    require => File['/usr/local/libexec/condor'],
  }

  # The startd configuration that runs it periodically and uses its result in START.
  file { '/etc/condor/config.d/40-health.conf':
    ensure  => file,
    owner   => 'root',
    group   => 'root',
    mode    => '0644',
    # Rendered from the EPP template, which declares one parameter named script; its value is the path
    # of the health check program held in $health_script.
    content => epp('profile/htcondor/startd_cron.conf.epp', { 'script' => $health_script }),
    # The program must exist BEFORE the configuration that points to it, and condor must pick up the new
    # configuration whenever this file changes.
    require => File[$health_script],
    notify  => Service['condor'],
  }
}
