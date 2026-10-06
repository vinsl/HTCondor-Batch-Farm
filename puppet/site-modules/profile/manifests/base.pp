# profile::base: what EVERY node of the fleet needs, whatever its role.
# One technology per section: time synchronisation, SSH hardening, firewall, base packages.
#
# Parameters get their value from Hiera automatically (lookup of profile::base::<parameter>),
# otherwise from the default written here.
class profile::base (
  # Example (complete): the base packages. Type, name, default value.
  Array[String] $packages = ['vim-enhanced', 'bind-utils', 'lsof'],

  Array[Integer] $firewall_ports,
  String $ntp_pool,

) {
  # --- Base packages (an array as title creates one resource per element) -------------------
  package { $packages:
    ensure => installed,
  }

  # --- Time synchronisation (chrony): package -> config -> service ----------------------------
  package { 'chrony':
    ensure => installed,
  }

  # The Amazon Time Sync Service (169.254.169.123) is the preferred source on EC2: it is the one the
  # image shipped with, and our file replaces the whole configuration, so it must be kept here.
  file { '/etc/chrony.conf':
    ensure  => file,
    owner   => 'root',
    group   => 'root',
    mode    => '0644',
    content => "server 169.254.169.123 prefer iburst minpoll 4 maxpoll 4\npool ${ntp_pool} iburst\ndriftfile /var/lib/chrony/drift\nmakestep 1.0 3\nrtcsync\nlogdir /var/log/chrony\n",
    require => Package['chrony'],
  }

  service { 'chronyd':
    ensure => running,
    enable => true,
    subscribe => File['/etc/chrony.conf'],
  }

  # --- SSH hardening: a drop-in file, the main sshd_config is left untouched ----------------
  file { '/etc/ssh/sshd_config.d/60-hardening.conf':
    ensure  => file,
    owner   => 'root',
    group   => 'root',
    mode    => '0600',
    content => "PermitRootLogin no\nPasswordAuthentication no\nKbdInteractiveAuthentication no\nX11Forwarding no\n",
    notify  => Service['sshd'],
  }

  service { 'sshd':
    ensure => running,
    enable => true,
  }

  # --- Firewall (firewalld) -------------------------------------------------------------------
  # SSH (22) is allowed by default in the "public" zone. The ports below are added on top of it.
  package { 'firewalld':
    ensure => installed,
  }

  service { 'firewalld':
    ensure  => running,
    enable  => true,
    require => Package['firewalld'],
  }

  # One exec per port. firewall-cmd is a command, not a Puppet resource: the exec would run at EVERY
  # Puppet run unless we tell Puppet how to know the work is already done.
  $firewall_ports.each |Integer $port| {
    exec { "firewalld-open-${port}":
      command => "/usr/bin/firewall-cmd --permanent --add-port=${port}/tcp",
      unless  => "/usr/bin/firewall-cmd --permanent --query-port=${port}/tcp",
      require => Service['firewalld'],
      notify  => Exec['firewalld-reload'],
    }
  }

  # --permanent only writes the configuration; a reload applies it. refreshonly: run only when notified.
  exec { 'firewalld-reload':
    command     => '/usr/bin/firewall-cmd --reload',
    refreshonly => true,
  }
}
