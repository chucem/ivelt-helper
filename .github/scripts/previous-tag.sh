#!/usr/bin/env bash
# Prints the release tag before a version, by version number: the newest tag (v2.7.1,
# v2.8.0-beta.1...) that's lower than it, or nothing when there's none. "release" leaves out
# the test tags (with a dash). Used for the notes of a test version: dev never gets master's
# release commits, so `git describe` from dev skips every release tagged on master
# (v2.8.0-beta.1 would compare to v2.6.0 instead of v2.7.1).
#
#   previous-tag.sh <version> [release|test]     e.g. previous-tag.sh 2.8.0-beta.1 test

set -euo pipefail

version="${1#v}"
kind="${2:-test}"

git tag -l 'v*' | python3 -c '
import re, sys

version, kind = sys.argv[1], sys.argv[2]
pattern = re.compile(r"^(\d+(?:\.\d+)*)(?:-([0-9A-Za-z.]+))?$")

def key(v):
    m = pattern.match(v)
    numbers = tuple(int(n) for n in m.group(1).split("."))
    numbers += (0,) * (4 - len(numbers))
    pre = m.group(2)
    if not pre:
        return numbers, (1,)  # 2.8.0 comes after 2.8.0-beta.1
    parts = tuple((0, int(p), "") if p.isdigit() else (1, 0, p) for p in pre.split("."))
    return numbers, (0, parts)

if not pattern.match(version):
    sys.exit(0)
tags = [t[1:] for t in sys.stdin.read().split() if pattern.match(t[1:])]
if kind == "release":
    tags = [t for t in tags if "-" not in t]
lower = [t for t in tags if key(t) < key(version)]
if lower:
    print("v" + max(lower, key=key))
' "$version" "$kind"
