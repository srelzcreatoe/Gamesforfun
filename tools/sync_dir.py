#!/usr/bin/env python3
"""Mirror SRC into DST (like rsync -a --delete) copying only changed files. Usage: sync_dir.py SRC DST [--exclude rel/ ...]"""
import os, shutil, sys, stat
src, dst = sys.argv[1], sys.argv[2]
excl = [a for a in sys.argv[4:] if sys.argv[3:4] == ["--exclude"]] if len(sys.argv) > 3 else []
excl = [e.rstrip("/") for e in sys.argv[sys.argv.index("--exclude") + 1:]] if "--exclude" in sys.argv else []
def excluded(rel):
    return any(rel == e or rel.startswith(e + "/") for e in excl)
copied = removed = 0
for dp, dn, fn in os.walk(src):
    rel = os.path.relpath(dp, src)
    rel = "" if rel == "." else rel
    dn[:] = [d for d in dn if not excluded(os.path.join(rel, d) if rel else d)]
    os.makedirs(os.path.join(dst, rel), exist_ok=True)
    for f in fn:
        r = os.path.join(rel, f) if rel else f
        if excluded(r): continue
        s = os.path.join(dp, f); d = os.path.join(dst, r)
        try:
            ss = os.stat(s); ds = os.stat(d)
            if ss.st_size == ds.st_size and int(ss.st_mtime) <= int(ds.st_mtime): continue
        except FileNotFoundError:
            pass
        shutil.copy2(s, d); copied += 1
# delete extras
for dp, dn, fn in os.walk(dst, topdown=False):
    rel = os.path.relpath(dp, dst); rel = "" if rel == "." else rel
    if excluded(rel): continue
    for f in fn:
        r = os.path.join(rel, f) if rel else f
        if excluded(r): continue
        if not os.path.exists(os.path.join(src, r)):
            os.remove(os.path.join(dp, f)); removed += 1
    for d in dn:
        r = os.path.join(rel, d) if rel else d
        if excluded(r): continue
        p = os.path.join(dp, d)
        if not os.path.isdir(os.path.join(src, r)):
            shutil.rmtree(p, ignore_errors=True); removed += 1
print(f"synced {copied} files, removed {removed}", file=sys.stderr)
