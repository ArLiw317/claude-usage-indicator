# Claude Usage for GNOME

A small GNOME Shell extension that shows how much of your Claude plan limits you have used, right in the top bar.

- **Top bar:** two concentric rings. The outer ring is the current 5-hour session, the inner ring is the 7-day (weekly) limit.
- **Dropdown:** a bar chart for each limit with the exact percentage, when it resets, and a countdown. A footer shows the last update time and a refresh button.

Colors: green below 70%, amber from 70%, red from 90%. Everything turns grey when the data is stale.

> **Unofficial.** This project is not affiliated with or endorsed by Anthropic. It reads an undocumented endpoint that Claude Code itself uses, which can change or disappear without notice.

## Requirements

- GNOME Shell **50** (tested on Ubuntu 26.04, Wayland). Other versions are not declared in `metadata.json` yet.
- [Claude Code](https://docs.claude.com/en/docs/claude-code) installed and logged in on the same machine with a Claude subscription (Pro or Max). The extension uses Claude Code's login and has no login of its own.

## Install

```sh
git clone https://github.com/ArLiw317/claude-usage-indicator.git
cd claude-usage-indicator
./install.sh
```

`install.sh` copies the extension to `~/.local/share/gnome-shell/extensions/claude-usage@local` and enables it. It needs no `sudo`.

GNOME Shell on Wayland only discovers a newly installed extension after you **log out and back in**.

Check that it loaded:

```sh
gnome-extensions info claude-usage@local   # State: ACTIVE
```

## Uninstall

```sh
./uninstall.sh
```

## How it works

Every 3 minutes the extension:

1. Reads the OAuth access token from Claude Code's `~/.claude/.credentials.json`.
2. Calls `GET https://api.anthropic.com/api/oauth/usage` with that token.
3. Draws the `five_hour` and `seven_day` utilization values.

If a request fails because of the network or the API, it backs off exponentially up to 30 minutes. **Refresh** in the dropdown fetches immediately.

### Token handling

The extension only **reads** the token:

- It never refreshes the token and never writes to the credentials file. Refreshing would rotate Claude Code's refresh token and could log Claude Code out, so this is left to Claude Code.
- The token is sent only to `api.anthropic.com`. It is never logged or stored anywhere else.

The downside: access tokens are short-lived (about an hour or two). If you haven't used Claude Code for a while, the token expires, the charts turn grey, and the dropdown says the data is stale. The last known values stay on screen. Running `claude` once refreshes the token, and the extension recovers on its next poll.

## Troubleshooting

| Symptom | What to check |
|---|---|
| No icon after install | Log out and back in. Then run `gnome-extensions info claude-usage@local`. |
| Grey charts, "ข้อมูลเก่า · เปิด claude เพื่อ refresh token" | The Claude Code token has expired. Run `claude` once. |
| "ดึงข้อมูลไม่ได้ (HTTP …)" | The usage endpoint returned an error. It retries with backoff. If it persists, the endpoint may have changed. |
| Anything else | `journalctl --user -b /usr/bin/gnome-shell \| grep -i claude` |

## Language

The dropdown text is currently in **Thai** (for example, `รีเฟรช` = Refresh, `อีก 1h 50m` = 1h 50m left). Pull requests adding gettext translations are welcome.

## Development

```
extension/claude-usage@local/
├── extension.js     # panel button, ring icon, bar chart menu, fetching (libsoup)
├── lib.js           # pure logic: credentials, parsing, colors, time formatting, backoff
├── metadata.json
└── stylesheet.css
tests/test_lib.js    # unit tests for lib.js
```

Run the tests with gjs (the expected times assume the Asia/Bangkok timezone):

```sh
TZ=Asia/Bangkok gjs -m tests/test_lib.js
```

To try changes without touching your session, run a throwaway headless shell:

```sh
dbus-run-session -- gnome-shell --headless --wayland --no-x11 --virtual-monitor 1280x800
```

Before you start it, point `XDG_DATA_HOME` and `XDG_CONFIG_HOME` at temporary directories and set `GSETTINGS_BACKEND=keyfile`.
