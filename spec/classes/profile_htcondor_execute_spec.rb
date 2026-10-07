# Tests of profile::htcondor::execute (an HTCondor worker with its health check).
describe 'profile::htcondor::execute' do
  # The class includes profile::htcondor, whose parameters come from Hiera in production. The pool
  # key is a secret kept outside the repository, so the test supplies a harmless value itself.
  #
  # The yumrepo resource type ships inside the openvox-agent package installed on the nodes, but not
  # in the openvox gem used here: an empty stand-in lets the catalog compile. It checks nothing about
  # the repository, which is verified for real when the fleet converges.
  let(:pre_condition) do
    <<~PUPPET
      define yumrepo($descr = undef, $baseurl = undef, $enabled = undef, $gpgcheck = undef,
                     $repo_gpgcheck = undef, $gpgkey = undef) {}
      class { 'profile::htcondor': condor_host => 'cm-01', pool_password => Sensitive('not-a-real-key') }
    PUPPET
  end

  # Example (complete): the catalog compiles and the worker role file is managed.
  it { is_expected.to compile.with_all_deps }
  it { is_expected.to contain_file('/etc/condor/config.d/20-role.conf').with_content(%r{use ROLE: Execute}) }

  # TODO(human): the health check configuration must publish the result through STARTD_CRON and
  # use it in START. Check that /etc/condor/config.d/40-health.conf has content matching
  # NODE_IS_HEALTHY (hint: .with_content(/NODE_IS_HEALTHY/)).

  # TODO(human): the health check program must be installed BEFORE the configuration that points to
  # it. Check the relation on the config file: contain_file('/etc/condor/config.d/40-health.conf')
  # followed by .that_requires('File[/usr/local/libexec/condor/health_check.py]').
end
