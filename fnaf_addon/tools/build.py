#!/usr/bin/env python3
"""Builds the Minecraft-style FNAF models for Blockbench (Bedrock entity format).

    python3 fnaf_addon/tools/build.py                 # every character
    python3 fnaf_addon/tools/build.py freddy bonnie   # just these

Each character is written to fnaf_addon/<name>/ (see fnafkit/export.py for the file list).
"""
import argparse
import dataclasses
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from characters import bonnie, cast, freddy, trio  # noqa: E402
from fnafkit import export  # noqa: E402

CHARACTERS = {
    "bonnie": bonnie.SPEC,
    "freddy": freddy.spec("classic"),
    "withered_freddy": freddy.spec("withered"),
    "party_cat": trio.spec("party_cat"),
    "rat": trio.spec("rat"),
    **{name: cast.spec(name) for name in cast.BUILDERS},
}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("names", nargs="*", choices=[[]] + list(CHARACTERS), help="characters to build (default: all)")
    ap.add_argument("--out", help="write into this folder instead of fnaf_addon/<name>/ (one character only)")
    args = ap.parse_args()
    names = args.names or list(CHARACTERS)
    if args.out and len(names) != 1:
        ap.error("--out needs exactly one character")
    for name in names:
        ch = CHARACTERS[name]
        if args.out:
            ch = dataclasses.replace(ch, out_dir=args.out)
        export.build(ch)


if __name__ == "__main__":
    main()
