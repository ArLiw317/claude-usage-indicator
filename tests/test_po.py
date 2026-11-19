"""Checks po/*.po: compiles to a valid .mo, covers every string the code translates,
and keeps the same %s placeholders. Run: python3 -m unittest discover -s tests -p 'test_po.py'"""
import gettext
import re
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import po2mo  # noqa: E402

EXT = ROOT / "extension" / "claude-usage@local"
DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]


def source_strings():
    found = set(DAYS)
    for f in ("extension.js", "lib.js"):
        found |= set(re.findall(r"_\('((?:[^'\\]|\\.)*)'\)", (EXT / f).read_text()))
    return found


class PoTest(unittest.TestCase):
    def test_every_po(self):
        wanted = source_strings()
        self.assertGreater(len(wanted), 10)
        for po in sorted((ROOT / "po").glob("*.po")):
            with self.subTest(po=po.name):
                entries = po2mo.parse_po(po.read_text(encoding="utf-8"))
                self.assertEqual(wanted - set(entries), set(), "untranslated strings")
                self.assertEqual(set(entries) - wanted - {""}, set(), "unused strings")
                for msgid, msgstr in entries.items():
                    self.assertEqual(msgid.count("%s"), msgstr.count("%s"), msgid)
                with tempfile.NamedTemporaryFile(suffix=".mo") as mo:
                    po2mo.write_mo(entries, mo.name)
                    t = gettext.GNUTranslations(open(mo.name, "rb"))
                    for msgid, msgstr in entries.items():
                        if msgid:
                            self.assertEqual(t.gettext(msgid), msgstr)


if __name__ == "__main__":
    unittest.main()
