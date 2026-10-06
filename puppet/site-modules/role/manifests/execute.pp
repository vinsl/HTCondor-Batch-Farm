# role::execute: an execute node (HTCondor worker). Same shape as role::central_manager.
class role::execute {
  include profile::base
  include profile::htcondor::execute

}
