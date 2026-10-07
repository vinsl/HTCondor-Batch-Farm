# profile::htcondor::central_manager: runs the collector (the database of all ClassAds) and the
# negotiator (the matchmaker that pairs jobs with machines).
class profile::htcondor::central_manager {
  include profile::htcondor

  file { '/etc/condor/config.d/20-role.conf':
    ensure  => file,
    owner   => 'root',
    group   => 'root',
    mode    => '0644',
    content => "use ROLE: CentralManager\n",
    require => Package['condor'],
    notify  => Service['condor'],
  }
}
