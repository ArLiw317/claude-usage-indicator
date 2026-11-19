# claude-usage-indicator

Ubuntu top-bar indicator showing Claude plan usage as two concentric rings:

- **outer ring** — current 5-hour session
- **inner ring** — this week (7-day)

Colors: green < 70%, amber ≥ 70%, red ≥ 90%, grey = data is stale.
Click the icon for exact percentages, reset times, and a manual refresh.

## How it works

Every 3 minutes (`CUI_POLL_SECONDS`) it calls `https://api.anthropic.com/api/oauth/usage`
with the access token from Claude Code's `~/.claude/.credentials.json`.

- **Read-only on the token.** It never refreshes or writes credentials, so it cannot
  break the Claude Code login. If the token has expired (Claude Code hasn't run for a
  while) the icon turns grey and keeps the last known values until Claude Code
  refreshes the token.
- The endpoint is internal to Claude Code and undocumented; it may change without notice.
- Network/API errors back off exponentially up to 30 minutes.

## Requirements

- Ubuntu with the `ubuntu-appindicators@ubuntu.com` GNOME extension enabled
- `python3-gi`, `gir1.2-ayatanaappindicator3-0.1`
- Claude Code logged in on the same machine

## Install / uninstall

```sh
./install.sh     # copies to ~/.local/share, enables a systemd --user service
./uninstall.sh
```

Logs: `journalctl --user -u claude-usage-indicator -f`

## Tests

```sh
python3 -m unittest discover -s tests -v
```
