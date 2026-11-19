#!/usr/bin/env bash
set -euo pipefail
uuid="claude-usage@local"
gnome-extensions disable "$uuid" 2>/dev/null || true
rm -rf "$HOME/.local/share/gnome-shell/extensions/$uuid"
