#!/usr/bin/env python3
"""Pack the brainrot 3D models and product icons into Luau modules.

Roblox can't load a .glb or .png from a place file without uploading it to an
account first. Instead, this script stores each model and icon as compressed
data inside a ModuleScript; the client rebuilds them at runtime with
EditableMesh and EditableImage (see ReplicatedStorage/Shared/AssetLoader.luau).

Inputs (paths relative to the StealABrainrot folder):
  BrainrotModels/source/<Id>.glb  raw Higgsfield models (optional, not committed)
  BrainrotModels/<Id>.glb         optimised models, used when there is no raw one
  ProductIcons/<Key>.png          developer product icons

Outputs:
  BrainrotModels/<Id>.glb                          simplified, facing Roblox's front (-Z),
                                                   height 1 (also ready for Studio's 3D importer)
  ReplicatedStorage/Assets/Brainrots/<Id>.luau     mesh + texture data
  ReplicatedStorage/Assets/ProductIcons/<Key>.luau icon pixels

Requires: numpy, pillow, trimesh, pymeshlab, zstandard.
Run from the StealABrainrot folder:  python3 tools/build_assets.py
"""

import base64
import sys
import tempfile
from pathlib import Path

import numpy as np
import pymeshlab
import trimesh
import zstandard
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
MODELS_DIR = ROOT / "BrainrotModels"
SOURCE_DIR = MODELS_DIR / "source"
ICONS_DIR = ROOT / "ProductIcons"
BRAINROT_MODULES = ROOT / "ReplicatedStorage" / "Assets" / "Brainrots"
ICON_MODULES = ROOT / "ReplicatedStorage" / "Assets" / "ProductIcons"

TARGET_TRIANGLES = 6000
TEXTURE_SIZE = 256
GLB_TEXTURE_SIZE = 512
ICON_SIZE = 128
CHUNK = 8000  # characters per string literal
FORMAT_VERSION = 1


def compress(data: bytes) -> str:
    return base64.b64encode(zstandard.ZstdCompressor(level=19).compress(data)).decode("ascii")


def luau_string(encoded: str) -> str:
    chunks = [encoded[i : i + CHUNK] for i in range(0, len(encoded), CHUNK)]
    lines = "\n".join(f'\t\t"{chunk}",' for chunk in chunks)
    return "table.concat({\n" + lines + "\n\t})"


def load_glb(path: Path):
    """Returns positions, faces, per-vertex UVs (bottom-left origin) and the texture."""
    scene = trimesh.load(path, force="scene")
    meshes = scene.dump()
    if len(meshes) != 1:
        mesh = trimesh.util.concatenate(meshes)
    else:
        mesh = meshes[0]
    visual = mesh.visual
    if not isinstance(visual, trimesh.visual.TextureVisuals) or visual.uv is None:
        raise ValueError(f"{path.name} has no texture coordinates")
    material = visual.material
    image = getattr(material, "baseColorTexture", None) or getattr(material, "image", None)
    if image is None:
        raise ValueError(f"{path.name} has no base colour texture")
    return (
        np.asarray(mesh.vertices, dtype=np.float64),
        np.asarray(mesh.faces, dtype=np.int64),
        np.asarray(visual.uv, dtype=np.float64),
        image.convert("RGB"),
    )


def weld_and_simplify(positions, faces, uvs):
    """Merges seam-split vertices, then simplifies while keeping per-corner UVs."""
    rounded = np.round(positions, 6)
    unique, inverse = np.unique(rounded, axis=0, return_inverse=True)
    inverse = inverse.reshape(-1)
    face_positions = inverse[faces]
    wedge_uvs = uvs[faces]  # (F, 3, 2)

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
        mesh = meshset.current_mesh()
        faces = np.asarray(mesh.face_matrix(), dtype=np.int64)
        wedge_uvs = np.asarray(mesh.wedge_tex_coord_matrix(), dtype=np.float64).reshape(-1, 3, 2)
        # EditableMesh rejects triangles that reuse a vertex.
        valid = (faces[:, 0] != faces[:, 1]) & (faces[:, 1] != faces[:, 2]) & (faces[:, 0] != faces[:, 2])
        return np.asarray(mesh.vertex_matrix(), dtype=np.float64), faces[valid], wedge_uvs[valid]


def to_roblox_space(positions):
    """Turns the model to face -Z (Roblox's front), centres it and scales it to height 1."""
    turned = positions * np.array([-1.0, 1.0, -1.0])
    low, high = turned.min(axis=0), turned.max(axis=0)
    centred = turned - (low + high) / 2
    height = high[1] - low[1]
    return centred / height, (high - low) / height


def quantize(values, low, high):
    span = np.where(high - low > 1e-9, high - low, 1.0)
    return np.clip(np.round((values - low) / span * 65535), 0, 65535).astype("<u2")


def write_glb(path, positions, faces, wedge_uvs, texture):
    """Writes a GLB with per-corner UVs split into vertices, for Studio's importer."""
    corner_positions = positions[faces].reshape(-1, 3)
    corner_uvs = wedge_uvs.reshape(-1, 2)
    keys = np.concatenate([np.round(corner_positions, 6), np.round(corner_uvs, 6)], axis=1)
    _, first, inverse = np.unique(keys, axis=0, return_index=True, return_inverse=True)
    vertices = corner_positions[first]
    uvs = corner_uvs[first]
    new_faces = inverse.reshape(-1, 3)
    image = texture.resize((GLB_TEXTURE_SIZE, GLB_TEXTURE_SIZE), Image.LANCZOS)
    material = trimesh.visual.material.PBRMaterial(baseColorTexture=image, metallicFactor=0.0, roughnessFactor=0.8)
    mesh = trimesh.Trimesh(
        vertices=vertices,
        faces=new_faces,
        visual=trimesh.visual.TextureVisuals(uv=uvs, material=material),
        process=False,
    )
    path.write_bytes(trimesh.Scene(mesh).export(file_type="glb"))


def build_brainrot(brainrot_id: str):
    source = SOURCE_DIR / f"{brainrot_id}.glb"
    optimised = MODELS_DIR / f"{brainrot_id}.glb"
    if source.exists():
        positions, faces, uvs, texture = load_glb(source)
        positions, faces, wedge_uvs = weld_and_simplify(positions, faces, uvs)
        normalised, size = to_roblox_space(positions)
        write_glb(optimised, normalised, faces, wedge_uvs, texture)
    else:
        # Already simplified, facing -Z and height 1 from an earlier run.
        positions, faces, uvs, texture = load_glb(optimised)
        positions, faces, wedge_uvs = weld_and_simplify(positions, faces, uvs)
        low, high = positions.min(axis=0), positions.max(axis=0)
        normalised = positions - (low + high) / 2
        size = high - low

    # Mesh data: quantised positions, unique UVs (Roblox: top-left origin),
    # then per-face position and UV indices.
    half = size / 2
    position_data = quantize(normalised, -half, half)
    roblox_uvs = np.stack([wedge_uvs[..., 0], 1.0 - wedge_uvs[..., 1]], axis=-1)
    quantized_uvs = quantize(np.clip(roblox_uvs, 0, 1), np.zeros(2), np.ones(2)).reshape(-1, 2)
    unique_uvs, uv_inverse = np.unique(quantized_uvs, axis=0, return_inverse=True)
    face_uvs = uv_inverse.reshape(-1, 3)

    if len(position_data) > 65535 or len(unique_uvs) > 65535:
        raise ValueError(f"{brainrot_id}: too many vertices for 16-bit indices")

    mesh_bytes = b"".join(
        [
            position_data.astype("<u2").tobytes(),
            unique_uvs.astype("<u2").tobytes(),
            faces.astype("<u2").tobytes(),
            face_uvs.astype("<u2").tobytes(),
        ]
    )
    pixels = texture.resize((TEXTURE_SIZE, TEXTURE_SIZE), Image.LANCZOS).convert("RGBA").tobytes()

    BRAINROT_MODULES.mkdir(parents=True, exist_ok=True)
    module = BRAINROT_MODULES / f"{brainrot_id}.luau"
    module.write_text(
        f"-- Generated by tools/build_assets.py from BrainrotModels/{brainrot_id}.glb. Do not edit.\n"
        "return {\n"
        f"\tFormat = {FORMAT_VERSION},\n"
        f"\tPositionCount = {len(position_data)},\n"
        f"\tUVCount = {len(unique_uvs)},\n"
        f"\tTriangleCount = {len(faces)},\n"
        f"\t-- Bounding box, scaled so the height is 1.\n"
        f"\tSize = {{ {size[0]:.5f}, {size[1]:.5f}, {size[2]:.5f} }},\n"
        f"\tTextureSize = {TEXTURE_SIZE},\n"
        f"\t-- Zstd + Base64: u16 positions, u16 UVs, u16 face positions, u16 face UVs.\n"
        f"\tMesh = {luau_string(compress(mesh_bytes))},\n"
        f"\t-- Zstd + Base64: RGBA8 pixels.\n"
        f"\tTexture = {luau_string(compress(pixels))},\n"
        "}\n"
    )
    return brainrot_id, len(position_data), len(faces), module.stat().st_size


def build_icon(png: Path):
    image = Image.open(png).convert("RGBA").resize((ICON_SIZE, ICON_SIZE), Image.LANCZOS)
    ICON_MODULES.mkdir(parents=True, exist_ok=True)
    module = ICON_MODULES / f"{png.stem}.luau"
    module.write_text(
        f"-- Generated by tools/build_assets.py from ProductIcons/{png.name}. Do not edit.\n"
        "return {\n"
        f"\tFormat = {FORMAT_VERSION},\n"
        f"\tSize = {ICON_SIZE},\n"
        f"\t-- Zstd + Base64: RGBA8 pixels.\n"
        f"\tPixels = {luau_string(compress(image.tobytes()))},\n"
        "}\n"
    )
    return png.stem, module.stat().st_size


def main():
    total = 0
    brainrot_ids = sorted({path.stem for path in [*MODELS_DIR.glob("*.glb"), *SOURCE_DIR.glob("*.glb")]})
    for brainrot_id in brainrot_ids:
        brainrot_id, vertex_count, triangle_count, size = build_brainrot(brainrot_id)
        total += size
        print(f"{brainrot_id:24s} {vertex_count:6d} vertices {triangle_count:6d} triangles {size / 1024:8.1f} KB")
    for png in sorted(ICONS_DIR.glob("*.png")):
        key, size = build_icon(png)
        total += size
        print(f"{key:24s} icon {size / 1024:8.1f} KB")
    print(f"Total module size: {total / 1024 / 1024:.2f} MB")


if __name__ == "__main__":
    sys.exit(main())
