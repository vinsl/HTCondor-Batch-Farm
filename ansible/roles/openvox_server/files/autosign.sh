#!/usr/bin/env bash
# Autosign policy for OpenVox server.
#
# CONTRACT with puppetserver (it calls this script once per incoming CSR):
#   $1      the certname the node asks for (for example wn-01)
#   stdin   the CSR itself, in PEM format
#   exit 0  -> the certificate is signed
#   exit !0 -> the request is refused (it stays pending, nothing is signed)
#
# Rule: sign only if the challenge password embedded in the CSR equals the shared secret stored in
# SECRET_FILE. Never sign by default: any unexpected situation must end in a refusal.
#
# Tip: how openssl prints the attribute of a CSR (test it by hand with a CSR you generate):
#   openssl req -noout -text
#       Attributes:
#           challengePassword        :THE-SECRET-VALUE
#           Requested Extensions:

set -euo pipefail

SECRET_FILE="/etc/puppetlabs/puppet/autosign_secret"
certname="${1:-}"

csr_pem="$(cat)" # read the CSR from stdin once

# Refuse if the certname is missing or the secret file is unreadable: fail closed.
[[ -n "$certname" ]] || { echo "autosign: no certname" >&2; exit 1; }
[[ -r "$SECRET_FILE" ]] || { echo "autosign: cannot read secret file" >&2; exit 1; }
expected="$(< "$SECRET_FILE")"

# Extract the challenge password from the CSR.
# The whole awk program (pattern AND action) must be inside ONE pair of single quotes: otherwise
# the shell, not awk, sees {print $2; exit} and expands $2 itself (an unbound variable here).
# '/challengePassword/ {...}' runs the action only on the line matching the pattern; -F ':' splits
# that line at the colon, so $2 is the value. No such line -> awk prints nothing -> provided is empty.
provided="$(printf '%s' "$csr_pem" | openssl req -noout -text | awk -F ':' '/challengePassword/ {print $2; exit}')"

# Sign only when the challenge is non-empty AND exactly equals the expected secret.
# Compare the two SECRETS (provided vs expected); the certname is only used in the message.
if [[ -n "$provided" && "$provided" == "$expected" ]]; then
    exit 0
else
    # The message names the node and NEVER contains $provided or $expected (it would end up in logs).
    echo "autosign: refused $certname (challenge password missing or wrong)" >&2
    exit 1
fi
