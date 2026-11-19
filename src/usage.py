"""Fetch and model Claude plan usage. No GTK imports here, so it stays testable.

The access token is only ever read from Claude Code's credentials file and sent
to the usage endpoint. It is never refreshed, logged, or written anywhere.
"""

from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

USAGE_URL = "https://api.anthropic.com/api/oauth/usage"
CREDENTIALS_PATH = Path(os.path.expanduser("~/.claude/.credentials.json"))
USER_AGENT = "claude-usage-indicator/0.1"

WARN_AT = 70.0
CRIT_AT = 90.0

COLOR_OK = "#4caf50"
COLOR_WARN = "#ffb300"
COLOR_CRIT = "#e53935"
COLOR_STALE = "#9e9e9e"
COLOR_TRACK = "#ffffff"


class TokenExpired(Exception):
    """Token is missing or expired. Claude Code must refresh it; we never do."""


class FetchError(Exception):
    """Network or API failure that is worth retrying later."""


@dataclass(frozen=True)
class Window:
    percent: float
    resets_at: datetime | None


@dataclass(frozen=True)
class Usage:
    session: Window
    week: Window
    fetched_at: datetime


def read_token(path: Path = CREDENTIALS_PATH, now: float | None = None) -> str:
    now = time.time() if now is None else now
    try:
        oauth = json.loads(path.read_text())["claudeAiOauth"]
        token = oauth["accessToken"]
    except (OSError, ValueError, KeyError, TypeError) as e:
        raise TokenExpired("credentials not readable") from e
    expires_at = oauth.get("expiresAt")
    # 30 s margin so we don't send a token that dies in flight.
    if isinstance(expires_at, (int, float)) and expires_at / 1000 < now + 30:
        raise TokenExpired("access token expired")
    return token


def _parse_time(value) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value)
    except (TypeError, ValueError):
        return None


def _window(data: dict, key: str) -> Window:
    raw = data.get(key) or {}
    pct = raw.get("utilization")
    if not isinstance(pct, (int, float)):
        raise FetchError(f"missing {key}.utilization")
    return Window(max(0.0, min(100.0, float(pct))), _parse_time(raw.get("resets_at")))


def parse_usage(data: dict, fetched_at: datetime | None = None) -> Usage:
    return Usage(
        session=_window(data, "five_hour"),
        week=_window(data, "seven_day"),
        fetched_at=fetched_at or datetime.now().astimezone(),
    )


def fetch_usage(token: str, timeout: float = 15) -> Usage:
    req = urllib.request.Request(
        USAGE_URL,
        headers={
            "Authorization": f"Bearer {token}",
            "anthropic-beta": "oauth-2025-04-20",
            "Content-Type": "application/json",
            "User-Agent": USER_AGENT,
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return parse_usage(json.load(resp))
    except urllib.error.HTTPError as e:
        if e.code in (401, 403):
            raise TokenExpired(f"HTTP {e.code}") from None
        raise FetchError(f"HTTP {e.code}") from None
    except (urllib.error.URLError, TimeoutError, ValueError) as e:
        raise FetchError(type(e).__name__) from None


def color_for(percent: float) -> str:
    if percent >= CRIT_AT:
        return COLOR_CRIT
    if percent >= WARN_AT:
        return COLOR_WARN
    return COLOR_OK


def _ring(cx: float, r: float, width: float, percent: float, color: str) -> str:
    circ = 2 * 3.141592653589793 * r
    filled = circ * percent / 100.0
    track = (
        f'<circle cx="{cx}" cy="{cx}" r="{r}" fill="none" stroke="{COLOR_TRACK}" '
        f'stroke-opacity="0.25" stroke-width="{width}"/>'
    )
    if filled <= 0:
        return track
    arc = (
        f'<circle cx="{cx}" cy="{cx}" r="{r}" fill="none" stroke="{color}" '
        f'stroke-width="{width}" stroke-linecap="round" '
        f'stroke-dasharray="{filled:.2f} {circ:.2f}" '
        f'transform="rotate(-90 {cx} {cx})"/>'
    )
    return track + arc


def render_icon_svg(session_pct: float, week_pct: float, stale: bool = False) -> str:
    """Two concentric rings: outer = current session, inner = this week."""
    c_session = COLOR_STALE if stale else color_for(session_pct)
    c_week = COLOR_STALE if stale else color_for(week_pct)
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">'
        + _ring(32, 27, 8, session_pct, c_session)
        + _ring(32, 14, 8, week_pct, c_week)
        + "</svg>"
    )


def format_reset(resets_at: datetime | None, now: datetime) -> str:
    if resets_at is None:
        return "reset ไม่ทราบเวลา"
    local = resets_at.astimezone(now.tzinfo)
    secs = int((local - now).total_seconds())
    if secs <= 0:
        return "reset แล้ว"
    h, m = divmod(secs // 60, 60)
    left = f"{h // 24}d {h % 24}h" if h >= 24 else f"{h}h {m:02d}m"
    when = local.strftime("%H:%M") if local.date() == now.date() else local.strftime("%a %H:%M")
    return f"reset {when} (อีก {left})"
