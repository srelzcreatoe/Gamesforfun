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
VOXELS_TALL = 48
PALETTE_SIZE = 40
COLOUR_SAMPLES = 400000
ICON_SIZE = 128
CHUNK = 8000  # characters per string literal
MESH_FORMAT = 2
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

    # Average the texture colour of dense surface samples inside each block.
    points, face_index = trimesh.sample.sample_surface(mesh, COLOUR_SAMPLES, seed=7)
    bary = trimesh.triangles.points_to_barycentric(mesh.triangles[face_index], points)
    uv = (mesh.visual.uv[mesh.faces[face_index]] * bary[..., None]).sum(axis=1)
    width, height = texture.size
    px = np.clip((uv[:, 0] % 1.0) * (width - 1), 0, width - 1).astype(int)
    py = np.clip((1 - uv[:, 1] % 1.0) * (height - 1), 0, height - 1).astype(int)
    sample_rgb = np.asarray(texture)[py, px].astype(np.float64) / 255

    sample_index = np.asarray(voxels.points_to_indices(points))
    in_grid = np.all((sample_index >= 0) & (sample_index < np.array(solid.shape)), axis=1)
    sums = np.zeros(solid.shape + (3,))
    counts = np.zeros(solid.shape)
    np.add.at(sums, tuple(sample_index[in_grid].T), sample_rgb[in_grid])
    np.add.at(counts, tuple(sample_index[in_grid].T), 1)

    rgb = np.zeros((len(surface_index), 3))
    sampled = counts[tuple(surface_index.T)] > 0
    rgb[sampled] = sums[tuple(surface_index[sampled].T)] / counts[tuple(surface_index[sampled].T)][:, None]
    if (~sampled).any():
        _, nearest = cKDTree(points).query(voxels.indices_to_points(surface_index[~sampled]))
        rgb[~sampled] = sample_rgb[nearest]

    # A little extra saturation and brightness for the vibrant look.
    hsv = np.array([colorsys.rgb_to_hsv(*colour) for colour in rgb])
    hsv[:, 1] = np.clip(hsv[:, 1] * 1.15, 0, 1)
    hsv[:, 2] = np.clip(hsv[:, 2] * 1.06, 0, 1)
    rgb = np.array([colorsys.hsv_to_rgb(*colour) for colour in hsv])

    strip = Image.fromarray((rgb[None] * 255).round().astype(np.uint8), "RGB")
    quantised = strip.quantize(colors=PALETTE_SIZE, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
    palette = np.array(quantised.getpalette()[: PALETTE_SIZE * 3]).reshape(-1, 3)
    labels = np.asarray(quantised)[0]

    grid = np.zeros(solid.shape, dtype=np.int16)
    grid[solid] = -1
    grid[tuple(surface_index.T)] = labels + 1
    return grid, palette


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


def build_brainrot(brainrot_id: str):
    source = SOURCE_DIR / f"{brainrot_id}.glb"
    smooth = MODELS_DIR / f"{brainrot_id}.glb"
    if source.exists():
        raw, texture = load_glb(source)
        write_smooth_glb(smooth, *simplify(raw), texture)
    mesh, texture = load_glb(smooth)

    grid, palette = voxelise(mesh, texture)
    quads = greedy_quads(grid)
    dims = grid.shape
    if max(dims) > 255:
        raise ValueError(f"{brainrot_id}: voxel grid too large")

    BLOCKY_DIR.mkdir(parents=True, exist_ok=True)
    write_blocky_glb(BLOCKY_DIR / f"{brainrot_id}.glb", quads, palette, dims)

    packed = bytearray()
    for axis, positive, k, i, j, u_size, v_size, colour in quads:
        packed += bytes((axis * 2 + positive, k, i, j, u_size, v_size, colour))
    palette_text = ", ".join(f"0x{r:02x}{g:02x}{b:02x}" for r, g, b in palette)

    module_dir = ASSETS_DIR / "Brainrots"
    module_dir.mkdir(parents=True, exist_ok=True)
    module = module_dir / f"{brainrot_id}.luau"
    module.write_text(
        f"-- Generated by tools/build_assets.py from BrainrotModels/{brainrot_id}.glb. Do not edit.\n"
        "return {\n"
        f"\tFormat = {MESH_FORMAT},\n"
        f"\t-- Voxel grid size in blocks (x, y, z); the model is scaled so y is 1 stud.\n"
        f"\tDims = {{ {dims[0]}, {dims[1]}, {dims[2]} }},\n"
        f"\tPalette = {{ {palette_text} }},\n"
        f"\tQuadCount = {len(quads)},\n"
        "\t-- Zstd + Base64, 7 bytes per quad: axis * 2 + positive, slice, u, v, uSize, vSize, colour.\n"
        f"\tQuads = {luau_string(compress(bytes(packed)))},\n"
        "}\n"
    )
    return brainrot_id, dims, len(quads), module.stat().st_size


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
    for brainrot_id in brainrot_ids:
        brainrot_id, dims, quad_count, size = build_brainrot(brainrot_id)
        total += size
        print(f"{brainrot_id:24s} {dims[0]:3d}x{dims[1]:3d}x{dims[2]:3d} blocks {quad_count:6d} quads {size / 1024:7.1f} KB")
    for folder_name, folder in ICON_FOLDERS.items():
        for png in sorted(folder.glob("*.png")):
            size = build_icon(folder_name, png)
            total += size
            print(f"{folder_name + '/' + png.stem:24s} icon {size / 1024:7.1f} KB")
    print(f"Total module size: {total / 1024 / 1024:.2f} MB")


if __name__ == "__main__":
    sys.exit(main())
