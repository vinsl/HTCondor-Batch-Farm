# role::execute: an execute node (HTCondor worker). Same shape as role::central_manager.
class role::execute {
  include profile::base
  # TODO(human): make this role apply the profile::base class.
  # HTCondor profile (execute) will be added in Phase 3.
}
