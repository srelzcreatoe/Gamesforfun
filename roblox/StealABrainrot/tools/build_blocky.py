#!/usr/bin/env python3
"""Builds the block-built brainrots designed in tools/blocky/designs_*.py.

    python3 tools/build_blocky.py                     # every design
    python3 tools/build_blocky.py GuestiGuacanini     # just these

Each design becomes the same model data tools/build_assets.py makes from the
Higgsfield models (ReplicatedStorage/Assets/Brainrots/<Id>.luau), plus a
preview at BrainrotModels/Blocky/<Id>.glb. Unlike the voxelised models, the
moving pieces are marked by hand, so block-built brainrots can swing their
arms, flap their wings, wag their tails and spin their propellers as well as
walk.

Requires: numpy, trimesh, zstandard (and build_assets' other imports).
Run from the StealABrainrot folder.
"""

import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_assets as B  # noqa: E402
from blocky import build_model, iter_ids, load_designs  # noqa: E402


def build(brainrot_id: str):
    entry = load_designs()[brainrot_id]
    model = build_model(entry)
    grid, part = model.flipped()
    width = grid.shape[0]
    dims = grid.shape
    if max(dims) > 255:
        raise ValueError(f"{brainrot_id}: grid too large")

    parts = []
    quad_count = 0
    body = np.where(part == 0, grid, 0)
    body_quads = B.greedy_quads(body)
    parts.append({"kind": "Body", "quads": body_quads})
    quad_count += len(body_quads)
    kinds = []
    for index, limb in enumerate(model.limbs, start=1):
        piece = np.where(part == index, grid, 0)
        if not (piece > 0).any():
            continue
        quads = B.greedy_quads(piece)
        px, py, pz = limb.pivot
        parts.append(
            {
                "kind": limb.kind,
                "quads": quads,
                # The grid is mirrored in x (see Model.flipped), so is the pivot.
                "pivot": (width - px, py, pz),
                "phase": limb.phase,
                "axis": limb.axis,
            }
        )
        kinds.append(limb.kind)
        quad_count += len(quads)

    palette = np.array(model.palette, dtype=np.int64)
    module = B.write_brainrot_module(brainrot_id, dims, palette, parts, f"tools/blocky/{entry.module.split('.')[-1]}.py")

    all_quads = [quad for p in parts for quad in p["quads"]]
    B.BLOCKY_DIR.mkdir(parents=True, exist_ok=True)
    B.write_blocky_glb(B.BLOCKY_DIR / f"{brainrot_id}.glb", all_quads, palette, dims)
    return dims, quad_count, kinds, module.stat().st_size


def main():
    total = 0
    for brainrot_id in iter_ids(sys.argv[1:]):
        dims, quad_count, kinds, size = build(brainrot_id)
        total += size
        summary = ", ".join(f"{kinds.count(k)} {k}" for k in dict.fromkeys(kinds)) or "no moving pieces"
        print(f"{brainrot_id:28s} {dims[0]:3d}x{dims[1]:3d}x{dims[2]:3d} {quad_count:5d} quads  {summary}  {size / 1024:6.1f} KB")
    print(f"Total: {total / 1024:.1f} KB")


if __name__ == "__main__":
    sys.exit(main())
