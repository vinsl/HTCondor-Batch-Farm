# role::central_manager: WHAT this machine is, expressed as a list of profiles.
# A role contains no resources and no logic: it only includes profiles.
# Rule: one node has exactly ONE role (chosen in site.pp); a role is a list of technology profiles.
class role::central_manager {
  include profile::base
  # TODO(human): make this role apply the profile::base class.
  # Hint: same keyword as in demo4 (the one that tolerates being written several times).
  # HTCondor profiles (central manager, submit) will be added to this role in Phase 3.
}
