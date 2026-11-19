#!/usr/bin/env python3
"""Top-bar indicator for Claude plan usage (Ubuntu / AppIndicator)."""

from __future__ import annotations

import os
import signal
import sys
import tempfile
import threading
from datetime import datetime
from pathlib import Path

import gi

gi.require_version("Gtk", "3.0")
gi.require_version("AyatanaAppIndicator3", "0.1")
from gi.repository import AyatanaAppIndicator3 as AppIndicator  # noqa: E402
from gi.repository import GLib, Gtk  # noqa: E402

sys.path.insert(0, str(Path(__file__).resolve().parent))
import usage  # noqa: E402

POLL_SECONDS = int(os.environ.get("CUI_POLL_SECONDS", "180"))
BACKOFF_MAX = 1800
APP_ID = "claude-usage-indicator"


class UsageIndicator:
    def __init__(self) -> None:
        runtime = os.environ.get("XDG_RUNTIME_DIR") or tempfile.gettempdir()
        self.icon_dir = Path(runtime) / APP_ID
        self.icon_dir.mkdir(mode=0o700, exist_ok=True)
        self.icon_flip = False

        self.last: usage.Usage | None = None
        self.status = "กำลังโหลด…"
        self.stale = True
        self.failures = 0
        self.fetching = False
        self.timer_id = 0

        self.ind = AppIndicator.Indicator.new(
            APP_ID, "", AppIndicator.IndicatorCategory.APPLICATION_STATUS
        )
        self.ind.set_status(AppIndicator.IndicatorStatus.ACTIVE)
        self.ind.set_title("Claude usage")
        self._build_menu()
        self._render()
        self.refresh()

    def _build_menu(self) -> None:
        menu = Gtk.Menu()
        self.item_session = Gtk.MenuItem(label="Session: –")
        self.item_week = Gtk.MenuItem(label="Week: –")
        self.item_status = Gtk.MenuItem(label="")
        for item in (self.item_session, self.item_week, self.item_status):
            item.set_sensitive(False)
            menu.append(item)
        menu.append(Gtk.SeparatorMenuItem())
        refresh = Gtk.MenuItem(label="รีเฟรชตอนนี้")
        refresh.connect("activate", lambda *_: self.refresh())
        menu.append(refresh)
        quit_item = Gtk.MenuItem(label="ปิด")
        quit_item.connect("activate", lambda *_: Gtk.main_quit())
        menu.append(quit_item)
        menu.show_all()
        self.ind.set_menu(menu)

    def refresh(self) -> bool:
        if self.timer_id:
            GLib.source_remove(self.timer_id)
            self.timer_id = 0
        if not self.fetching:
            self.fetching = True
            threading.Thread(target=self._fetch, daemon=True).start()
        return False

    def _fetch(self) -> None:
        try:
            result = usage.fetch_usage(usage.read_token())
            GLib.idle_add(self._on_result, result, None, False)
        except usage.TokenExpired:
            GLib.idle_add(self._on_result, None, "token หมดอายุ เปิด claude เพื่อ refresh", True)
        except usage.FetchError as e:
            GLib.idle_add(self._on_result, None, f"ดึงข้อมูลไม่ได้ ({e})", False)
        except Exception as e:  # never let the worker die silently
            GLib.idle_add(self._on_result, None, f"error: {type(e).__name__}", False)

    def _on_result(self, result, error, token_problem) -> bool:
        self.fetching = False
        if result is not None:
            self.last, self.stale, self.failures = result, False, 0
            self.status = f"อัปเดต {result.fetched_at.strftime('%H:%M')}"
            delay = POLL_SECONDS
        else:
            self.stale = True
            self.failures += 1
            since = f" · ค่าล่าสุด {self.last.fetched_at.strftime('%H:%M')}" if self.last else ""
            self.status = f"{error}{since}"
            # Token problems recover when Claude Code refreshes the file, so keep
            # the normal cadence; network/API errors back off.
            delay = POLL_SECONDS if token_problem else min(POLL_SECONDS * 2 ** self.failures, BACKOFF_MAX)
        self._render()
        self.timer_id = GLib.timeout_add_seconds(delay, self.refresh)
        return False

    def _render(self) -> None:
        now = datetime.now().astimezone()
        s = self.last.session.percent if self.last else 0.0
        w = self.last.week.percent if self.last else 0.0

        self.icon_flip = not self.icon_flip  # new filename forces the shell to reload
        name = f"usage-{'a' if self.icon_flip else 'b'}"
        (self.icon_dir / f"{name}.svg").write_text(usage.render_icon_svg(s, w, self.stale))
        self.ind.set_icon_theme_path(str(self.icon_dir))
        self.ind.set_icon_full(name, f"Claude session {s:.0f}%, week {w:.0f}%")

        if self.last:
            self.item_session.set_label(
                f"Session {s:.0f}% · {usage.format_reset(self.last.session.resets_at, now)}"
            )
            self.item_week.set_label(
                f"Week {w:.0f}% · {usage.format_reset(self.last.week.resets_at, now)}"
            )
        self.item_status.set_label(self.status)


def main() -> None:
    signal.signal(signal.SIGINT, signal.SIG_DFL)
    signal.signal(signal.SIGTERM, signal.SIG_DFL)
    UsageIndicator()
    Gtk.main()


if __name__ == "__main__":
    main()
