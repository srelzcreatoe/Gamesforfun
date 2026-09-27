#!/usr/bin/env python3
"""Turn the Higgsfield brainrot models and the icons into Luau data modules.

Roblox can't load a .glb or .png from a place file without uploading it to an
account first. Instead, this script stores each model and icon as compressed
data inside a ModuleScript; the client rebuilds them at runtime with
EditableMesh and EditableImage (see ReplicatedStorage/Shared/AssetLoader.luau).

Brainrots are rebuilt as blocky voxel models, like the original game: each
smooth model is voxelised (48 blocks tall), every block takes the average
texture colour under it, the colours are reduced to a 40-colour palette, and
touching faces of the same colour are merged into larger quads.

So the brainrots can really walk, each model is split into a body and its
legs: the separate blocks touching the ground, up to the height where they
join the body. Every leg becomes its own mesh with a hip pivot and a step
phase, and the client swings them while the brainrot walks.

Inputs (paths relative to the StealABrainrot folder):
  BrainrotModels/source/<Id>.glb  raw Higgsfield models (optional, not committed)
  BrainrotModels/<Id>.glb         smooth models, used when there is no raw one
  ProductIcons/<Key>.png          developer product icons
  UIIcons/<Name>.png              HUD button icons

Outputs:
  BrainrotModels/<Id>.glb                          smooth model: simplified, textured,
                                                   facing Roblox's front (-Z), height 1
  BrainrotModels/Blocky/<Id>.glb                   blocky model with vertex colours
  ReplicatedStorage/Assets/Brainrots/<Id>.luau     blocky model data
  ReplicatedStorage/Assets/ProductIcons/<Key>.luau icon pixels
  ReplicatedStorage/Assets/UIIcons/<Name>.luau     icon pixels

Requires: numpy, scipy, pillow, trimesh, pymeshlab, zstandard.
Run from the StealABrainrot folder:  python3 tools/build_assets.py
"""

import base64
import colorsys
import sys
import tempfile
from pathlib import Path

import numpy as np
import pymeshlab
import trimesh
import zstandard
from PIL import Image
from scipy import ndimage
from scipy.spatial import cKDTree

ROOT = Path(__file__).resolve().parent.parent
MODELS_DIR = ROOT / "BrainrotModels"
SOURCE_DIR = MODELS_DIR / "source"
BLOCKY_DIR = MODELS_DIR / "Blocky"
ASSETS_DIR = ROOT / "ReplicatedStorage" / "Assets"
ICON_FOLDERS = {"ProductIcons": ROOT / "ProductIcons", "UIIcons": ROOT / "UIIcons"}

TARGET_TRIANGLES = 6000
GLB_TEXTURE_SIZE = 512
VOXELS_TALL = 40
PALETTE_SIZE = 32
COLOUR_SAMPLES = 400000
ICON_SIZE = 128
CHUNK = 8000  # characters per string literal
MESH_FORMAT = 3
# Legs: separate block groups touching the ground, at most this far up the model.
MAX_HIP_FRACTION = 0.55
MIN_LEG_BLOCKS = 6
ICON_FORMAT = 1


def compress(data: bytes) -> str:
    return base64.b64encode(zstandard.ZstdCompressor(level=19).compress(data)).decode("ascii")


def luau_string(encoded: str) -> str:
    chunks = [encoded[i : i + CHUNK] for i in range(0, len(encoded), CHUNK)]
    lines = "\n".join(f'\t\t"{chunk}",' for chunk in chunks)
    return "table.concat({\n" + lines + "\n\t})"


# ---------------------------------------------------------------------------
# Smooth model: simplify the raw Higgsfield output and face Roblox's front
# ---------------------------------------------------------------------------


def load_glb(path: Path):
    """Returns the mesh (trimesh UVs: bottom-left origin) and its RGB texture."""
    scene = trimesh.load(path, force="scene")
    mesh = trimesh.util.concatenate(scene.dump())
    visual = mesh.visual
    if not isinstance(visual, trimesh.visual.TextureVisuals) or visual.uv is None:
        raise ValueError(f"{path.name} has no texture coordinates")
    material = visual.material
    image = getattr(material, "baseColorTexture", None) or getattr(material, "image", None)
    if image is None:
        raise ValueError(f"{path.name} has no base colour texture")
    return mesh, image.convert("RGB")


def simplify(mesh):
    """Merges seam-split vertices, then simplifies while keeping per-corner UVs."""
    positions = np.asarray(mesh.vertices, dtype=np.float64)
    faces = np.asarray(mesh.faces, dtype=np.int64)
    uvs = np.asarray(mesh.visual.uv, dtype=np.float64)
    unique, inverse = np.unique(np.round(positions, 6), axis=0, return_inverse=True)
    face_positions = inverse.reshape(-1)[faces]
    wedge_uvs = uvs[faces]

    with tempfile.TemporaryDirectory() as tmp:
        obj = Path(tmp) / "mesh.obj"
        with obj.open("w") as out:
            for x, y, z in unique:
                out.write(f"v {x:.7f} {y:.7f} {z:.7f}\n")
            for u, v in wedge_uvs.reshape(-1, 2):
                out.write(f"vt {u:.7f} {v:.7f}\n")
            for index, (a, b, c) in enumerate(face_positions):
                t = index * 3
                out.write(f"f {a + 1}/{t + 1} {b + 1}/{t + 2} {c + 1}/{t + 3}\n")
        meshset = pymeshlab.MeshSet()
        meshset.load_new_mesh(str(obj))
        if meshset.current_mesh().face_number() > TARGET_TRIANGLES:
            meshset.meshing_decimation_quadric_edge_collapse_with_texture(
                targetfacenum=TARGET_TRIANGLES,
                qualitythr=0.4,
                extratcoordw=1.0,
                preserveboundary=True,
                boundaryweight=1.0,
                optimalplacement=True,
                preservenormal=True,
                planarquadric=True,
            )
        meshset.meshing_remove_null_faces()
        meshset.meshing_remove_duplicate_faces()
        meshset.meshing_remove_unreferenced_vertices()
        result = meshset.current_mesh()
        return (
            np.asarray(result.vertex_matrix(), dtype=np.float64),
            np.asarray(result.face_matrix(), dtype=np.int64),
            np.asarray(result.wedge_tex_coord_matrix(), dtype=np.float64).reshape(-1, 3, 2),
        )


def write_smooth_glb(path: Path, positions, faces, wedge_uvs, texture):
    """Turns the model to face -Z, scales it to height 1 and writes it with split UV seams."""
    turned = positions * np.array([-1.0, 1.0, -1.0])
    low, high = turned.min(axis=0), turned.max(axis=0)
    normalised = (turned - (low + high) / 2) / (high[1] - low[1])
    corner_positions = normalised[faces].reshape(-1, 3)
    corner_uvs = wedge_uvs.reshape(-1, 2)
    keys = np.concatenate([np.round(corner_positions, 6), np.round(corner_uvs, 6)], axis=1)
    _, first, inverse = np.unique(keys, axis=0, return_index=True, return_inverse=True)
    material = trimesh.visual.material.PBRMaterial(
        baseColorTexture=texture.resize((GLB_TEXTURE_SIZE, GLB_TEXTURE_SIZE), Image.LANCZOS),
        metallicFactor=0.0,
        roughnessFactor=0.8,
    )
    mesh = trimesh.Trimesh(
        vertices=corner_positions[first],
        faces=inverse.reshape(-1, 3),
        visual=trimesh.visual.TextureVisuals(uv=corner_uvs[first], material=material),
        process=False,
    )
    path.write_bytes(trimesh.Scene(mesh).export(file_type="glb"))


# ---------------------------------------------------------------------------
# Blocky model
# ---------------------------------------------------------------------------


def voxelise(mesh, texture):
    """Returns a voxel grid (0 empty, -1 hidden inside, n > 0 palette colour n-1) and the palette."""
    pitch = (mesh.bounds[1][1] - mesh.bounds[0][1]) / VOXELS_TALL
    voxels = mesh.voxelized(pitch)
    solid = ndimage.binary_fill_holes(voxels.matrix)

    padded = np.pad(solid, 1)
    inside = padded[1:-1, 1:-1, 1:-1].copy()
    for axis in range(3):
        for shift in (-1, 1):
            inside &= np.roll(padded, shift, axis=axis)[1:-1, 1:-1, 1:-1]
    surface_index = np.argwhere(solid & ~inside)

    # Dense surface samples with their texture colour.
    points, face_index = trimesh.sample.sample_surface(mesh, COLOUR_SAMPLES, seed=7)
    bary = trimesh.triangles.points_to_barycentric(mesh.triangles[face_index], points)
    uv = (mesh.visual.uv[mesh.faces[face_index]] * bary[..., None]).sum(axis=1)
    width, height = texture.size
    px = np.clip((uv[:, 0] % 1.0) * (width - 1), 0, width - 1).astype(int)
    py = np.clip((1 - uv[:, 1] % 1.0) * (height - 1), 0, height - 1).astype(int)
    sample_rgb = np.asarray(texture.convert("RGB"))[py, px].astype(np.float64) / 255

    # A little extra saturation and brightness for the vibrant look.
    hsv = np.array([colorsys.rgb_to_hsv(*colour) for colour in sample_rgb])
    hsv[:, 1] = np.clip(hsv[:, 1] * 1.15, 0, 1)
    hsv[:, 2] = np.clip(hsv[:, 2] * 1.06, 0, 1)
    sample_rgb = np.array([colorsys.hsv_to_rgb(*colour) for colour in hsv])

    # The palette comes from the samples, then every block takes the palette
    # colour most of its samples have. Voting (rather than averaging) keeps
    # small details crisp: white eyes with black pupils stay white and black
    # instead of turning into a grey-brown blur.
    strip = Image.fromarray((sample_rgb[None] * 255).round().astype(np.uint8), "RGB")
    quantised = strip.quantize(colors=PALETTE_SIZE, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
    palette = np.array(quantised.getpalette()[: PALETTE_SIZE * 3]).reshape(-1, 3)
    sample_labels = np.asarray(quantised)[0].astype(np.int64)

    row_of = np.full(solid.shape, -1, dtype=np.int64)
    row_of[tuple(surface_index.T)] = np.arange(len(surface_index))
    sample_index = np.asarray(voxels.points_to_indices(points))
    in_grid = np.all((sample_index >= 0) & (sample_index < np.array(solid.shape)), axis=1)
    rows = row_of[tuple(sample_index[in_grid].T)]
    keep = rows >= 0
    votes = np.zeros((len(surface_index), PALETTE_SIZE), dtype=np.int32)
    np.add.at(votes, (rows[keep], sample_labels[in_grid][keep]), 1)
    labels = votes.argmax(axis=1)
    unsampled = votes.sum(axis=1) == 0
    if unsampled.any():
        _, nearest = cKDTree(points).query(voxels.indices_to_points(surface_index[unsampled]))
        labels[unsampled] = sample_labels[nearest]

    grid = np.zeros(solid.shape, dtype=np.int16)
    grid[solid] = -1
    grid[tuple(surface_index.T)] = labels + 1
    return clean_colours(grid, passes=2), palette


def clean_colours(grid, passes=2):
    """Removes colour speckles: a visible block whose colour hardly appears
    around it takes the colour most of its neighbours have.

    Keeps small details like eyes (a few blocks of one colour together) and
    makes flat areas look like clean painted blocks.
    """
    for _ in range(passes):
        colours = [c for c in np.unique(grid) if c > 0]
        counts = np.zeros((len(colours),) + grid.shape, dtype=np.float32)
        for i, colour in enumerate(colours):
            counts[i] = ndimage.uniform_filter((grid == colour).astype(np.float32), size=3, mode="constant") * 27
        best = np.argmax(counts, axis=0)
        best_count = np.take_along_axis(counts, best[None], axis=0)[0]
        index_of = {colour: i for i, colour in enumerate(colours)}
        own = np.zeros(grid.shape, dtype=np.float32)
        for colour, i in index_of.items():
            mask = grid == colour
            own[mask] = counts[i][mask]
        replace = (grid > 0) & (own <= 2.5) & (best_count >= 5)
        if not replace.any():
            break
        grid = grid.copy()
        grid[replace] = np.array(colours, dtype=np.int16)[best[replace]]
    return grid


def greedy_quads(grid):
    """Merges visible block faces of the same colour.

    Returns (axis, positive, slice, u0, v0, uSize, vSize, colour) tuples, where
    u = (axis + 1) % 3 and v = (axis + 2) % 3.
    """
    quads = []
    dims = grid.shape
    filled = grid != 0
    for axis in range(3):
        u, v = (axis + 1) % 3, (axis + 2) % 3
        for positive in (0, 1):
            step = 1 if positive else -1
            for k in range(dims[axis]):
                here = [slice(None)] * 3
                here[axis] = k
                current = grid[tuple(here)]
                if 0 <= k + step < dims[axis]:
                    there = [slice(None)] * 3
                    there[axis] = k + step
                    open_side = ~filled[tuple(there)]
                else:
                    open_side = np.ones(current.shape, dtype=bool)
                mask = np.where((current > 0) & open_side, current, 0)
                if u > v:
                    mask = mask.T  # rows follow u, columns follow v
                mask = mask.copy()
                rows, cols = mask.shape
                for i in range(rows):
                    j = 0
                    while j < cols:
                        colour = mask[i, j]
                        if colour <= 0:
                            j += 1
                            continue
                        width = 1
                        while j + width < cols and mask[i, j + width] == colour:
                            width += 1
                        height = 1
                        while i + height < rows and np.all(mask[i + height, j : j + width] == colour):
                            height += 1
                        mask[i : i + height, j : j + width] = 0
                        quads.append((axis, positive, k, i, j, height, width, int(colour) - 1))
                        j += width
    return quads


def quad_corners(quad):
    """Corner positions in block units, counter-clockwise seen from outside."""
    axis, positive, k, i, j, u_size, v_size, _ = quad
    u, v = (axis + 1) % 3, (axis + 2) % 3
    corners = []
    for du, dv in ((0, 0), (u_size, 0), (u_size, v_size), (0, v_size)):
        corner = [0, 0, 0]
        corner[axis] = k + positive
        corner[u] = i + du
        corner[v] = j + dv
        corners.append(corner)
    if not positive:
        corners.reverse()
    return corners


def write_blocky_glb(path: Path, quads, palette, dims):
    vertices, faces, colours = [], [], []
    for quad in quads:
        base = len(vertices)
        vertices.extend(quad_corners(quad))
        faces.extend([(base, base + 1, base + 2), (base, base + 2, base + 3)])
        colours.extend([[*palette[quad[7]], 255]] * 4)
    positions = (np.array(vertices, dtype=np.float64) - np.array(dims) / 2) / dims[1]
    mesh = trimesh.Trimesh(
        vertices=positions,
        faces=faces,
        vertex_colors=np.array(colours, dtype=np.uint8),
        process=False,
    )
    path.write_bytes(trimesh.Scene(mesh).export(file_type="glb"))


def fill_hidden_colours(grid):
    """Gives hidden inside blocks the colour of the nearest visible block.

    Cutting off a leg exposes blocks that were inside the model.
    """
    hidden = grid < 0
    if not hidden.any():
        return grid
    _, nearest = ndimage.distance_transform_edt(grid <= 0, return_indices=True)
    filled = grid.copy()
    filled[hidden] = grid[tuple(index[hidden] for index in nearest)]
    return filled


def track_leg_runs(solid, max_hip):
    """Finds runs of layers where two big block groups stay apart (the legs).

    Yields (start, hip, left, right) for each run: the first layer, the layer
    where the two groups join, and each group's 2D mask on the last layer.
    """
    tracked = None
    start = 0
    for y in range(max_hip + 1):
        labels, count = ndimage.label(solid[:, y, :]) if y < max_hip else (None, 0)
        if tracked is not None:
            joined = labels is None
            groups = []
            if not joined:
                for mask in tracked:
                    ids = set(np.unique(labels[mask])) - {0}
                    groups.append(ids)
                joined = not groups[0] or not groups[1] or bool(groups[0] & groups[1])
            if joined:
                yield start, y, tracked[0], tracked[1]
                tracked = None
            else:
                tracked = [np.isin(labels, list(ids)) for ids in groups]
                continue
        if labels is None or count < 2:
            continue
        sizes = ndimage.sum(np.ones_like(labels), labels, range(1, count + 1))
        order = np.argsort(sizes)[::-1]
        if sizes[order[1]] >= max(3, 0.2 * sizes[order[0]]):
            tracked = [labels == order[0] + 1, labels == order[1] + 1]
            start = y


def find_legs(grid):
    """Finds the legs: the two block groups that stand apart above the ground.

    Feet may touch each other, so the longest run of layers where two groups
    stay apart decides the hip; everything below the hip that is connected to
    the ground is split between the legs at the gap. Returns (mask, pivot,
    phase) for each leg, with the hip pivot in block units.
    """
    solid = grid != 0
    height = solid.shape[1]
    max_hip = int(height * MAX_HIP_FRACTION)
    runs = [run for run in track_leg_runs(solid, max_hip) if run[0] <= height * 0.25]
    if not runs:
        return []
    start, hip, left_2d, right_2d = max(runs, key=lambda run: run[1] - run[0])
    if hip - start < 2:
        return []

    labels, _ = ndimage.label(solid[:, :hip, :])
    grounded = set(np.unique(labels[:, :2, :])) - {0}
    top_ids = set(np.unique(labels[:, hip - 1, :][left_2d | right_2d])) - {0}
    leg_ids = [label for label in grounded if label in top_ids]
    if not leg_ids:
        return []
    below = np.zeros(solid.shape, dtype=bool)
    below[:, :hip, :] = np.isin(labels, leg_ids)

    # Split at the gap between the two groups on the last layer before the hip.
    left_x = np.argwhere(left_2d)[:, 0].mean()
    right_x = np.argwhere(right_2d)[:, 0].mean()
    split_x = (left_x + right_x) / 2
    xs = np.arange(solid.shape[0])[:, None, None]
    legs = []
    for side in (xs < split_x, xs >= split_x):
        mask = below & side
        if mask.sum() < MIN_LEG_BLOCKS:
            return []
        centre = np.argwhere(mask).mean(axis=0) + 0.5
        legs.append((mask, (float(centre[0]), float(hip), float(centre[2])), int(centre[0] < split_x)))
    return legs


def pack_quads(quads):
    packed = bytearray()
    for axis, positive, k, i, j, u_size, v_size, colour in quads:
        packed += bytes((axis * 2 + positive, k, i, j, u_size, v_size, colour))
    return luau_string(compress(bytes(packed)))


def write_brainrot_module(brainrot_id: str, dims, palette, parts, source: str) -> Path:
    """Writes ReplicatedStorage/Assets/Brainrots/<Id>.luau.

    `parts` is a list of {kind, quads, pivot?, phase?, axis?}: the body first,
    then the moving pieces (Leg, Arm, Wing, Tail, Head, Prop) with their pivot
    in block units.
    """
    part_lines = []
    for part in parts:
        fields = [f'Kind = "{part["kind"]}"']
        pivot = part.get("pivot")
        if pivot is not None:
            fields.append("Pivot = { %s }" % ", ".join(f"{value:.2f}" for value in pivot))
            fields.append(f"Phase = {int(part.get('phase') or 0)}")
        if part.get("axis"):
            fields.append(f'Axis = "{part["axis"]}"')
        fields.append(f"QuadCount = {len(part['quads'])}")
        fields.append(f"Quads = {pack_quads(part['quads'])}")
        part_lines.append("\t\t{\n" + "".join(f"\t\t\t{field},\n" for field in fields) + "\t\t},\n")
    palette_text = ", ".join(f"0x{int(r):02x}{int(g):02x}{int(b):02x}" for r, g, b in palette)

    module_dir = ASSETS_DIR / "Brainrots"
    module_dir.mkdir(parents=True, exist_ok=True)
    module = module_dir / f"{brainrot_id}.luau"
    module.write_text(
        f"-- Generated by tools/build_{'blocky' if source.startswith('tools/') else 'assets'}.py from {source}. Do not edit.\n"
        "return {\n"
        f"\tFormat = {MESH_FORMAT},\n"
        f"\t-- Voxel grid size in blocks (x, y, z); the model is scaled so y is 1 stud.\n"
        f"\tDims = {{ {dims[0]}, {dims[1]}, {dims[2]} }},\n"
        f"\tPalette = {{ {palette_text} }},\n"
        "\t-- The body, then each moving piece. Legs swing about their hip Pivot (block\n"
        "\t-- units) and pieces with different Phase move in turn; arms swing, wings\n"
        "\t-- flap, tails wag, heads nod and props spin about Axis. Quads are Zstd +\n"
        "\t-- Base64, 7 bytes each: axis * 2 + positive, slice, u, v, uSize, vSize, colour.\n"
        "\tParts = {\n" + "".join(part_lines) + "\t},\n"
        "}\n"
    )
    # The same model as plain boxes, for devices that can't build meshes.
    from build_boxes import build_boxes

    build_boxes(brainrot_id)
    return module


def build_brainrot(brainrot_id: str):
    source = SOURCE_DIR / f"{brainrot_id}.glb"
    smooth = MODELS_DIR / f"{brainrot_id}.glb"
    if source.exists():
        raw, texture = load_glb(source)
        write_smooth_glb(smooth, *simplify(raw), texture)
    mesh, texture = load_glb(smooth)

    grid, palette = voxelise(mesh, texture)
    dims = grid.shape
    if max(dims) > 255:
        raise ValueError(f"{brainrot_id}: voxel grid too large")

    BLOCKY_DIR.mkdir(parents=True, exist_ok=True)
    write_blocky_glb(BLOCKY_DIR / f"{brainrot_id}.glb", greedy_quads(grid), palette, dims)

    coloured = fill_hidden_colours(grid)
    legs = find_legs(coloured)
    body = coloured.copy()
    for mask, _, _ in legs:
        body[mask] = 0
    parts = [("Body", greedy_quads(body), None, 0)]
    for mask, pivot, phase in legs:
        parts.append(("Leg", greedy_quads(np.where(mask, coloured, 0)), pivot, phase))

    module = write_brainrot_module(
        brainrot_id,
        dims,
        palette,
        [{"kind": kind, "quads": quads, "pivot": pivot, "phase": phase} for kind, quads, pivot, phase in parts],
        f"BrainrotModels/{brainrot_id}.glb",
    )
    quad_count = sum(len(quads) for _, quads, _, _ in parts)
    return brainrot_id, dims, quad_count, len(legs), module.stat().st_size


def build_icon(folder_name: str, png: Path):
    image = Image.open(png).convert("RGBA").resize((ICON_SIZE, ICON_SIZE), Image.LANCZOS)
    module_dir = ASSETS_DIR / folder_name
    module_dir.mkdir(parents=True, exist_ok=True)
    module = module_dir / f"{png.stem}.luau"
    module.write_text(
        f"-- Generated by tools/build_assets.py from {folder_name}/{png.name}. Do not edit.\n"
        "return {\n"
        f"\tFormat = {ICON_FORMAT},\n"
        f"\tSize = {ICON_SIZE},\n"
        "\t-- Zstd + Base64: RGBA8 pixels.\n"
        f"\tPixels = {luau_string(compress(image.tobytes()))},\n"
        "}\n"
    )
    return module.stat().st_size


def main():
    total = 0
    brainrot_ids = sorted({path.stem for path in [*MODELS_DIR.glob("*.glb"), *SOURCE_DIR.glob("*.glb")]})
    # Block-built brainrots come from tools/build_blocky.py instead.
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from blocky import load_designs

    blocky_ids = set(load_designs())
    brainrot_ids = [brainrot_id for brainrot_id in brainrot_ids if brainrot_id not in blocky_ids]
    if len(sys.argv) > 1:
        brainrot_ids = [brainrot_id for brainrot_id in brainrot_ids if brainrot_id in sys.argv[1:]]
    for brainrot_id in brainrot_ids:
        brainrot_id, dims, quad_count, leg_count, size = build_brainrot(brainrot_id)
        total += size
        print(
            f"{brainrot_id:24s} {dims[0]:3d}x{dims[1]:3d}x{dims[2]:3d} blocks {quad_count:6d} quads "
            f"{leg_count} legs {size / 1024:7.1f} KB"
        )
    for folder_name, folder in ICON_FOLDERS.items():
        for png in sorted(folder.glob("*.png")):
            size = build_icon(folder_name, png)
            total += size
            print(f"{folder_name + '/' + png.stem:24s} icon {size / 1024:7.1f} KB")
    print(f"Total module size: {total / 1024 / 1024:.2f} MB")


if __name__ == "__main__":
    sys.exit(main())
