"""Works out where each brainrot's hat goes: on top of its head.

    python3 tools/build_hat_anchors.py            # writes HatAnchors.luau
    python3 tools/build_hat_anchors.py --json out  # also dumps what it found

Hats used to sit on the middle of the top of a brainrot's bounding box, which
is empty air for a shark with a fin, a ballerina with her arms up or a plane,
and too big for anything wide. This finds the top of the head from the
brainrot's blocks (ReplicatedStorage/Assets/Brainrots/<Id>.luau, the same
blocks the game and the imported models are made from):

1. Only the body and head count (not legs, arms, wings, tails, props, ears or
   skateboards). A brainrot with a moving Head piece gets its hat on that.
2. The top surface is a height map. The hat goes on the highest place that is
   broad enough to hold one: a spot counts only if most of the ground around
   it is nearly as high, so thin things sticking up (fins, hands, horns, bats,
   antennae) can't hold the hat.
3. The hat sits in the middle of that top, as wide as the head just below it.

It writes ReplicatedStorage/Shared/HatAnchors.luau: for each brainrot, the
piece the hat rides on, where on that piece (as fractions of its size, from
its centre) and how wide the hat is (as a fraction of the brainrot's height).
OVERRIDES below fix the few that need a hand.
"""

import json
import sys
from pathlib import Path

import numpy as np
from scipy import ndimage

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_boxes import MODULES_DIR, read_module, solid_grid  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "ReplicatedStorage" / "Shared" / "HatAnchors.luau"
# The pieces a hat can rest on.
HEAD_KINDS = ("Body", "Head")
# Around a spot, this share of the ground (within SUPPORT_RADIUS of the
# brainrot's height) must be within SUPPORT_DROP of its height for it to hold
# a hat.
SUPPORT_RADIUS = 0.07
SUPPORT_DROP = 0.08
SUPPORT_SHARE = 0.55
# ... and for long brainrots (planes, lying animals) at least this share of
# their length, so a pole or a tail fin can't hold one.
SUPPORT_RADIUS_LENGTH = 0.035
# Heads are usually in the middle (side to side) and at the front (-Z) of a
# long brainrot: a spot loses this much height (fractions of the height) per
# unit it is off to the side or back from the front.
SIDE_PENALTY = 0.5
BACK_PENALTY = 0.25
# The head's width is measured at these depths below the top (fractions of
# the height), and the middle one taken.
WIDTH_DEPTHS = (0.04, 0.08, 0.12, 0.16, 0.2)
# Hat width: this much of the head's width as seen from the front (but not
# much more than it is deep), kept between these fractions of the height.
WIDTH_SHARE = 0.9
DEPTH_ALLOWANCE = 1.3
WIDTH_MIN, WIDTH_MAX = 0.22, 0.45

# Hand-picked spots for brainrots whose head isn't their highest broad place:
# "at" is (x, y, z) as fractions of the whole model from its bottom-centre (x
# and z from -0.5 to 0.5, y from 0 to 1); "on" is just (x, z), and the hat
# goes on whatever is on top there. Either can come with a "width".
OVERRIDES: dict[str, dict] = {
    # A burrito standing up: its head is the folded tip, too pointed to count.
    "BurritoHotspotito": {"at": (0.0, 0.93, 0.0)},
    # The ears are thin plates and the coconut is hollow: on the elephant's head.
    "CocofantoElefanto": {"on": (0.0, -0.19)},
    # On the bread, just behind the toothpick through the front.
    "AeroplaninoPaninino": {"at": (0.0, 0.625, 0.05)},
}


def load(brainrot_id):
    dims, _, parts = read_module(brainrot_id)
    grids = [solid_grid(dims, part["quads"]) != 0 for part in parts]
    return dims, parts, grids


def bounds(grid):
    """(low, high) block corners of the filled blocks."""
    filled = np.argwhere(grid)
    return filled.min(axis=0).astype(float), filled.max(axis=0).astype(float) + 1


def find_anchor(brainrot_id):
    dims, parts, grids = load(brainrot_id)
    everything = np.logical_or.reduce(grids)
    model_low, model_high = bounds(everything)
    model_height = model_high[1] - model_low[1]

    kinds = [part["kind"] for part in parts]
    target = kinds.index("Head") if "Head" in kinds else 0
    if "Head" in kinds:
        solid = grids[target]
    else:
        solid = np.logical_or.reduce([grid for grid, kind in zip(grids, kinds) if kind in HEAD_KINDS])

    # Height map: the top of each column (NaN where there is nothing).
    size_x, size_y, size_z = solid.shape
    any_column = solid.any(axis=1)
    top_index = size_y - 1 - np.argmax(solid[:, ::-1, :], axis=1)
    height = np.where(any_column, top_index + 1, np.nan).astype(float)

    length = max(model_high[0] - model_low[0], model_high[2] - model_low[2])
    radius = max(1.5, SUPPORT_RADIUS * model_height, SUPPORT_RADIUS_LENGTH * length)
    middle_x = (model_low[0] + model_high[0]) / 2
    front_z = model_low[2]
    drop = SUPPORT_DROP * model_height
    r = int(np.ceil(radius))
    offsets = [(dx, dz) for dx in range(-r, r + 1) for dz in range(-r, r + 1) if dx * dx + dz * dz <= radius * radius]
    best = None
    for x in range(size_x):
        for z in range(size_z):
            here = height[x, z]
            if np.isnan(here):
                continue
            held = 0
            for dx, dz in offsets:
                nx, nz = x + dx, z + dz
                if 0 <= nx < size_x and 0 <= nz < size_z and height[nx, nz] >= here - drop:
                    held += 1
            share = held / len(offsets)
            if share < SUPPORT_SHARE:
                continue
            side = abs(x + 0.5 - middle_x) / model_height
            back = (z + 0.5 - front_z) / model_height
            score = (here / model_height - SIDE_PENALTY * side - BACK_PENALTY * back, share)
            if best is None or score > best[0]:
                best = (score, x, z)
    if best is None:
        # Nothing broad at all: the highest column.
        x, z = np.unravel_index(np.nanargmax(height), height.shape)
        best = ((height[x, z], 0), x, z)
    _, bx, bz = best
    top = height[bx, bz]

    # The top of the head: the columns around that spot nearly as high.
    plateau = np.nan_to_num(height, nan=-1) >= top - drop
    labels, _ = ndimage.label(plateau)
    region = labels == labels[bx, bz]
    xs, zs = np.nonzero(region)
    centre_x, centre_z = xs.mean() + 0.5, zs.mean() + 0.5

    # How wide the head is below the top, around that spot: its slice at a
    # few depths (the middle one, so an arm or a bat at one level can't count).
    cx, cz = int(min(size_x - 1, centre_x)), int(min(size_z - 1, centre_z))
    widths, depths = [], []
    for depth in WIDTH_DEPTHS:
        level = int(max(0, min(size_y - 1, top - 1 - depth * model_height)))
        slice_ = solid[:, level, :]
        slice_labels, _ = ndimage.label(slice_)
        label = slice_labels[cx, cz]
        if label == 0:
            # (Between blocks: the nearest part of the slice.)
            filled = np.argwhere(slice_)
            if len(filled):
                nearest = filled[np.argmin(((filled - [cx, cz]) ** 2).sum(axis=1))]
                label = slice_labels[nearest[0], nearest[1]]
        if label:
            sx, sz = np.nonzero(slice_labels == label)
            widths.append(sx.max() - sx.min() + 1)
            depths.append(sz.max() - sz.min() + 1)
    if widths:
        head_width = min(float(np.median(widths)), DEPTH_ALLOWANCE * float(np.median(depths)))
    else:
        head_width = 2 * radius
    width = float(np.clip(WIDTH_SHARE * head_width / model_height, WIDTH_MIN, WIDTH_MAX))

    # The hat sits on the head's top under it (not on a spike poking up).
    near = [
        height[x, z]
        for x in range(size_x)
        for z in range(size_z)
        if not np.isnan(height[x, z]) and (x + 0.5 - centre_x) ** 2 + (z + 0.5 - centre_z) ** 2 <= (0.3 * width * model_height) ** 2
    ]
    base = float(np.percentile(near, 75)) if near else float(top)

    point = np.array([centre_x, base, centre_z])
    override = OVERRIDES.get(brainrot_id)
    if override and "on" in override:
        fx, fz = override["on"]
        x = int((model_low[0] + model_high[0]) / 2 + fx * (model_high[0] - model_low[0]))
        z = int((model_low[2] + model_high[2]) / 2 + fz * (model_high[2] - model_low[2]))
        around = height[max(0, x - 1) : x + 2, max(0, z - 1) : z + 2]
        override = {**override, "at": (fx, (np.nanmax(around) - model_low[1]) / model_height, fz)}
    if override:
        fx, fy, fz = override["at"]
        point = np.array(
            [
                (model_low[0] + model_high[0]) / 2 + fx * (model_high[0] - model_low[0]),
                model_low[1] + fy * model_height,
                (model_low[2] + model_high[2]) / 2 + fz * (model_high[2] - model_low[2]),
            ]
        )
        width = override.get("width", width)

    low, high = bounds(grids[target])
    centre = (low + high) / 2
    size = high - low
    fraction = (point - centre) / size
    return {
        "Piece": "Head" if kinds[target] == "Head" else "Body",
        "X": round(float(fraction[0]), 3),
        "Y": round(float(fraction[1]), 3),
        "Z": round(float(fraction[2]), 3),
        "Width": round(width, 3),
        # For previews: the spot in the whole model (bottom-centre origin,
        # fractions of the height).
        "model": [
            float((point[0] - (model_low[0] + model_high[0]) / 2) / model_height),
            float((point[1] - model_low[1]) / model_height),
            float((point[2] - (model_low[2] + model_high[2]) / 2) / model_height),
        ],
    }


def main():
    ids = sorted(path.stem for path in MODULES_DIR.glob("*.luau"))
    anchors = {}
    for brainrot_id in ids:
        anchors[brainrot_id] = find_anchor(brainrot_id)
    lines = [
        "--!strict",
        "-- Generated by tools/build_hat_anchors.py. Do not edit.",
        "-- Where each brainrot's hat goes: on its Body or Head piece, at X/Y/Z",
        "-- fractions of that piece's size from its centre (Y is the hat's base),",
        "-- Width a fraction of the brainrot's height.",
        "",
        "export type Anchor = { Piece: string, X: number, Y: number, Z: number, Width: number }",
        "",
        "local HatAnchors: { [string]: Anchor } = {",
    ]
    for brainrot_id, anchor in anchors.items():
        lines.append(
            f'\t{brainrot_id} = {{ Piece = "{anchor["Piece"]}", X = {anchor["X"]}, Y = {anchor["Y"]}, Z = {anchor["Z"]}, Width = {anchor["Width"]} }},'
        )
    lines += ["}", "", "return table.freeze(HatAnchors)", ""]
    OUT.write_text("\n".join(lines))
    print(f"Wrote {OUT} ({len(anchors)} brainrots)")
    if "--json" in sys.argv:
        path = Path(sys.argv[sys.argv.index("--json") + 1])
        path.write_text(json.dumps(anchors, indent=1))
        print(f"Wrote {path}")


if __name__ == "__main__":
    main()
