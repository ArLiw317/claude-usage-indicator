#!/usr/bin/env python3
"""Compile a .po file to a GNU .mo file. Stdlib only, so install needs no gettext package.

Handles the subset used here: msgid/msgstr pairs with continuation lines,
no plurals or contexts. Fuzzy entries are skipped.
"""
import ast
import struct
import sys


def parse_po(text):
    entries, msgid, msgstr, cur, fuzzy = {}, None, None, None, False

    def flush():
        if msgid is not None and msgstr and not fuzzy:
            entries[msgid] = msgstr

    for raw in text.splitlines():
        line = raw.strip()
        if line.startswith("#,") and "fuzzy" in line:
            fuzzy = True
        elif line.startswith("msgid "):
            flush()
            msgid, msgstr, cur = ast.literal_eval(line[6:]), None, "id"
        elif line.startswith("msgstr "):
            msgstr, cur = ast.literal_eval(line[7:]), "str"
        elif line.startswith('"'):
            if cur == "id":
                msgid += ast.literal_eval(line)
            elif cur == "str":
                msgstr += ast.literal_eval(line)
        elif not line:
            flush()
            msgid = msgstr = cur = None
            fuzzy = False
    flush()
    return entries


def write_mo(entries, path):
    keys = sorted(entries)
    ids = [k.encode() for k in keys]
    strs = [entries[k].encode() for k in keys]
    n = len(keys)
    data_start = 28 + 16 * n  # header + two offset tables
    blob = b""
    id_offsets, str_offsets = [], []
    for table, items in ((id_offsets, ids), (str_offsets, strs)):
        for s in items:
            table.append((len(s), data_start + len(blob)))
            blob += s + b"\0"
    header = struct.pack("<7I", 0x950412DE, 0, n, 28, 28 + 8 * n, 0, 0)
    table = b"".join(struct.pack("<2I", *o) for o in id_offsets + str_offsets)
    with open(path, "wb") as f:
        f.write(header + table + blob)


if __name__ == "__main__":
    src, dst = sys.argv[1:3]
    write_mo(parse_po(open(src, encoding="utf-8").read()), dst)
