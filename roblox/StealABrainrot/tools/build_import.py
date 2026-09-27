"""Packs every brainrot's textured 3D model into one file to import in Studio.

    python3 tools/build_import.py            # every brainrot
    python3 tools/build_import.py TimCheese  # just these, for a quick look

Writes BrainrotModels/Import/BrainrotModels.glb. In Roblox Studio use
File > Import 3D, pick that file and press Import: Studio uploads the meshes
and textures to your account and inserts a "BrainrotModels" model. The game
finds it wherever it is (Workspace or ReplicatedStorage) and uses these models
for every brainrot, so they load like any other Roblox mesh.

Each brainrot is the original model made with Higgsfield or Customuse
(BrainrotModels/source/<Id>.glb, or the smooth BrainrotModels/<Id>.glb when
there is no source), simplified to fit a Roblox MeshPart, standing on the
ground and facing Roblox's front. Every part is named "<Id>_<Piece>":

  <Id>_Body         everything but the legs
  <Id>_Leg1/_Leg2   the legs, cut at the hip so the game can swing them
  <Id>_Front        a tiny marker in front of the model
  <Id>_Top          a tiny marker above it

The game uses the two markers to stand each model up facing the right way
(whatever axes the importer uses) and then deletes them.
"""

import sys
from pathlib import Path

import numpy as np
import trimesh
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_assets as B  # noqa: E402

IMPORT_DIR = B.MODELS_DIR / "Import"
OUTPUT = IMPORT_DIR / "BrainrotModels.glb"
TRIANGLES = 9000
TEXTURE_SIZE = 1024
HEIGHT = 5.0  # studs; the game rescales every model anyway
SPACING = 10.0
MARKER = 0.25


def brainrot_ids():
    """Brainrots made with Higgsfield or Customuse (block-built ones, from
    tools/blocky, keep their blocky model and aren't imported)."""
    text = (B.ROOT / "ReplicatedStorage" / "Shared" / "BrainrotConfig.luau").read_text()
    import re

    return re.findall(r'\bbrainrot\("([A-Za-z0-9]+)"', text)


def load_model(brainrot_id):
    """Returns (vertices, faces, uvs, texture) standing on y = 0, HEIGHT tall,
    facing -Z, with one UV per vertex."""
    source = B.SOURCE_DIR / f"{brainrot_id}.glb"
    smooth = B.MODELS_DIR / f"{brainrot_id}.glb"
    path = source if source.exists() else smooth
    raw, texture = B.load_glb(path)
    B.TARGET_TRIANGLES = TRIANGLES
    positions, faces, wedge_uvs = B.simplify(raw)
    # Sources face +Z (like Higgsfield's SAM output); smooth models already face -Z.
    turned = positions * np.array([-1.0, 1.0, -1.0]) if path == source else positions
    low, high = turned.min(axis=0), turned.max(axis=0)
    scale = HEIGHT / (high[1] - low[1])
    placed = (turned - np.array([(low[0] + high[0]) / 2, low[1], (low[2] + high[2]) / 2])) * scale

    corner_positions = placed[faces].reshape(-1, 3)
    corner_uvs = wedge_uvs.reshape(-1, 2)
    keys = np.concatenate([np.round(corner_positions, 5), np.round(corner_uvs, 5)], axis=1)
    _, first, inverse = np.unique(keys, axis=0, return_index=True, return_inverse=True)
    vertices = corner_positions[first]
    uvs = corner_uvs[first]
    new_faces = inverse.reshape(-1, 3)
    if texture.size[0] > TEXTURE_SIZE:
        texture = texture.resize((TEXTURE_SIZE, TEXTURE_SIZE), Image.LANCZOS)
    return vertices, new_faces, uvs, texture


def split_legs(vertices, faces, uvs, texture):
    """Returns {piece: face indices}: the body and each leg (Leg1 steps first)."""
    material = trimesh.visual.material.SimpleMaterial(image=texture)
    mesh = trimesh.Trimesh(vertices=vertices, faces=faces, visual=trimesh.visual.TextureVisuals(uv=uvs, material=material), process=False)
    grid, _ = B.voxelise(mesh, texture)
    legs = B.find_legs(B.fill_hidden_colours(grid))
    pieces = {"Body": np.arange(len(faces))}
    if not legs:
        return pieces
    pitch = HEIGHT / B.VOXELS_TALL
    voxels = mesh.voxelized(pitch)
    shape = np.array(grid.shape)
    centroids = vertices[faces].mean(axis=1)
    index = np.clip(np.asarray(voxels.points_to_indices(centroids)), 0, shape - 1)
    owner = np.zeros(len(faces), dtype=int)
    for number, (mask, _, phase) in enumerate(legs):
        owner[mask[tuple(index.T)]] = phase + 1
    pieces = {"Body": np.flatnonzero(owner == 0)}
    for phase in (1, 2):
        chosen = np.flatnonzero(owner == phase)
        if len(chosen) > 0:
            pieces[f"Leg{phase}"] = chosen
    if len(pieces) < 3:
        # One leg got nothing: keep the model in one piece.
        return {"Body": np.arange(len(faces))}
    return pieces


def piece_mesh(vertices, faces, uvs, material, chosen):
    used = np.unique(faces[chosen])
    remap = np.full(len(vertices), -1)
    remap[used] = np.arange(len(used))
    return trimesh.Trimesh(
        vertices=vertices[used],
        faces=remap[faces[chosen]],
        visual=trimesh.visual.TextureVisuals(uv=uvs[used], material=material),
        process=False,
    )


def marker(colour):
    box = trimesh.creation.box(extents=[MARKER] * 3)
    box.visual.face_colors = np.tile(np.append(colour, 255), (len(box.faces), 1))
    return box


def jpeg_textures(path):
    """Re-encodes the file's textures as JPEG, about a sixth of the PNG size."""
    import io

    import pygltflib

    gltf = pygltflib.GLTF2().load_binary(str(path))
    blob = gltf.binary_blob()
    image_views = {image.bufferView: image for image in gltf.images if image.bufferView is not None}
    chunks = []
    offset = 0
    for index, view in enumerate(gltf.bufferViews):
        data = blob[view.byteOffset or 0 : (view.byteOffset or 0) + view.byteLength]
        image = image_views.get(index)
        if image is not None:
            out = io.BytesIO()
            Image.open(io.BytesIO(data)).convert("RGB").save(out, "JPEG", quality=90)
            data = out.getvalue()
            image.mimeType = "image/jpeg"
        padding = (4 - offset % 4) % 4
        chunks.append(b"\0" * padding)
        offset += padding
        view.byteOffset = offset
        view.byteLength = len(data)
        chunks.append(data)
        offset += len(data)
    new_blob = b"".join(chunks)
    gltf.buffers[0].byteLength = len(new_blob)
    gltf.set_binary_blob(new_blob)
    gltf.save_binary(str(path))


def main():
    wanted = sys.argv[1:]
    ids = brainrot_ids()
    scene = trimesh.Scene()
    IMPORT_DIR.mkdir(parents=True, exist_ok=True)
    for number, brainrot_id in enumerate(ids):
        if wanted and brainrot_id not in wanted:
            continue
        vertices, faces, uvs, texture = load_model(brainrot_id)
        pieces = split_legs(vertices, faces, uvs, texture)
        material = trimesh.visual.material.PBRMaterial(
            name=f"{brainrot_id}_Skin", baseColorTexture=texture, metallicFactor=0.0, roughnessFactor=0.85
        )
        offset = trimesh.transformations.translation_matrix([number * SPACING, 0, 0])
        for piece, chosen in pieces.items():
            name = f"{brainrot_id}_{piece}"
            scene.add_geometry(piece_mesh(vertices, faces, uvs, material, chosen), node_name=name, geom_name=name, transform=offset)
        depth_front = vertices[:, 2].min()
        front = trimesh.transformations.translation_matrix([number * SPACING, HEIGHT / 2, depth_front - 0.6])
        top = trimesh.transformations.translation_matrix([number * SPACING, HEIGHT + 0.6, 0])
        scene.add_geometry(marker([255, 40, 40]), node_name=f"{brainrot_id}_Front", geom_name=f"{brainrot_id}_Front", transform=front)
        scene.add_geometry(marker([40, 80, 255]), node_name=f"{brainrot_id}_Top", geom_name=f"{brainrot_id}_Top", transform=top)
        print(f"{brainrot_id:24s} {len(faces):6d} triangles  pieces: {', '.join(f'{k} {len(v)}' for k, v in pieces.items())}", flush=True)
    OUTPUT.write_bytes(scene.export(file_type="glb"))
    jpeg_textures(OUTPUT)
    print(f"Wrote {OUTPUT} ({OUTPUT.stat().st_size / 1e6:.1f} MB)")


if __name__ == "__main__":
    main()
