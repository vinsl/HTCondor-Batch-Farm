# rspec-puppet setup. Tests compile real catalogs from the control repository (puppet/), using its
# real Hiera hierarchy, so they check what the OpenVox server would hand to a node.
require 'rspec-puppet'

control_repo = File.expand_path('../puppet', __dir__)

RSpec.configure do |c|
  c.module_path = File.join(control_repo, 'site-modules')
  c.hiera_config = File.join(control_repo, 'hiera.yaml')
  c.strict_variables = true
  # Facts every test node has, unless a test overrides them (what Facter reports on AlmaLinux 9).
  c.default_facts = {
    'os' => { 'family' => 'RedHat', 'name' => 'AlmaLinux', 'release' => { 'major' => '9' } },
    'networking' => { 'hostname' => 'node-test', 'ip' => '10.0.1.10' },
  }
end
