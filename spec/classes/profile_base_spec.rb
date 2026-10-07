# Tests of profile::base. The catalog is compiled for a node, with the values Hiera gives that node.
#
# Reminder of the data (puppet/data): common.yaml opens port 9618; roles/central_manager.yaml
# replaces the list by 8140 and 9618 (the first file that defines a key wins).
describe 'profile::base' do
  context 'on a central manager' do
    # The role comes from the certificate: rspec-puppet exposes it as $trusted['extensions']['pp_role'].
    let(:trusted_facts) { { 'pp_role' => 'central_manager' } }
    let(:node) { 'cm-01' }

    # The role file replaces the common list: the central manager opens both ports.
    it { is_expected.to compile.with_all_deps }
    it { is_expected.to contain_exec('firewalld-open-8140') }
    it { is_expected.to contain_exec('firewalld-open-9618') }
  end

  context 'on an execute node' do
    let(:trusted_facts) { { 'pp_role' => 'execute' } }
    let(:node) { 'wn-01' }

    it { is_expected.to compile.with_all_deps }

    # A worker only runs the agent: it must not open the OpenVox port (it gets the common list, 9618).
    it { is_expected.to contain_exec('firewalld-open-9618') }
    it { is_expected.not_to contain_exec('firewalld-open-8140') }

    # chronyd restarts when its configuration file changes.
    it { is_expected.to contain_service('chronyd').that_subscribes_to('File[/etc/chrony.conf]') }
  end
end
