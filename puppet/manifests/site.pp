# site.pp: the entry point. The server compiles this file for EVERY node that asks for a catalog.
#
# Goal: give each node the role written in its certificate, and nothing else.
#
# $facts are declared by the node itself and can be forged; $trusted is built by the server from
# the signed certificate and cannot be forged. The role must come from $trusted.
# $trusted['extensions'] is a hash of the certificate extensions; the key of our extension is its
# short name, pp_role (the one written in csr_attributes.yaml). Two levels, no more: there is no
# 'os' key here ('os' is a key of $facts).

node default {
  $role = $trusted['extensions']['pp_role']

  # Fail closed: a node without role (undef counts as false) gets NO catalog at all.
  # fail() aborts the compilation; warning() would only log and the node would converge anyway.
  if $role {
    include "role::${role}"
  } else {
    fail('A node without role must not get anything')
  }
}
