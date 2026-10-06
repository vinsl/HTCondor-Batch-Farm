# role::central_manager: WHAT this machine is, expressed as a list of profiles.
# A role contains no resources and no logic: it only includes profiles.
# Rule: one node has exactly ONE role (chosen in site.pp); a role is a list of technology profiles.
class role::central_manager {
  include profile::base
  include profile::htcondor::central_manager
  include profile::htcondor::submit

}
