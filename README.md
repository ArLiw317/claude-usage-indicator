# claude-usage-indicator

GNOME Shell extension (`claude-usage@local`, GNOME 50) that shows Claude plan usage.

- **Top bar:** two concentric rings. Outer = current 5-hour session, inner = this week.
- **Dropdown:** a bar chart for each window with percentage and reset time, last update time, and a refresh button.

Colors: green < 70%, amber ≥ 70%, red ≥ 90%, grey = stale data.

## How it works

Every 3 minutes the extension calls `https://api.anthropic.com/api/oauth/usage` (via libsoup)
with the access token from Claude Code's `~/.claude/.credentials.json`.

- **Read-only on the token.** It never refreshes or writes credentials, so it cannot break
  the Claude Code login. If the token has expired (Claude Code hasn't run for a while) the
  charts turn grey and keep the last values until Claude Code refreshes the token.
- The endpoint is internal to Claude Code and undocumented; it may change without notice.
- Network/API errors back off exponentially up to 30 minutes.

## Install / uninstall

```sh
./install.sh     # copies to ~/.local/share/gnome-shell/extensions and enables it
./uninstall.sh
```

On Wayland a newly installed extension loads after you log out and back in.
`install.sh` also removes the earlier AppIndicator version (v0.1) if it is installed.

Logs: `journalctl --user -b /usr/bin/gnome-shell | grep -i claude`

## Tests

Pure logic lives in `lib.js` and is tested with gjs:

```sh
TZ=Asia/Bangkok gjs -m tests/test_lib.js
```
