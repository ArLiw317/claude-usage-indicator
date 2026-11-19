#!/usr/bin/env bash
set -euo pipefail
systemctl --user disable --now claude-usage-indicator.service 2>/dev/null || true
rm -f "$HOME/.config/systemd/user/claude-usage-indicator.service"
rm -rf "$HOME/.local/share/claude-usage-indicator"
systemctl --user daemon-reload
