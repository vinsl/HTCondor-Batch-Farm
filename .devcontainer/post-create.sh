#!/usr/bin/env bash
# Installs the tools that have no official devcontainer feature.
set -euo pipefail

# --- OpenTofu (official installer, .deb method) ---
if ! command -v tofu >/dev/null; then
  curl --proto '=https' --tlsv1.2 -fsSL https://get.opentofu.org/install-opentofu.sh -o /tmp/install-opentofu.sh
  chmod +x /tmp/install-opentofu.sh
  sudo /tmp/install-opentofu.sh --install-method deb
  rm -f /tmp/install-opentofu.sh
fi

# --- Gitleaks (latest GitHub release, linux x64) ---
if ! command -v gitleaks >/dev/null; then
  version=$(curl -fsSL https://api.github.com/repos/gitleaks/gitleaks/releases/latest | grep -m1 '"tag_name"' | sed -E 's/.*"v([^"]+)".*/\1/')
  curl -fsSL "https://github.com/gitleaks/gitleaks/releases/download/v${version}/gitleaks_${version}_linux_x64.tar.gz" \
    | sudo tar -xz -C /usr/local/bin gitleaks
fi

# --- Python tooling, isolated with pipx ---
pipx ensurepath
pipx install --include-deps ansible
pipx install ansible-lint
pipx install checkov
pipx install ruff
pipx install pytest

# --- Ruby tooling: Bundler, then the Puppet test gems pinned by the project Gemfile ---
gem install --no-document bundler
if [ -f Gemfile ]; then
  bundle config set --local path vendor/bundle
  bundle install
fi

echo "post-create done"
