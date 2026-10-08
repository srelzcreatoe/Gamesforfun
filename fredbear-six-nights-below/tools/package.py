#!/usr/bin/env python3
"""Package the two packs for import into Minecraft Bedrock.

Writes (deterministic: sorted entries, fixed timestamps):
  dist/FredbearBP.mcpack                  behavior pack (manifest at the archive root)
  dist/FredbearRP.mcpack                  resource pack
  dist/Fredbear_Six_Nights_Below.mcaddon  both packs, one folder each
  dist/SHA256SUMS.txt

These are ordinary add-on archives that Minecraft imports by opening the file.
No .mcworld is produced: the map is built inside the player's own world by the
behavior pack (/fb:setup), see docs/08_INSTALL_AND_PLAY.md.
"""
import hashlib
import pathlib
import zipfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
DIST = ROOT / "dist"
PACKS = {"FredbearBP": ROOT / "packs" / "FredbearBP", "FredbearRP": ROOT / "packs" / "FredbearRP"}
STAMP = (2026, 9, 15, 0, 0, 0)  # bedrock-samples v1.26.50.4 release date; keeps archives reproducible
SKIP = {".DS_Store", "Thumbs.db"}


def files_of(pack_dir):
    return sorted(p for p in pack_dir.rglob("*") if p.is_file() and p.name not in SKIP and "__pycache__" not in p.parts)


def add(zf, path, arcname):
    info = zipfile.ZipInfo(arcname, date_time=STAMP)
    info.compress_type = zipfile.ZIP_DEFLATED
    info.external_attr = 0o644 << 16
    zf.writestr(info, path.read_bytes())


def main():
    DIST.mkdir(exist_ok=True)
    outputs = []
    for name, d in PACKS.items():
        out = DIST / f"{name}.mcpack"
        with zipfile.ZipFile(out, "w") as zf:
            for f in files_of(d):
                add(zf, f, f.relative_to(d).as_posix())
        outputs.append(out)
    addon = DIST / "Fredbear_Six_Nights_Below.mcaddon"
    with zipfile.ZipFile(addon, "w") as zf:
        for name, d in PACKS.items():
            for f in files_of(d):
                add(zf, f, f"{name}/{f.relative_to(d).as_posix()}")
    outputs.append(addon)
    sums = []
    for o in outputs:
        h = hashlib.sha256(o.read_bytes()).hexdigest()
        sums.append(f"{h}  {o.name}")
        with zipfile.ZipFile(o) as zf:
            bad = zf.testzip()
            if bad:
                raise SystemExit(f"{o.name}: corrupt entry {bad}")
            names = zf.namelist()
        print(f"{o.name}: {len(names)} files, {o.stat().st_size // 1024} KiB")
    (DIST / "SHA256SUMS.txt").write_text("\n".join(sums) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
