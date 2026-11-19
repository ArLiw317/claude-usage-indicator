#!/usr/bin/env bash
# Install for the current user. No sudo needed.
# Requires: python3-gi, gir1.2-ayatanaappindicator3-0.1, ubuntu-appindicators extension.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
dest="$HOME/.local/share/claude-usage-indicator"
unit_dir="$HOME/.config/systemd/user"

mkdir -p "$dest" "$unit_dir"
install -m 644 "$here/src/usage.py" "$dest/usage.py"
install -m 755 "$here/src/indicator.py" "$dest/indicator.py"
install -m 644 "$here/systemd/claude-usage-indicator.service" "$unit_dir/"

systemctl --user daemon-reload
systemctl --user enable claude-usage-indicator.service
systemctl --user restart claude-usage-indicator.service
systemctl --user --no-pager status claude-usage-indicator.service | head -5
