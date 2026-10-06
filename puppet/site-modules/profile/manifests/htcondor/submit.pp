# profile::htcondor::submit: runs the schedd, the daemon that holds the job queue of this machine
# and the one condor_submit talks to.
class profile::htcondor::submit {
  include profile::htcondor

  file { '/etc/condor/config.d/30-submit.conf':
    ensure  => file,
    owner   => 'root',
    group   => 'root',
    mode    => '0644',
    content => "use ROLE: Submit\n",
    require => Package['condor'],
    notify  => Service['condor'],
  }
}
