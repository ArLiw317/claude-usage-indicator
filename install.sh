#!/usr/bin/env bash
# Install the GNOME Shell extension for the current user. No sudo needed.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
uuid="claude-usage@local"
dest="$HOME/.local/share/gnome-shell/extensions/$uuid"

# Remove the old AppIndicator version (v0.1) if present.
if [ -f "$HOME/.config/systemd/user/claude-usage-indicator.service" ]; then
    systemctl --user disable --now claude-usage-indicator.service || true
    rm -f "$HOME/.config/systemd/user/claude-usage-indicator.service"
    rm -rf "$HOME/.local/share/claude-usage-indicator"
    systemctl --user daemon-reload
    echo "removed old AppIndicator service"
fi

mkdir -p "$dest"
install -m 644 "$here/extension/$uuid/"{metadata.json,extension.js,lib.js,stylesheet.css} "$dest/"

if gnome-extensions enable "$uuid" 2>/dev/null; then
    echo "enabled $uuid"
else
    # On Wayland the shell only discovers new extensions after re-login,
    # so add it to the enabled list now; it loads on next login.
    current="$(gsettings get org.gnome.shell enabled-extensions)"
    if [[ "$current" != *"'$uuid'"* ]]; then
        if [ "$current" = "@as []" ]; then new="['$uuid']"; else new="${current%]}, '$uuid']"; fi
        gsettings set org.gnome.shell enabled-extensions "$new"
    fi
    echo "installed $uuid — log out and back in to load it"
fi
