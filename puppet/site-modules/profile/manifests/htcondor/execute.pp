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
    # TODO(human): render profile/htcondor/startd_cron.conf.epp, passing the path of the script.
    # The template declares one parameter, named script; the value is the variable $health_script.
    content => '',
    # TODO(human): two relations are needed. The program must exist BEFORE this config points
    # to it (a relation towards File[$health_script], a variable: no quotes), and condor must pick
    # up the new configuration when this file changes (towards Service['condor']).
  }
}
