"""Packs every brainrot as a few hundred plain boxes, for devices that can't
build meshes.

    python3 tools/build_boxes.py            # every brainrot
    python3 tools/build_boxes.py TimCheese  # just these

A brainrot normally shows its imported model (BrainrotModels/Import), or else
the blocky meshes each player's game builds from
ReplicatedStorage/Assets/Brainrots/<Id>.luau with EditableMesh. When neither
is there (the model didn't import, and the device or an unpublished place
can't use EditableMesh), the game builds it from ordinary Parts instead: the
boxes written here to ReplicatedStorage/Assets/BrainrotBoxes/<Id>.luau.

The boxes come from the same blocks as the blocky meshes: every block with a
face in the packed quads, the hidden inside filled in, at the finest
resolution (every block, every 2nd, 3rd or 4th) that needs at most MAX_BOXES
boxes, with neighbouring blocks of one colour merged into one box. Each
moving piece (legs, arms, ...) keeps its own boxes, pivot and phase, so the
game animates them like the meshes.

tools/build_assets.py and tools/build_blocky.py call this for every model
they write, so the boxes always match.
"""

import base64
import re
import sys
from pathlib import Path

import numpy as np
import zstandard
from scipy import ndimage

ROOT = Path(__file__).resolve().parent.parent
MODULES_DIR = ROOT / "ReplicatedStorage" / "Assets" / "Brainrots"
BOXES_DIR = ROOT / "ReplicatedStorage" / "Assets" / "BrainrotBoxes"
BOXES_FORMAT = 1
MAX_BOXES = 450
STEPS = (1, 2, 3, 4)
QUAD_BYTES = 7
BOX_BYTES = 7
CHUNK = 8000

# Grid cells: 0 empty, -1 hidden inside (any colour will do), n = palette
# colour n - 1.
INSIDE = -1


def read_module(brainrot_id):
    """The packed model: (dims, palette text, parts), each part a dict with
    kind, pivot, phase, axis and its quads as an (n, 7) array."""
    text = (MODULES_DIR / f"{brainrot_id}.luau").read_text()
    dims = [int(value) for value in re.search(r"Dims = \{ (\d+), (\d+), (\d+) \}", text).groups()]
    palette = re.search(r"Palette = \{ (.*?) \}", text).group(1)
    body = text[text.index("Parts = {") :]
    starts = [match.start() for match in re.finditer(r'Kind = "', body)]
    parts = []
    for index, start in enumerate(starts):
        block = body[start : starts[index + 1] if index + 1 < len(starts) else len(body)]
        count = int(re.search(r"QuadCount = (\d+)", block).group(1))
        quads_text = block[block.index("Quads = ") :]
        quads_text = quads_text[: quads_text.index("})")] if "table.concat" in quads_text[:30] else quads_text[: quads_text.index("\n")]
        encoded = "".join(re.findall(r'"([A-Za-z0-9+/=]+)"', quads_text))
        raw = zstandard.ZstdDecompressor().decompress(base64.b64decode(encoded), max_output_size=count * QUAD_BYTES)
        pivot = re.search(r"Pivot = \{ ([-\d.]+), ([-\d.]+), ([-\d.]+) \}", block)
        phase = re.search(r"Phase = (\d+)", block)
        axis = re.search(r'Axis = "(\w)"', block)
        parts.append(
            {
                "kind": re.search(r'Kind = "(\w+)"', block).group(1),
                "pivot": [float(value) for value in pivot.groups()] if pivot else None,
                "phase": int(phase.group(1)) if phase else 0,
                "axis": axis.group(1) if axis else None,
                "quads": np.frombuffer(raw, dtype=np.uint8).reshape(-1, QUAD_BYTES),
            }
        )
    return dims, palette, parts


def solid_grid(dims, quads):
    """The blocks behind the quads, coloured, with the hidden inside filled."""
    grid = np.zeros(dims, dtype=np.int16)
    for axis_direction, plane, u0, v0, u_size, v_size, colour in quads:
        # (Same axes as tools/build_assets.py: u = axis + 1, v = axis + 2.)
        axis = axis_direction // 2
        index = [None, None, None]
        index[axis] = slice(plane, plane + 1)
        index[(axis + 1) % 3] = slice(u0, u0 + u_size)
        index[(axis + 2) % 3] = slice(v0, v0 + v_size)
        grid[tuple(index)] = colour + 1
    outside = grid == 0
    labels, _ = ndimage.label(outside)
    edge = np.unique(
        np.concatenate(
            [labels[0].ravel(), labels[-1].ravel(), labels[:, 0].ravel(), labels[:, -1].ravel(), labels[:, :, 0].ravel(), labels[:, :, -1].ravel()]
        )
    )
    grid[outside & ~np.isin(labels, edge)] = INSIDE
    return grid


def coarsen(grid, step):
    """Every `step` blocks become one: solid when enough of it is, in its
    most common visible colour."""
    if step == 1:
        return grid
    shape = [(size + step - 1) // step for size in grid.shape]
    out = np.zeros(shape, dtype=np.int16)
    for x in range(shape[0]):
        for y in range(shape[1]):
            for z in range(shape[2]):
                cell = grid[x * step : (x + 1) * step, y * step : (y + 1) * step, z * step : (z + 1) * step]
                visible = cell[cell > 0]
                filled = np.count_nonzero(cell)
                if visible.size > 0 and (visible.size * 4 >= cell.size or filled * 2 >= cell.size):
                    values, counts = np.unique(visible, return_counts=True)
                    out[x, y, z] = values[counts.argmax()]
                elif filled * 2 >= cell.size:
                    out[x, y, z] = INSIDE
    return out


def merge_boxes(grid):
    """Greedy boxes over the visible blocks: each grows along x, then z, then
    y through blocks of its colour (or hidden inside ones)."""
    size_x, size_y, size_z = grid.shape
    covered = np.zeros(grid.shape, dtype=bool)
    boxes = []

    def fits(colour, region):
        cells = grid[region]
        return bool(np.all(((cells == colour) | (cells == INSIDE)) & ~covered[region]))

    for y in range(size_y):
        for z in range(size_z):
            for x in range(size_x):
                colour = grid[x, y, z]
                if colour <= 0 or covered[x, y, z]:
                    continue
                x1 = x + 1
                while x1 < size_x and fits(colour, (slice(x1, x1 + 1), slice(y, y + 1), slice(z, z + 1))):
                    x1 += 1
                z1 = z + 1
                while z1 < size_z and fits(colour, (slice(x, x1), slice(y, y + 1), slice(z1, z1 + 1))):
                    z1 += 1
                y1 = y + 1
                while y1 < size_y and fits(colour, (slice(x, x1), slice(y1, y1 + 1), slice(z, z1))):
                    y1 += 1
                covered[x:x1, y:y1, z:z1] = True
                boxes.append((x, y, z, x1 - x, y1 - y, z1 - z, colour - 1))
    return boxes


def luau_string(data: bytes) -> str:
    # Plain Base64 (no compression): the game decodes it without any engine
    # API, so it works wherever Parts do.
    encoded = base64.b64encode(data).decode("ascii")
    chunks = [encoded[i : i + CHUNK] for i in range(0, len(encoded), CHUNK)]
    return "table.concat({\n" + "\n".join(f'\t\t"{chunk}",' for chunk in chunks) + "\n\t})"


def build_boxes(brainrot_id):
    """Writes ReplicatedStorage/Assets/BrainrotBoxes/<Id>.luau. Returns
    (step, box count)."""
    dims, palette, parts = read_module(brainrot_id)
    grids = [solid_grid(dims, part["quads"]) for part in parts]
    for step in STEPS:
        part_boxes = [merge_boxes(coarsen(grid, step)) for grid in grids]
        total = sum(len(boxes) for boxes in part_boxes)
        if total <= MAX_BOXES:
            break
    part_lines = []
    for part, boxes in zip(parts, part_boxes):
        fields = [f'Kind = "{part["kind"]}"']
        if part["pivot"] is not None:
            fields.append("Pivot = { %s }" % ", ".join(f"{value:.2f}" for value in part["pivot"]))
            fields.append(f"Phase = {part['phase']}")
        if part["axis"]:
            fields.append(f'Axis = "{part["axis"]}"')
        fields.append(f"BoxCount = {len(boxes)}")
        packed = b"".join(bytes(int(value) for value in box) for box in boxes)
        fields.append(f"Boxes = {luau_string(packed)}")
        part_lines.append("\t\t{\n" + "".join(f"\t\t\t{field},\n" for field in fields) + "\t\t},\n")
    BOXES_DIR.mkdir(parents=True, exist_ok=True)
    (BOXES_DIR / f"{brainrot_id}.luau").write_text(
        f"-- Generated by tools/build_boxes.py from ReplicatedStorage/Assets/Brainrots/{brainrot_id}.luau. Do not edit.\n"
        "return {\n"
        f"\tFormat = {BOXES_FORMAT},\n"
        "\t-- Blocks per box unit: 1 = every block of the model, 2 = every 2nd, ...\n"
        f"\tStep = {step},\n"
        f"\tDims = {{ {dims[0]}, {dims[1]}, {dims[2]} }},\n"
        f"\tPalette = {{ {palette} }},\n"
        "\t-- The body, then each moving piece (Pivot in blocks, like the meshes).\n"
        "\t-- Boxes are Base64, 7 bytes each: x, y, z, xSize, ySize, zSize\n"
        "\t-- (in box units) and palette colour.\n"
        "\tParts = {\n" + "".join(part_lines) + "\t},\n"
        "}\n"
    )
    return step, total


def main():
    wanted = sys.argv[1:]
    ids = sorted(path.stem for path in MODULES_DIR.glob("*.luau"))
    for brainrot_id in ids:
        if wanted and brainrot_id not in wanted:
            continue
        step, total = build_boxes(brainrot_id)
        print(f"{brainrot_id:24s} step {step}  {total:4d} boxes", flush=True)


if __name__ == "__main__":
    main()
