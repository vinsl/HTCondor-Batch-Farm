# Tests of profile::base. The catalog is compiled for a node, with the values Hiera gives that node.
#
# Reminder of the data (puppet/data): common.yaml opens port 9618; roles/central_manager.yaml
# replaces the list by 8140 and 9618 (the first file that defines a key wins).
describe 'profile::base' do
  context 'on a central manager' do
    # The role comes from the certificate: rspec-puppet exposes it as $trusted['extensions']['pp_role'].
    let(:trusted_facts) { { 'pp_role' => 'central_manager' } }
    let(:node) { 'cm-01' }

    # Example (complete): the catalog compiles and the OpenVox port is opened.
    it { is_expected.to compile.with_all_deps }
    it { is_expected.to contain_exec('firewalld-open-8140') }

    # TODO(human): the central manager must also open the HTCondor port 9618.
    # Hint: same matcher as the line above, with the title of the exec for port 9618.
  end

  context 'on an execute node' do
    let(:trusted_facts) { { 'pp_role' => 'execute' } }
    let(:node) { 'wn-01' }

    it { is_expected.to compile.with_all_deps }

    # TODO(human): a worker must NOT open the OpenVox port (it only runs the agent).
    # Hint: `is_expected.not_to contain_exec(...)`.

    # TODO(human): chronyd must restart when /etc/chrony.conf changes. Check the relation on the service:
    # contain_service('chronyd') followed by .that_subscribes_to('File[...]') with the file reference.
  end
end
