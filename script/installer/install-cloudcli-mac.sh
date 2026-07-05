#!/usr/bin/env bash
#
# install-cloudcli-mac.sh
#
# Installs Node.js (if it isn't already installed) and @cloudcli-ai/cloudcli, so that
# Checkout-Proxy's [Tools] -> [AI Desktop] feature works out of the box.
#
# Usage (download and run directly):
#   curl -fsSL <raw-url-of-this-script> | bash
#
# or download it first and run locally:
#   chmod +x install-cloudcli-mac.sh
#   ./install-cloudcli-mac.sh
#
set -euo pipefail

CLOUDCLI_PKG="@cloudcli-ai/cloudcli"
NODE_DIST_URL="https://nodejs.org/dist/latest-lts/"

log() { printf '\n\033[1;34m[cloudcli-installer]\033[0m %s\n' "$1"; }
err() { printf '\n\033[1;31m[cloudcli-installer] ERROR:\033[0m %s\n' "$1" >&2; }

# Look for Homebrew even if it isn't on PATH yet in this shell (fresh installs of Homebrew
# itself often aren't picked up until a new terminal session starts).
find_brew() {
    if command -v brew >/dev/null 2>&1; then
        command -v brew
        return 0
    fi
    for candidate in /opt/homebrew/bin/brew /usr/local/bin/brew; do
        if [ -x "$candidate" ]; then
            echo "$candidate"
            return 0
        fi
    done
    return 1
}

install_node_via_brew() {
    local brew_bin="$1"
    log "Installing Node.js via Homebrew..."
    "$brew_bin" install node
}

install_node_via_pkg() {
    log "Homebrew not found. Downloading the official Node.js installer from nodejs.org..."
    # The macOS Node.js .pkg installer is a universal binary (Intel + Apple Silicon), so no
    # architecture selection is needed.
    local pkg_name
    pkg_name=$(curl -fsSL "$NODE_DIST_URL" | grep -Eo 'node-v[0-9]+\.[0-9]+\.[0-9]+\.pkg' | head -1 || true)
    if [ -z "$pkg_name" ]; then
        err "Could not determine the latest Node.js installer filename."
        err "Please install Node.js manually from https://nodejs.org/en/download and re-run this script."
        exit 1
    fi

    local tmp_dir
    tmp_dir="$(mktemp -d)"
    trap 'rm -rf "$tmp_dir"' EXIT
    local tmp_pkg="$tmp_dir/$pkg_name"

    log "Downloading $pkg_name..."
    curl -fsSL "${NODE_DIST_URL}${pkg_name}" -o "$tmp_pkg"

    log "Installing Node.js (you may be asked for your password)..."
    sudo installer -pkg "$tmp_pkg" -target /
}

if command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1; then
    log "Node.js is already installed ($(node -v)). Skipping Node.js installation."
else
    log "Node.js was not found on this machine."
    if brew_bin=$(find_brew); then
        install_node_via_brew "$brew_bin"
    else
        install_node_via_pkg
    fi

    # Make sure `node`/`npm` are on PATH for the rest of this script, even on a fresh install.
    export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
    hash -r

    if ! command -v node >/dev/null 2>&1; then
        err "Node.js installation finished, but 'node' is still not on PATH."
        err "Please close and reopen your terminal, then re-run this script."
        exit 1
    fi
    log "Node.js installed successfully ($(node -v))."
fi

log "Installing ${CLOUDCLI_PKG} globally via npm..."
npm install -g "$CLOUDCLI_PKG"

log "Done! ${CLOUDCLI_PKG} is installed."
log "Open Checkout-Proxy and click [Tools] -> [AI Desktop] to launch it."
