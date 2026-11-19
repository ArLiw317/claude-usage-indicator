import json
import sys
import tempfile
import unittest
import urllib.error
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
import usage  # noqa: E402

BKK = timezone(timedelta(hours=7))

SAMPLE = {
    "five_hour": {"utilization": 41.0, "resets_at": "2026-11-19T11:19:59.726206+00:00"},
    "seven_day": {"utilization": 93.5, "resets_at": "2026-11-21T12:59:59+00:00"},
    "limits": [],
}


def write_creds(obj) -> Path:
    f = tempfile.NamedTemporaryFile("w", suffix=".json", delete=False)
    json.dump(obj, f)
    f.close()
    return Path(f.name)


class ReadTokenTest(unittest.TestCase):
    def test_valid(self):
        p = write_creds({"claudeAiOauth": {"accessToken": "t", "expiresAt": 2_000_000_000_000}})
        self.assertEqual(usage.read_token(p, now=1_000_000_000), "t")

    def test_expired(self):
        p = write_creds({"claudeAiOauth": {"accessToken": "t", "expiresAt": 1_000_000_000_000}})
        with self.assertRaises(usage.TokenExpired):
            usage.read_token(p, now=1_000_000_000)

    def test_expiring_within_margin(self):
        p = write_creds({"claudeAiOauth": {"accessToken": "t", "expiresAt": 1_000_000_010_000}})
        with self.assertRaises(usage.TokenExpired):
            usage.read_token(p, now=1_000_000_000)

    def test_missing_file_and_bad_shape(self):
        with self.assertRaises(usage.TokenExpired):
            usage.read_token(Path("/nonexistent/creds.json"))
        with self.assertRaises(usage.TokenExpired):
            usage.read_token(write_creds({"other": 1}))

    def test_does_not_modify_file(self):
        p = write_creds({"claudeAiOauth": {"accessToken": "t", "expiresAt": 2_000_000_000_000}})
        before = p.read_bytes()
        usage.read_token(p, now=1_000_000_000)
        self.assertEqual(p.read_bytes(), before)


class ParseTest(unittest.TestCase):
    def test_parse(self):
        u = usage.parse_usage(SAMPLE)
        self.assertEqual(u.session.percent, 41.0)
        self.assertEqual(u.week.percent, 93.5)
        self.assertEqual(u.session.resets_at.tzinfo, timezone.utc)

    def test_clamps_and_missing_reset(self):
        u = usage.parse_usage({"five_hour": {"utilization": 130}, "seven_day": {"utilization": -2}})
        self.assertEqual((u.session.percent, u.week.percent), (100.0, 0.0))
        self.assertIsNone(u.session.resets_at)

    def test_missing_window_raises(self):
        with self.assertRaises(usage.FetchError):
            usage.parse_usage({"five_hour": None, "seven_day": {"utilization": 1}})


class FetchTest(unittest.TestCase):
    def _http_error(self, code):
        return urllib.error.HTTPError(usage.USAGE_URL, code, "x", {}, None)

    def test_401_is_token_problem(self):
        with mock.patch("urllib.request.urlopen", side_effect=self._http_error(401)):
            with self.assertRaises(usage.TokenExpired):
                usage.fetch_usage("t")

    def test_429_is_fetch_error(self):
        with mock.patch("urllib.request.urlopen", side_effect=self._http_error(429)):
            with self.assertRaises(usage.FetchError):
                usage.fetch_usage("t")

    def test_network_error(self):
        with mock.patch("urllib.request.urlopen", side_effect=urllib.error.URLError("down")):
            with self.assertRaises(usage.FetchError):
                usage.fetch_usage("t")

    def test_error_message_has_no_token(self):
        with mock.patch("urllib.request.urlopen", side_effect=self._http_error(500)):
            try:
                usage.fetch_usage("SECRET-TOKEN")
            except usage.FetchError as e:
                self.assertNotIn("SECRET", str(e))


class RenderTest(unittest.TestCase):
    def test_colors(self):
        self.assertEqual(usage.color_for(10), usage.COLOR_OK)
        self.assertEqual(usage.color_for(70), usage.COLOR_WARN)
        self.assertEqual(usage.color_for(90), usage.COLOR_CRIT)

    def test_svg(self):
        svg = usage.render_icon_svg(41, 93.5)
        self.assertTrue(svg.startswith("<svg"))
        self.assertIn(usage.COLOR_OK, svg)
        self.assertIn(usage.COLOR_CRIT, svg)

    def test_svg_stale_and_zero(self):
        svg = usage.render_icon_svg(50, 0, stale=True)
        self.assertIn(usage.COLOR_STALE, svg)
        self.assertNotIn(usage.COLOR_OK, svg)
        self.assertEqual(svg.count("stroke-dasharray"), 1)  # 0% draws only the track


class FormatResetTest(unittest.TestCase):
    now = datetime(2026, 11, 19, 16, 30, tzinfo=BKK)

    def test_same_day(self):
        r = datetime(2026, 11, 19, 11, 20, tzinfo=timezone.utc)  # 18:20 BKK
        self.assertEqual(usage.format_reset(r, self.now), "reset 18:20 (อีก 1h 50m)")

    def test_other_day(self):
        r = datetime(2026, 11, 21, 13, 0, tzinfo=timezone.utc)  # Sat 20:00 BKK
        self.assertEqual(usage.format_reset(r, self.now), "reset Sat 20:00 (อีก 2d 3h)")

    def test_past_and_unknown(self):
        self.assertEqual(usage.format_reset(self.now - timedelta(minutes=1), self.now), "reset แล้ว")
        self.assertEqual(usage.format_reset(None, self.now), "reset ไม่ทราบเวลา")


if __name__ == "__main__":
    unittest.main()
