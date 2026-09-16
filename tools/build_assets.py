#!/usr/bin/env python3
"""Asset pipeline for Dragon Block Sagas.

Sources (extracted packs, see docs/ARCHITECTURE.md §0):
  fused   Fused Vanilla Texture/Model packs (Bedrock)  -> block/plant/item textures
  dmz     DragonMineZ 2.1.3 jar (GPL-3.0)             -> entities, models, animations, sounds, gui, items, blocks
  dmzplus DMZ Plus 1.1.6 jar (GPL-3.0)                -> planets/sky textures, items, blocks
  dmzhd   DMZ HD Texturepack 2.1 (ZoneMC)              -> HD entity/armor/gui textures
  particles AAA Particles: World (MIT)                 -> particle sprites
Everything the packs don't provide is generated procedurally here (seeded, deterministic).

Usage: python3 tools/build_assets.py [--src DIR] [--clean]
"""
import argparse, json, os, shutil, sys, hashlib, math
from PIL import Image, ImageDraw
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GAME = os.path.join(ROOT, "game")
A = os.path.join(GAME, "assets")
DEFAULT_SRC = "/tmp/claude-0/-home-user-Gamesforfun/a637a6ef-7708-59b3-aeb2-5b4698448421/scratchpad/ex"

ap = argparse.ArgumentParser()
ap.add_argument("--src", default=DEFAULT_SRC)
ap.add_argument("--clean", action="store_true")
args = ap.parse_args()
SRC = args.src
FUSED_TP = os.path.join(SRC, "fused", "Fused_Vanilla_TP", "textures")
FUSED_MP = os.path.join(SRC, "fused", "Fused_Vanilla_MP(BL)_1.1", "textures")
DMZ = os.path.join(SRC, "dmz", "assets", "dragonminez")
DMZ_MC = os.path.join(SRC, "dmz", "assets", "minecraft")
DMZP = os.path.join(SRC, "dmzplus", "assets", "dmzplus")
DMZP_DMZ = os.path.join(SRC, "dmzplus", "assets", "dragonminez")
HD = os.path.join(SRC, "dmzhd", "assets")
AAA = os.path.join(SRC, "particles", "assets", "aaa_particles_world")

rng = np.random.default_rng(0xDB2)
stats = {"copied": 0, "generated": 0, "missing": []}

def ensure(d):
    os.makedirs(d, exist_ok=True)

def out(path):
    ensure(os.path.dirname(path))
    return path

def load_rgba(path):
    im = Image.open(path)
    return im.convert("RGBA")

def save(im, path):
    ensure(os.path.dirname(path))
    im.save(path, optimize=False)

def fa(arr, mode="RGBA"):
    return Image.fromarray(arr, mode).copy()

def hexc(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i+2], 16) for i in (0, 2, 4))

# ------------------------------------------------------------------ .import files
TEX_IMPORT = """[remap]

importer="texture"
type="CompressedTexture2D"

[deps]

source_file="res://{res}"

[params]

compress/mode=0
compress/high_quality=false
compress/lossy_quality=0.7
compress/hdr_compression=1
compress/normal_map=0
compress/channel_pack=0
mipmaps/generate={mips}
mipmaps/limit=-1
roughness/mode=0
roughness/src_normal=""
process/fix_alpha_border=true
process/premult_alpha=false
process/normal_map_invert_y=false
process/hdr_as_srgb=false
process/hdr_clamp_exposure=false
process/size_limit=0
detect_3d/compress_to=0
"""
OGG_IMPORT = """[remap]

importer="oggvorbisstr"
type="AudioStreamOggVorbis"

[deps]

source_file="res://{res}"

[params]

loop={loop}
loop_offset=0
bpm=0
beat_count=0
bar_beats=4
"""
WAV_IMPORT = """[remap]

importer="wav"
type="AudioStreamWAV"

[deps]

source_file="res://{res}"

[params]

force/8_bit=false
force/mono=false
force/max_rate=false
force/max_rate_hz=44100
edit/trim=false
edit/normalize=false
edit/loop_mode={loop}
edit/loop_begin=0
edit/loop_end=-1
compress/mode=2
"""

def write_imports():
    n = 0
    for dp, dn, fn in os.walk(A):
        for f in fn:
            p = os.path.join(dp, f)
            res = os.path.relpath(p, GAME).replace(os.sep, "/")
            low = f.lower()
            if low.endswith(".png"):
                mips = "true" if ("/entity/" in res or "/armor/" in res or "/environment/" in res or "/particles/" in res) else "false"
                open(p + ".import", "w").write(TEX_IMPORT.format(res=res, mips=mips))
                n += 1
            elif low.endswith(".ogg"):
                loop = "true" if any(k in low for k in ("_loop", "heartbeat", "ambience_")) else "false"
                open(p + ".import", "w").write(OGG_IMPORT.format(res=res, loop=loop))
                n += 1
            elif low.endswith(".wav"):
                loop = "1" if ("ambience_" in low or "_loop" in low) else "0"
                open(p + ".import", "w").write(WAV_IMPORT.format(res=res, loop=loop))
                n += 1
    print(f".import files: {n}")

# ------------------------------------------------------------------ procedural tile generators
def tile(base, var=10, seed=None, w=16, h=16, speck=None, speck_n=0):
    r = np.random.default_rng(seed if seed is not None else rng.integers(1 << 30))
    img = np.zeros((h, w, 4), dtype=np.int32)
    b = np.array(base, dtype=np.int32)
    n = r.integers(-var, var + 1, size=(h, w, 1))
    img[..., :3] = np.clip(b + n, 0, 255)
    img[..., 3] = 255
    if speck is not None:
        for _ in range(speck_n):
            x, y = r.integers(0, w), r.integers(0, h)
            img[y, x, :3] = np.clip(np.array(speck) + r.integers(-8, 9, 3), 0, 255)
    return fa(img.astype(np.uint8))

def blend_over(under, over):
    u = under.copy(); u.alpha_composite(over); return u

def darken(im, f):
    a = np.array(im).astype(np.float32); a[..., :3] *= f; return fa(np.clip(a, 0, 255).astype(np.uint8))

def shift_hue_tint(im, color, strength=1.0):
    a = np.array(im).astype(np.float32)
    g = a[..., :3].mean(axis=2, keepdims=True) / 255.0
    c = np.array(color, dtype=np.float32)
    a[..., :3] = a[..., :3] * (1 - strength) + g * c * strength
    return fa(np.clip(a, 0, 255).astype(np.uint8))

def stone_like(base, seed, var=9, cracks=3):
    im = tile(base, var, seed)
    d = ImageDraw.Draw(im)
    r = np.random.default_rng(seed + 7)
    for _ in range(cracks):
        x, y = r.integers(0, 16), r.integers(0, 16)
        for _ in range(r.integers(2, 5)):
            nx, ny = min(15, max(0, x + r.integers(-1, 2))), min(15, max(0, y + r.integers(-1, 2)))
            d.line((x, y, nx, ny), fill=tuple(max(0, c - 28) for c in base) + (255,))
            x, y = nx, ny
    return im

def bricks_tile(mortar, brick, seed, rows=4, cols=2, var=8):
    im = tile(mortar, 4, seed)
    r = np.random.default_rng(seed + 3)
    px = im.load()
    bh = 16 // rows
    for row in range(rows):
        off = (16 // cols // 2) if row % 2 else 0
        for col in range(cols + 1):
            x0 = col * (16 // cols) - off
            for y in range(row * bh, row * bh + bh - 1):
                for x in range(x0 + 1, x0 + (16 // cols) ):
                    if 0 <= x < 16:
                        n = int(r.integers(-var, var + 1))
                        px[x, y] = tuple(max(0, min(255, c + n)) for c in brick) + (255,)
    return im

def planks_tile(base, seed, dark=0.78):
    im = tile(base, 6, seed)
    px = im.load()
    r = np.random.default_rng(seed + 5)
    for y in range(16):
        # plank rows of 4 px with a dark seam line every 4 rows, offset every other plank
        if y % 4 == 3:
            for x in range(16):
                px[x, y] = tuple(int(c * dark) for c in base) + (255,)
        else:
            # vertical seam
            sx = 8 if (y // 4) % 2 == 0 else 0
            if sx or True:
                c = tuple(int(cc * dark) for cc in base) + (255,)
                if (y // 4) % 2 == 0:
                    px[7, y] = c
                else:
                    px[15, y] = c; px[0, y] = tuple(int(cc * 0.9) for cc in base) + (255,)
        for x in range(16):
            if r.random() < 0.08:
                cc = px[x, y]
                px[x, y] = tuple(max(0, min(255, cc[i] - 12)) for i in range(3)) + (255,)
    return im

def ore_tile(stone_img, color, seed, n=7):
    im = stone_img.copy()
    px = im.load()
    r = np.random.default_rng(seed)
    for _ in range(n):
        x, y = int(r.integers(1, 14)), int(r.integers(1, 14))
        shape = [(x, y), (x + 1, y), (x, y + 1), (x + 1, y + 1)] if r.random() < 0.6 else [(x, y), (x + 1, y), (x, y + 1)]
        for (sx, sy) in shape:
            px[sx, sy] = tuple(min(255, c + int(r.integers(-10, 11))) for c in color) + (255,)
        px[x, y] = tuple(min(255, int(c * 1.15)) for c in color) + (255,)
    return im

def metal_block(color, seed, dark=0.7):
    im = tile(color, 4, seed)
    px = im.load()
    e = tuple(int(c * dark) for c in color) + (255,)
    l = tuple(min(255, int(c * 1.12)) for c in color) + (255,)
    for i in range(16):
        px[i, 0] = l; px[0, i] = l; px[i, 15] = e; px[15, i] = e
    for i in range(2, 14):
        px[i, 2] = l; px[2, i] = l; px[i, 13] = e; px[13, i] = e
    return im

def liquid_strip(frames, c0, c1, seed, alpha=190, scale=3.0):
    r = np.random.default_rng(seed)
    h = 16 * frames
    img = np.zeros((h, 16, 4), dtype=np.uint8)
    ph = r.random((4, 4)) * 6.283
    for f in range(frames):
        t = f / frames * 6.283
        for y in range(16):
            for x in range(16):
                v = 0.0
                for k in range(4):
                    v += math.sin((x * (k + 1) * 0.6 + y * (2 - k * 0.3) * 0.5) * scale / 3.0 + t * (k + 1) + ph[k % 4, (k * 3) % 4])
                v = (v / 4 + 1) / 2
                col = [int(c0[i] * (1 - v) + c1[i] * v) for i in range(3)]
                img[f * 16 + y, x] = (col[0], col[1], col[2], alpha)
    return fa(img)

def glass_tile(color, seed, alpha=110):
    im = Image.new("RGBA", (16, 16), (0, 0, 0, 0))
    px = im.load()
    edge = tuple(min(255, int(c * 1.3)) for c in color) + (255,)
    for i in range(16):
        px[i, 0] = edge; px[0, i] = edge; px[i, 15] = edge; px[15, i] = edge
    for x in range(1, 15):
        for y in range(1, 15):
            px[x, y] = tuple(color) + (alpha,)
    for i in range(3, 8):
        px[i, 10 - i] = tuple(min(255, c + 60) for c in color) + (alpha + 40,)
    return im

def cloud_tile(seed, base=(236, 240, 250)):
    return tile(base, 5, seed)

def grass_top_like(color, seed):
    return tile(color, 12, seed)

def side_with_top(top_img, side_img, rows=3):
    im = side_img.copy()
    im.paste(top_img.crop((0, 0, 16, rows)), (0, 0))
    px = im.load()
    r = np.random.default_rng(seed_of("side"))
    tp = top_img.load()
    for x in range(16):
        for y in range(rows, rows + 2):
            if r.random() < 0.5:
                px[x, y] = tp[x, y]
    return im

def seed_of(s):
    return int(hashlib.md5(s.encode()).hexdigest()[:8], 16)

def strip_frames(im, tile_h=16):
    return im

def pattern_tile(base, accent, seed, kind="tile"):
    im = tile(base, 5, seed)
    px = im.load()
    a = tuple(accent) + (255,)
    if kind == "tile":
        for i in range(16):
            px[i, 0] = a; px[0, i] = a; px[i, 8] = a; px[8, i] = a
    elif kind == "panel":
        for i in range(16):
            px[i, 0] = a; px[0, i] = a; px[15, i] = a; px[i, 15] = a
        for i in range(4, 12):
            px[i, 4] = a; px[4, i] = a; px[i, 11] = a; px[11, i] = a
    elif kind == "stripes":
        for y in range(16):
            if y % 4 == 0:
                for x in range(16):
                    px[x, y] = a
    elif kind == "glyph":
        for (x, y) in [(3, 3), (4, 3), (5, 3), (3, 4), (3, 5), (4, 6), (5, 7), (10, 3), (11, 3), (12, 4), (12, 5), (11, 6), (10, 7), (12, 7), (7, 10), (8, 10), (6, 11), (9, 11), (7, 12), (8, 12)]:
            px[x, y] = a
    elif kind == "logo_cc":
        d = ImageDraw.Draw(im)
        d.ellipse((2, 2, 13, 13), outline=a, width=2)
        d.ellipse((5, 5, 10, 10), fill=a)
    elif kind == "logo_rr":
        d = ImageDraw.Draw(im)
        d.rectangle((2, 5, 13, 10), fill=a)
        d.rectangle((4, 3, 11, 12), outline=(20, 20, 20, 255))
    elif kind == "star":
        d = ImageDraw.Draw(im)
        pts = []
        for k in range(10):
            ang = -math.pi / 2 + k * math.pi / 5; rr = 6 if k % 2 == 0 else 2.6
            pts.append((8 + math.cos(ang) * rr, 8 + math.sin(ang) * rr))
        d.polygon(pts, fill=a)
    return im

# ------------------------------------------------------------------ block texture sources
FT = lambda p: os.path.join(FUSED_TP, "blocks", p)
FM = lambda p: os.path.join(FUSED_MP, "blocks", p)
DB = lambda p: os.path.join(DMZ, "textures", "block", p)
DPB = lambda p: os.path.join(DMZP, "textures", "block", p)

SRC_MAP = {}
def m(key, path): SRC_MAP[key] = path
for i in range(5): m(f"stone{i}", FT(f"blocks/stone{i}.png"))
for i in range(3): m(f"cobblestone{i}", FT(f"blocks/cobblestone{i}.png"))
for i in range(7): m(f"dirt{i}", FT(f"blocks/dirt{i}.png"))
m("grass_top0", FT("grass/grass_block_top.png"))
for i in range(1, 9): m(f"grass_top{i}", FT(f"grass/grass_block_top{i}.png"))
m("grass_side_snowed", FT("grass_side_snowed.png")); m("podzol_side", FT("dirt_podzol_side.png")); m("mycelium_side", FT("mycelium_side.png"))
for i in range(8): m(f"grass_path_top{i}", FT(f"blocks/grass_path_top{i}.png"))
m("grass_path_side", FT("grass_path_side.png"))
for i in range(3): m(f"farmland_wet{i}", FT(f"blocks/farmland_wet{i}.png"))
m("farmland_side_dry", FT("farmland_side_dry.png")); m("farmland_side_wet", FT("farmland_side_wet.png"))
for w, s in [("oak", "log_oak"), ("spruce", "log_spruce"), ("birch", "log_birch"), ("jungle", "log_jungle"), ("acacia", "log_acacia"), ("big_oak", "log_big_oak")]:
    m(s, FT(f"{s}.png")); m(s + "_top", FT(f"{s}_top.png"))
m("cherry_log_side", FT("cherry_log_side.png")); m("cherry_log_top", FT("cherry_log_top.png"))
m("stripped_oak_log", FT("stripped_oak_log.png")); m("stripped_oak_log_top", FT("stripped_oak_log_top.png"))
for w, f in [("oak", "leaves_oak.tga"), ("spruce", "leaves_spruce.tga"), ("birch", "leaves_birch.tga"), ("jungle", "leaves_jungle.tga"), ("acacia", "leaves_acacia.tga"), ("dark_oak", "leaves_big_oak.tga")]:
    m(f"{w}_leaves", FM(f"leaves/{f}"))
m("cherry_leaves", FM("cherry_leaves.tga"))
for w, f in [("oak", "sapling_oak"), ("spruce", "sapling_spruce"), ("birch", "sapling_birch"), ("jungle", "sapling_jungle"), ("acacia", "sapling_acacia"), ("dark_oak", "sapling_roofed_oak"), ("cherry", "sapling_cherry")]:
    m(f"{w}_sapling", FM(f"{f}.png"))
for w, f in [("oak", "door_wood"), ("spruce", "door_spruce"), ("birch", "door_birch"), ("dark_oak", "door_dark_oak")]:
    m(f"{w}_door_upper", FT(f"{f}_upper.png")); m(f"{w}_door_lower", FT(f"{f}_lower.png"))
m("trapdoor", FT("trapdoor.png"))
for i in range(5): m(f"bookshelf{i}", FT(f"blocks/bookshelf{i}.png"))
for p in ["crafting_table_front", "crafting_table_side", "crafting_table_top", "hay_block_side", "hay_block_top", "reeds", "glass", "torch_on", "lantern", "ladder", "iron_bars"]:
    m(p, FT(p + ".png"))
m("melon_top0", FT("blocks/melon_top0.png")); m("pumpkin_top0", FT("blocks/pumpkin_top0.png"))
m("cactus_side", FT("plants/cactus/cactus0.png")); m("cactus_top", FT("plants/cactus/cactus_top1.png"))
for c in ["white", "blue", "light_blue", "yellow", "red"]:
    m(f"glass_{c}", FT(f"glass_{c}.png"))
for i in range(7): m(f"tallgrass{i}", FT(f"tallgrass/grass{i}.png"))
for i in range(4): m(f"fern{i}", FT(f"tallgrass/fern{i}.png"))
m("deadbush0", FT("plants/deadbush/deadbush.png"))
for i in range(1, 5): m(f"deadbush{i}", FT(f"plants/deadbush/deadbush{i}.png"))
for folder, base in [("dandelion", "flower_dandelion"), ("flower_rose", "flower_rose"), ("blue_orchid", "flower_blue_orchid"), ("allium", "flower_allium"), ("houstonia", "flower_houstonia"),
                     ("red_tulip", "flower_tulip_red"), ("orange_tulip", "flower_tulip_orange"), ("oxeye_daisy", "flower_oxeye_daisy"), ("cornflower", "flower_cornflower")]:
    m(f"{base}0", FT(f"flowers/{folder}/{base}.png"))
    for i in range(1, 4): m(f"{base}{i}", FT(f"flowers/{folder}/{base}_{i}.png"))
m("sunflower_bottom0", FT("plants/flowers/sunflower/bottom0.png")); m("sunflower_top0", FT("plants/flowers/sunflower/front0.png"))
m("lilac_bottom0", FT("plants/flowers/lilac/bottom1.png")); m("lilac_top0", FT("plants/flowers/lilac/top1.png"))
m("rose_bottom0", FT("plants/flowers/rose/bottom1.png")); m("rose_top0", FT("plants/flowers/rose/top1.png"))
m("large_grass_bottom0", FT("plants/large_grass/bottom0.png")); m("large_grass_top0", FT("plants/large_grass/top0.png"))
m("large_fern_bottom0", FT("plants/ferns/bottom0.png")); m("large_fern_top0", FT("plants/ferns/top0.png"))
for i in range(4): m(f"mushroom_brown{i}", FT(f"mushrooms/mushroom_brown{i}.png")); m(f"mushroom_red{i}", FT(f"mushrooms/mushroom_red{i}.png"))
for i in range(4): m(f"wheat{i}", FT(f"crops/wheat{i}.png"))
for c in ["carrots", "potatoes", "beetroots"]:
    for i in range(3): m(f"{c}{i}", FT(f"crops/{c}{i}.png"))
for i in range(7): m(f"vine{i}", FT(f"vines/vine{i}.png"))
for i in range(8): m(f"waterlily{i}", FT(f"waterlily/waterlily_{i}.png"))
# DragonMineZ blocks (same key names)
DMZ_BLOCKS = ["namek_grass_block_top", "namek_grass_block_side", "namek_grass_block_down", "namek_dirt", "namek_stone", "namek_cobblestone", "namek_deepslate", "namek_deepslate_top", "namek_block",
              "namek_coal_ore", "namek_iron_ore", "namek_gold_ore", "namek_diamond_ore", "namek_kikono_ore", "kikono_block", "namek_ajissa_log", "namek_ajissa_log_top", "namek_ajissa_planks",
              "namek_ajissa_leaves", "namek_ajissa_sapling", "namek_ajissa_door_top", "namek_ajissa_door_bottom", "namek_sacred_grass_block_top", "namek_sacred_grass_block_side", "namek_sacred_grass_block_down",
              "namek_sacred_log", "namek_sacred_log_top", "namek_sacred_planks", "namek_sacred_leaves", "namek_sacred_sapling", "sacred_planet_grass_block_top", "sacred_planet_grass_block_side", "sacred_planet_grass_block_down",
              "rocky_stone", "rocky_cobblestone", "rocky_dirt", "namek_grass", "namek_fern", "namek_sacred_grass", "sacred_fern", "chrysanthemum_flower", "amaryllis_flower", "marigold_flower", "catharanthus_roseus_flower",
              "trillium_flower", "sacred_chrysanthemum_flower", "sacred_trillium_flower", "otherworld_cloud", "time_chamber_block", "time_chamber_portal", "gete_block", "gete_debris_side", "gete_debris_top"]
for k in DMZ_BLOCKS: m(k, DB(k + ".png"))
for i in range(5): m(f"lotus_flower{i}", DB(f"lotus_flower{i}.png"))
m("vampa_sand", DPB("vampa_sand.png")); m("cereal_sand", DPB("cereal_sand.png"))

# ------------------------------------------------------------------ generated tiles
GEN = {}
def g(key, fn): GEN[key] = fn
STONE = (125, 125, 125); DIRT = (134, 96, 67)
g("mossy_cobblestone", lambda: ore_tile(stone_like((118, 120, 115), 11, cracks=6), (70, 120, 55), 12, n=14))
g("stone_bricks", lambda: bricks_tile((105, 105, 105), (128, 128, 128), 13, rows=2, cols=2))
g("bricks", lambda: bricks_tile((160, 150, 140), (150, 80, 65), 14, rows=4, cols=2))
g("coarse_dirt", lambda: ore_tile(tile(DIRT, 12, 15), (110, 110, 110), 16, n=10))
g("podzol_top", lambda: tile((94, 66, 40), 12, 17))
g("mycelium_top", lambda: tile((111, 99, 105), 10, 18))
g("farmland_dry", lambda: tile((120, 86, 58), 10, 19))
g("sand", lambda: tile((219, 207, 163), 8, 20)); g("red_sand", lambda: tile((190, 102, 33), 9, 21))
g("gravel", lambda: ore_tile(tile((131, 127, 126), 14, 22), (90, 88, 86), 23, n=12)); g("clay", lambda: tile((160, 166, 179), 6, 24))
g("sandstone_top", lambda: tile((222, 210, 160), 6, 25)); g("sandstone_side", lambda: pattern_tile((216, 203, 155), (196, 182, 130), 26, "stripes")); g("sandstone_bottom", lambda: tile((216, 203, 155), 6, 27))
g("bedrock", lambda: stone_like((80, 80, 80), 28, var=25, cracks=8)); g("obsidian", lambda: stone_like((22, 16, 36), 29, var=8, cracks=4))
g("snow", lambda: tile((245, 248, 252), 4, 30)); g("ice", lambda: glass_tile((140, 180, 245), 31, alpha=220))
g("water_still", lambda: liquid_strip(32, (35, 70, 200), (70, 120, 235), 32, alpha=200)); g("water_flow", lambda: liquid_strip(32, (30, 60, 190), (75, 125, 240), 33, alpha=200, scale=4.5))
g("lava_still", lambda: liquid_strip(20, (200, 60, 10), (255, 200, 60), 34, alpha=255)); g("lava_flow", lambda: liquid_strip(20, (190, 50, 5), (255, 190, 50), 35, alpha=255, scale=4.0))
STONE_TILE = lambda s: stone_like(STONE, s, var=9, cracks=3)
g("coal_ore", lambda: ore_tile(STONE_TILE(36), (30, 30, 30), 37)); g("iron_ore", lambda: ore_tile(STONE_TILE(38), (215, 175, 145), 39)); g("copper_ore", lambda: ore_tile(STONE_TILE(40), (200, 120, 70), 41))
g("gold_ore", lambda: ore_tile(STONE_TILE(42), (250, 220, 70), 43)); g("redstone_ore", lambda: ore_tile(STONE_TILE(44), (240, 30, 30), 45)); g("lapis_ore", lambda: ore_tile(STONE_TILE(46), (30, 70, 200), 47))
g("diamond_ore", lambda: ore_tile(STONE_TILE(48), (90, 235, 225), 49)); g("emerald_ore", lambda: ore_tile(STONE_TILE(50), (40, 210, 100), 51))
g("iron_block", lambda: metal_block((220, 220, 220), 52)); g("gold_block", lambda: metal_block((250, 215, 60), 53)); g("diamond_block", lambda: metal_block((100, 230, 225), 54))
for w, col in [("oak", (162, 130, 78)), ("spruce", (114, 84, 48)), ("birch", (196, 178, 123)), ("jungle", (160, 115, 80)), ("acacia", (170, 92, 52)), ("dark_oak", (66, 43, 21)), ("cherry", (226, 178, 172))]:
    g(f"{w}_planks", (lambda c, s: (lambda: planks_tile(c, s)))(col, 60 + len(w)))
g("melon_side", lambda: pattern_tile((80, 140, 40), (150, 200, 80), 70, "stripes")); g("pumpkin_side", lambda: pattern_tile((200, 120, 25), (170, 95, 20), 71, "stripes"))
g("pumpkin_face", lambda: pattern_tile((200, 120, 25), (30, 20, 10), 72, "glyph"))
g("furnace_top", lambda: stone_like((110, 110, 110), 73, cracks=2)); g("furnace_side", lambda: bricks_tile((95, 95, 95), (120, 120, 120), 74, rows=4, cols=2))
def furnace_front(lit):
    im = bricks_tile((95, 95, 95), (120, 120, 120), 75, rows=4, cols=2); d = ImageDraw.Draw(im)
    d.rectangle((3, 8, 12, 13), fill=(30, 30, 30, 255))
    if lit:
        d.rectangle((4, 9, 11, 12), fill=(255, 150, 40, 255)); d.rectangle((5, 10, 10, 12), fill=(255, 220, 90, 255))
    return im
g("furnace_front", lambda: furnace_front(False)); g("furnace_front_on", lambda: furnace_front(True))
g("chest_top", lambda: planks_tile((150, 105, 50), 76)); g("chest_side", lambda: pattern_tile((150, 105, 50), (95, 65, 30), 77, "panel"))
def chest_front():
    im = pattern_tile((150, 105, 50), (95, 65, 30), 78, "panel"); d = ImageDraw.Draw(im); d.rectangle((7, 6, 8, 9), fill=(60, 60, 60, 255)); return im
g("chest_front", chest_front)
for c, col in [("white", (235, 235, 235)), ("red", (170, 40, 40)), ("orange", (230, 120, 30)), ("yellow", (240, 200, 50)), ("blue", (50, 60, 170)), ("black", (25, 25, 30))]:
    g(f"wool_{c}", (lambda cc, s: (lambda: ore_tile(tile(cc, 10, s), tuple(max(0, v - 25) for v in cc), s + 1, n=10)))(col, 80 + len(c)))
for c, col in [("white", (205, 210, 210)), ("yellow", (240, 175, 20)), ("light_blue", (35, 140, 200)), ("orange", (225, 95, 0)), ("red", (140, 30, 30)), ("black", (10, 12, 15))]:
    g(f"concrete_{c}", (lambda cc, s: (lambda: tile(cc, 3, s)))(col, 90 + len(c)))
for c, col in [("orange", (160, 82, 36)), ("brown", (77, 50, 35)), ("white", (210, 178, 160)), ("red", (142, 60, 46)), ("yellow", (186, 133, 35))]:
    g(f"terracotta_{c}", (lambda cc, s: (lambda: tile(cc, 7, s)))(col, 100 + len(c)))
g("terracotta", lambda: tile((152, 94, 67), 7, 105))
g("quartz_side", lambda: tile((236, 233, 226), 3, 106)); g("quartz_top", lambda: tile((240, 237, 230), 3, 107)); g("smooth_stone", lambda: tile((160, 160, 160), 4, 108))
g("bone_block_side", lambda: pattern_tile((229, 225, 207), (200, 195, 175), 109, "stripes")); g("bone_block_top", lambda: pattern_tile((229, 225, 207), (200, 195, 175), 110, "tile"))
g("glowstone", lambda: ore_tile(tile((170, 130, 70), 15, 111), (255, 230, 150), 112, n=12))
g("vampa_rock", lambda: stone_like((120, 100, 80), 113, var=12, cracks=4)); g("cereal_rock", lambda: stone_like((176, 120, 75), 114, var=10, cracks=3))
g("hell_rock", lambda: stone_like((92, 40, 36), 115, var=14, cracks=5)); g("hell_rock_molten", lambda: ore_tile(stone_like((80, 30, 26), 116, var=10, cracks=5), (255, 140, 30), 117, n=9))
g("heaven_grass_top", lambda: tile((150, 215, 130), 10, 118)); g("heaven_dirt", lambda: tile((200, 180, 150), 8, 119))
g("heaven_grass_side", lambda: side_with_top(tile((150, 215, 130), 10, 118), tile((200, 180, 150), 8, 119)))
g("heaven_cloud", lambda: cloud_tile(120, (248, 246, 255)))
g("yardrat_grass_top", lambda: tile((150, 110, 190), 12, 121)); g("yardrat_dirt", lambda: tile((110, 80, 100), 9, 122)); g("yardrat_stone", lambda: stone_like((115, 100, 130), 123, var=9))
g("yardrat_grass_side", lambda: side_with_top(tile((150, 110, 190), 12, 121), tile((110, 80, 100), 9, 122)))
def yardrat_grass():
    im = load_rgba(FT("tallgrass/grass2.png")); return shift_hue_tint(im, (170, 120, 210), 1.0)
g("yardrat_grass", yardrat_grass)
g("vegeta_red_sand", lambda: tile((176, 78, 40), 9, 124)); g("asteroid_rock", lambda: stone_like((90, 88, 92), 125, var=14, cracks=6))
g("space_metal", lambda: metal_block((150, 158, 170), 126, dark=0.6))
g("kai_grass_top", lambda: tile((120, 200, 90), 10, 127)); g("kai_grass_side", lambda: side_with_top(tile((120, 200, 90), 10, 127), tile(DIRT, 10, 128)))
g("training_post", lambda: planks_tile((150, 110, 60), 129, dark=0.7))
g("gravity_device_side", lambda: pattern_tile((190, 190, 200), (90, 120, 200), 130, "panel")); g("gravity_device_top", lambda: pattern_tile((200, 200, 210), (255, 60, 60), 131, "logo_cc"))
g("kikono_station_side", lambda: pattern_tile((120, 60, 140), (200, 170, 230), 132, "panel")); g("kikono_station_top", lambda: pattern_tile((130, 70, 150), (240, 200, 255), 133, "tile"))
g("gete_forge_side", lambda: pattern_tile((70, 90, 110), (150, 220, 255), 134, "panel")); g("gete_forge_top", lambda: pattern_tile((80, 100, 120), (255, 160, 60), 135, "tile"))
g("capsule_corp_wall", lambda: tile((236, 232, 220), 4, 136)); g("capsule_corp_logo", lambda: pattern_tile((236, 232, 220), (240, 190, 40), 137, "logo_cc"))
g("kame_house_wall", lambda: tile((240, 170, 150), 6, 138)); g("kame_house_roof", lambda: pattern_tile((200, 50, 40), (150, 30, 25), 139, "stripes"))
g("frieza_ship_hull", lambda: metal_block((190, 190, 200), 140, dark=0.65)); g("frieza_ship_light", lambda: pattern_tile((190, 190, 200), (255, 90, 200), 141, "panel"))
g("cell_arena_tile", lambda: pattern_tile((225, 225, 225), (200, 200, 200), 142, "tile")); g("cell_arena_pillar", lambda: pattern_tile((215, 215, 215), (180, 180, 180), 143, "stripes"))
g("korin_tower_block", lambda: tile((238, 238, 245), 3, 144)); g("rr_metal", lambda: metal_block((165, 165, 170), 145, dark=0.6))
g("lab_tile", lambda: pattern_tile((180, 190, 190), (140, 150, 150), 146, "tile")); g("babidi_stone", lambda: stone_like((150, 140, 110), 147, var=10)); g("babidi_stone_glyph", lambda: pattern_tile((150, 140, 110), (120, 40, 140), 148, "glyph"))
g("king_kai_house_wall", lambda: tile((235, 235, 240), 4, 149)); g("halo_light", lambda: tile((255, 240, 160), 6, 150)); g("ki_barrier", lambda: glass_tile((120, 220, 255), 151, alpha=90))
g("dragon_ball_altar_side", lambda: pattern_tile((120, 110, 100), (200, 150, 40), 152, "panel")); g("dragon_ball_altar_top", lambda: pattern_tile((130, 120, 110), (255, 170, 30), 153, "star"))
g("snake_way", lambda: pattern_tile((225, 190, 80), (200, 160, 60), 154, "tile")); g("snake_way_edge", lambda: pattern_tile((215, 175, 70), (150, 110, 40), 155, "panel"))
g("lookout_tile", lambda: pattern_tile((240, 240, 240), (215, 215, 220), 156, "tile")); g("check_in_wood", lambda: planks_tile((190, 120, 60), 157))
g("snow_layer", lambda: tile((245, 248, 252), 4, 30))

def build_blocks():
    keys = [k.strip() for k in open(os.path.join(GAME, "data", "block_texture_keys.txt")) if k.strip()]
    outdir = os.path.join(A, "textures", "blocks")
    ensure(outdir)
    done = 0
    for key in keys:
        dst = os.path.join(outdir, key + ".png")
        im = None
        if key == "grass_side":
            dirt = load_rgba(FT("blocks/dirt0.png"))
            over = load_rgba(FT("grass_side.png"))
            base = np.array(dirt); base[..., 3] = 0  # dirt part: not tinted
            o = np.array(over)
            mask = o[..., 3] > 0
            base[mask] = o[mask]; base[mask, 3] = 255
            im = fa(base)
        elif key in SRC_MAP:
            p = SRC_MAP[key]
            if os.path.exists(p):
                im = load_rgba(p)
                stats["copied"] += 1
            else:
                stats["missing"].append(f"{key} <- {p}")
        if im is None and key in GEN:
            im = GEN[key](); stats["generated"] += 1
        if im is None:
            stats["missing"].append(key)
            im = tile((255, 0, 255), 0, 1)
        # Normalise: width 16, height multiple of 16 (animated strips keep their frames)
        if im.width != 16:
            im = im.resize((16, max(16, round(im.height * 16 / im.width))), Image.NEAREST)
        if im.height % 16 != 0:
            im = im.resize((16, 16), Image.NEAREST)
        save(im, dst); done += 1
    print(f"block tiles: {done} (copied {stats['copied']}, generated {stats['generated']})")

# ------------------------------------------------------------------ item icons
def draw_tool(kind, tier_color, handle=(120, 85, 45)):
    im = Image.new("RGBA", (16, 16), (0, 0, 0, 0)); px = im.load()
    h = handle + (255,); c = tuple(tier_color) + (255,); d = tuple(max(0, v - 60) for v in tier_color) + (255,)
    for i in range(9):
        px[3 + i, 12 - i] = h
        px[4 + i, 12 - i] = h
    if kind == "pickaxe":
        for i in range(8):
            px[4 + i, 4] = c; px[5 + i, 5] = d
        px[3, 5] = c; px[3, 6] = c; px[12, 5] = c; px[12, 6] = c; px[11, 3] = c
    elif kind == "axe":
        for y in range(3, 9):
            for x in range(8, 13): px[x, y] = c
        px[12, 3] = d; px[13, 5] = d; px[8, 8] = d
    elif kind == "shovel":
        for y in range(2, 7):
            for x in range(9, 13): px[x, y] = c
        px[9, 6] = d; px[12, 6] = d
    elif kind == "hoe":
        for x in range(8, 13): px[x, 4] = c
        px[12, 5] = c; px[12, 6] = c; px[8, 5] = d
    elif kind == "sword":
        for i in range(8):
            px[6 + i, 9 - i] = c; px[7 + i, 9 - i] = d
        px[5, 10] = (60, 60, 60, 255); px[4, 11] = (60, 60, 60, 255); px[5, 12] = (60, 60, 60, 255); px[6, 11] = (60, 60, 60, 255)
    return im

def draw_ingot(color):
    im = Image.new("RGBA", (16, 16), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    c = tuple(color); dk = tuple(max(0, v - 50) for v in color); lt = tuple(min(255, v + 40) for v in color)
    d.polygon([(2, 10), (5, 6), (13, 6), (10, 10)], fill=lt + (255,))
    d.rectangle((2, 10, 10, 13), fill=c + (255,))
    d.polygon([(10, 10), (13, 6), (13, 9), (10, 13)], fill=dk + (255,))
    return im

def draw_gem(color, shape="round"):
    im = Image.new("RGBA", (16, 16), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    c = tuple(color) + (255,); lt = tuple(min(255, v + 60) for v in color) + (255,); dk = tuple(max(0, v - 60) for v in color) + (255,)
    if shape == "round":
        d.ellipse((4, 4, 12, 12), fill=c, outline=dk); d.point((6, 6), fill=lt); d.point((7, 6), fill=lt)
    elif shape == "chunk":
        d.polygon([(4, 6), (8, 3), (12, 6), (11, 12), (5, 12)], fill=c, outline=dk); d.line((6, 6, 8, 5), fill=lt)
    elif shape == "dust":
        r = np.random.default_rng(1)
        for _ in range(18):
            x, y = int(r.integers(3, 13)), int(r.integers(5, 13)); d.point((x, y), fill=c)
    return im

def draw_food(kind):
    im = Image.new("RGBA", (16, 16), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    if kind == "bread":
        d.rounded_rectangle((2, 6, 13, 11), radius=3, fill=(196, 140, 70, 255), outline=(140, 90, 40, 255))
    elif kind == "carrot":
        d.polygon([(4, 12), (11, 5), (13, 7), (6, 14)], fill=(230, 120, 30, 255)); d.line((11, 5, 13, 2), fill=(60, 160, 40, 255), width=2)
    elif kind == "potato":
        d.ellipse((4, 5, 12, 12), fill=(200, 160, 100, 255), outline=(150, 110, 60, 255))
    elif kind == "baked_potato":
        d.ellipse((4, 5, 12, 12), fill=(215, 170, 95, 255), outline=(120, 80, 40, 255)); d.line((5, 8, 11, 8), fill=(120, 80, 40, 255))
    elif kind == "melon_slice":
        d.pieslice((2, 2, 14, 14), 180, 360, fill=(230, 70, 70, 255)); d.arc((2, 2, 14, 14), 180, 360, fill=(70, 150, 60, 255), width=2)
    elif kind == "egg":
        d.ellipse((5, 3, 11, 12), fill=(235, 225, 200, 255), outline=(180, 170, 140, 255))
    elif kind == "cooked_meat":
        d.rounded_rectangle((3, 5, 13, 12), radius=2, fill=(150, 80, 50, 255), outline=(90, 45, 25, 255))
    elif kind == "raw_meat":
        d.rounded_rectangle((3, 5, 13, 12), radius=2, fill=(220, 90, 90, 255), outline=(150, 40, 40, 255))
    elif kind == "bone":
        d.line((4, 12, 12, 4), fill=(235, 235, 220, 255), width=2); d.ellipse((2, 10, 6, 14), fill=(235, 235, 220, 255)); d.ellipse((10, 2, 14, 6), fill=(235, 235, 220, 255))
    elif kind == "string":
        d.line((3, 12, 6, 4, 9, 12, 12, 4), fill=(235, 235, 235, 255))
    elif kind == "leather":
        d.rounded_rectangle((3, 4, 13, 12), radius=2, fill=(170, 110, 60, 255), outline=(110, 70, 30, 255))
    elif kind == "feather":
        d.polygon([(4, 13), (8, 4), (12, 8)], fill=(240, 240, 240, 255), outline=(180, 180, 180, 255))
    elif kind == "book":
        d.rectangle((3, 3, 12, 13), fill=(120, 70, 40, 255)); d.rectangle((5, 4, 12, 12), fill=(235, 230, 210, 255))
    elif kind == "paper":
        d.rectangle((4, 3, 12, 13), fill=(240, 240, 235, 255), outline=(200, 200, 190, 255))
    elif kind == "bowl":
        d.polygon([(2, 7), (14, 7), (11, 12), (5, 12)], fill=(140, 100, 60, 255))
    elif kind == "sugar":
        d.polygon([(4, 12), (8, 4), (12, 12)], fill=(245, 245, 245, 255))
    elif kind == "flint":
        d.polygon([(4, 10), (8, 4), (12, 8), (9, 12)], fill=(60, 60, 65, 255))
    elif kind == "bucket":
        d.polygon([(3, 5), (13, 5), (11, 13), (5, 13)], fill=(170, 170, 175, 255), outline=(90, 90, 95, 255)); d.arc((4, 1, 12, 8), 180, 360, fill=(90, 90, 95, 255))
    elif kind == "water_bucket":
        d.polygon([(3, 5), (13, 5), (11, 13), (5, 13)], fill=(170, 170, 175, 255), outline=(90, 90, 95, 255)); d.rectangle((5, 6, 11, 8), fill=(50, 90, 220, 255)); d.arc((4, 1, 12, 8), 180, 360, fill=(90, 90, 95, 255))
    elif kind == "lava_bucket":
        d.polygon([(3, 5), (13, 5), (11, 13), (5, 13)], fill=(170, 170, 175, 255), outline=(90, 90, 95, 255)); d.rectangle((5, 6, 11, 8), fill=(240, 130, 30, 255)); d.arc((4, 1, 12, 8), 180, 360, fill=(90, 90, 95, 255))
    elif kind == "snowball":
        d.ellipse((4, 4, 12, 12), fill=(240, 245, 255, 255), outline=(200, 210, 230, 255))
    elif kind == "clay_ball":
        d.ellipse((4, 4, 12, 12), fill=(160, 166, 179, 255), outline=(120, 126, 140, 255))
    elif kind == "stick":
        d.line((4, 12, 12, 4), fill=(140, 100, 50, 255), width=2)
    elif kind == "seeds":
        for (x, y) in [(5, 6), (8, 5), (11, 7), (6, 10), (9, 11)]: d.ellipse((x, y, x + 2, y + 2), fill=(90, 150, 60, 255))
    elif kind == "senzu_bag":
        d.polygon([(4, 6), (12, 6), (13, 13), (3, 13)], fill=(150, 110, 60, 255)); d.line((4, 6, 12, 6), fill=(90, 60, 30, 255), width=2)
    elif kind == "capsule":
        d.rounded_rectangle((3, 6, 13, 10), radius=2, fill=(220, 220, 225, 255), outline=(100, 100, 110, 255)); d.rectangle((8, 6, 13, 10), fill=(220, 80, 60, 255))
    elif kind == "key":
        d.ellipse((2, 4, 7, 9), outline=(230, 190, 70, 255), width=2); d.line((7, 7, 14, 7), fill=(230, 190, 70, 255), width=2); d.line((12, 7, 12, 10), fill=(230, 190, 70, 255), width=2)
    elif kind == "space_suit":
        d.rounded_rectangle((3, 3, 13, 13), radius=3, fill=(230, 230, 235, 255), outline=(120, 120, 130, 255)); d.rectangle((5, 5, 11, 8), fill=(80, 140, 220, 255))
    return im

def iso_block_icon(top, side_a, side_b, size=32):
    """Render an isometric cube icon from three 16x16 tiles."""
    im = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    s = size / 2.0
    tp = np.array(top.convert("RGBA")); sa = np.array(side_a.convert("RGBA")); sb = np.array(side_b.convert("RGBA"))
    px = im.load()
    cx, cy = size / 2, size / 2
    for py in range(size):
        for pxx in range(size):
            X = (pxx + 0.5 - cx) / s; Y = (py + 0.5 - cy) / s
            # top face: rhombus centred at (0,-0.5) with half extents (1, 0.5)
            u = (X + 2 * (Y + 0.5)) / 2.0; v = (2 * (Y + 0.5) - X) / 2.0
            if 0 <= u < 1 and 0 <= v < 1:
                c = tp[int(v * 16), int(u * 16)]
                if c[3] > 0: px[pxx, py] = (int(c[0]), int(c[1]), int(c[2]), 255); continue
            # left face
            if -1 <= X < 0:
                yy = Y - (X + 1) * 0.5 - 0.0 + 0.5
                # left face spans from top edge y = -0.5 + (X+1)*0.5 -> ... let's compute using the rhombus edge
                top_edge = -0.5 + (X + 1) * (-0.5) + 0.5  # y of top-face edge at this X: from (-1,0) to (0,0.5)
                top_edge = (X + 1) * 0.5 - 0.5 + 0.5
                top_edge = 0.0 + X * 0.5 + 0.5
                vy = Y - top_edge
                if 0 <= vy < 1.0:
                    c = sa[int(vy * 16), int((X + 1) * 16)]
                    if c[3] > 0:
                        px[pxx, py] = (int(c[0] * 0.8), int(c[1] * 0.8), int(c[2] * 0.8), 255); continue
            if 0 <= X < 1:
                top_edge = 0.5 - X * 0.5
                vy = Y - top_edge
                if 0 <= vy < 1.0:
                    c = sb[int(vy * 16), int(X * 16)]
                    if c[3] > 0:
                        px[pxx, py] = (int(c[0] * 0.6), int(c[1] * 0.6), int(c[2] * 0.6), 255); continue
    return im

def build_items():
    blocks = json.load(open(os.path.join(GAME, "data", "blocks.json")))["blocks"]
    bt = os.path.join(A, "textures", "blocks")
    outdir = os.path.join(A, "textures", "items"); ensure(outdir)
    def tilef(key):
        p = os.path.join(bt, key + ".png")
        im = load_rgba(p) if os.path.exists(p) else tile((255, 0, 255), 0, 1)
        return im.crop((0, 0, 16, 16))
    n = 0
    for b in blocks:
        if b["id"] == "air": continue
        t = b.get("textures", {}); shape = b["shape"]
        allk = t.get("all", t.get("side", t.get("top", ""))); top = t.get("top", allk); side = t.get("side", allk); north = t.get("north", side)
        if b.get("variants") and ("all" in t or shape in ("cross", "crop")):
            allk = b["variants"][0]; top = t.get("top", allk); side = t.get("side", allk); north = t.get("north", side)
        if b.get("variants") and "top" in t:
            top = b["variants"][0]
        if shape in ("cube", "cutout_cube", "translucent_cube", "liquid", "fence", "slab_bottom"):
            ti, si, ni = tilef(top), tilef(north), tilef(side)
            tint = b.get("tint", "none")
            if tint in ("grass", "mask"):
                gc = (145, 189, 89)
                def apply(im, full):
                    a = np.array(im).astype(np.float32)
                    m = (a[..., 3] == 255) if not full else np.ones(a.shape[:2], bool)
                    a[m, :3] *= np.array(gc) / 255.0
                    a[..., 3] = 255
                    return fa(a.astype(np.uint8))
                ti = apply(ti, True) if b["id"] != "snowy_grass_block" else ti
                si = apply(si, False); ni = apply(ni, False)
            elif tint == "foliage":
                fc = (119, 171, 47)
                def apply2(im):
                    a = np.array(im).astype(np.float32); a[..., :3] *= np.array(fc) / 255.0; return fa(a.astype(np.uint8))
                ti, si, ni = apply2(ti), apply2(si), apply2(ni)
            if shape == "slab_bottom":
                icon = iso_block_icon(ti, ni, si); a = np.array(icon); a[:14, :, 3] = 0; icon = fa(a)
            else:
                icon = iso_block_icon(ti, ni, si)
        else:
            key = top if shape == "torch" else allk
            if shape == "door": key = t.get("top", allk)
            icon = tilef(key)
            if b.get("tint") in ("grass", "foliage"):
                a = np.array(icon).astype(np.float32); a[..., :3] *= np.array((119, 171, 47)) / 255.0; icon = fa(a.astype(np.uint8))
            icon = icon.resize((32, 32), Image.NEAREST)
        save(icon, os.path.join(outdir, f"block_{b['id']}.png")); n += 1
    print(f"block icons: {n}")
    # DMZ + DMZ+ item textures (verbatim)
    c = 0
    for src_root in [os.path.join(DMZ, "textures", "item"), os.path.join(DMZP, "textures", "item")]:
        for dp, dn, fn in os.walk(src_root):
            for f in fn:
                if not f.endswith(".png"): continue
                rel = os.path.relpath(os.path.join(dp, f), src_root)
                dst = os.path.join(outdir, rel)
                ensure(os.path.dirname(dst)); shutil.copy2(os.path.join(dp, f), dst); c += 1
    for name, srcf in [("apple", "apple.png"), ("beetroot", "beetroot.png"), ("wheat_seeds", "seeds_wheat.png"), ("stick", "stick.png"), ("wheat", "wheat.png")]:
        p = os.path.join(FUSED_TP, "items", srcf)
        if os.path.exists(p): shutil.copy2(p, os.path.join(outdir, name + ".png")); c += 1
    print(f"item textures copied: {c}")
    # generated items
    tiers = {"wooden": (150, 110, 60), "stone": (130, 130, 130), "iron": (220, 220, 220), "golden": (250, 215, 60), "diamond": (100, 230, 225), "kikono": (200, 120, 240), "gete": (120, 200, 230)}
    gcount = 0
    for tier, col in tiers.items():
        for kind in ["pickaxe", "axe", "shovel", "hoe", "sword"]:
            save(draw_tool(kind, col), os.path.join(outdir, f"{tier}_{kind}.png")); gcount += 1
    for name, col in [("iron_ingot", (220, 220, 220)), ("gold_ingot", (250, 215, 60)), ("copper_ingot", (200, 120, 70)), ("raw_iron", (190, 160, 140)), ("raw_copper", (180, 110, 70)), ("raw_gold", (220, 190, 80))]:
        save(draw_ingot(col), os.path.join(outdir, name + ".png")); gcount += 1
    for name, col, shape in [("coal", (40, 40, 40), "chunk"), ("diamond", (90, 235, 225), "chunk"), ("emerald", (40, 210, 100), "chunk"), ("redstone", (240, 30, 30), "dust"), ("lapis_lazuli", (30, 70, 200), "chunk"), ("glowstone_dust", (255, 230, 150), "dust"), ("kikono_dust", (200, 120, 240), "dust")]:
        save(draw_gem(col, shape), os.path.join(outdir, name + ".png")); gcount += 1
    for kind in ["bread", "carrot", "potato", "baked_potato", "melon_slice", "egg", "cooked_meat", "raw_meat", "bone", "string", "leather", "feather", "book", "paper", "bowl", "sugar", "flint", "bucket", "water_bucket", "lava_bucket", "snowball", "clay_ball", "seeds", "senzu_bag", "capsule", "key", "space_suit"]:
        save(draw_food(kind), os.path.join(outdir, kind + ".png")); gcount += 1
    save(draw_food("seeds"), os.path.join(outdir, "beetroot_seeds.png")); save(draw_food("seeds"), os.path.join(outdir, "melon_seeds.png")); save(draw_food("seeds"), os.path.join(outdir, "pumpkin_seeds.png"))
    print(f"generated item icons: {gcount}")

# ------------------------------------------------------------------ copies
def copy_tree(src, dst, exts=(".png",), rename=None, flatten=False):
    n = 0
    if not os.path.isdir(src):
        print("  (missing source)", src); return 0
    for dp, dn, fn in os.walk(src):
        for f in fn:
            if not f.lower().endswith(exts): continue
            rel = os.path.relpath(os.path.join(dp, f), src)
            if flatten: rel = f
            if rename: rel = rename(rel)
            if rel is None: continue
            d = os.path.join(dst, rel); ensure(os.path.dirname(d))
            shutil.copy2(os.path.join(dp, f), d); n += 1
    return n

def build_entities_and_gui():
    T = os.path.join(A, "textures")
    n = copy_tree(os.path.join(DMZ, "textures", "entity"), os.path.join(T, "entity"))
    n += copy_tree(os.path.join(DMZP_DMZ, "textures", "entity"), os.path.join(T, "entity"))
    n += copy_tree(os.path.join(DMZP, "textures", "entity"), os.path.join(T, "entity", "dmzplus"))
    n += copy_tree(os.path.join(HD, "dragonminez", "textures", "entity"), os.path.join(T, "entity", "hd"))
    print(f"entity textures: {n}")
    n = copy_tree(os.path.join(DMZ, "textures", "armor"), os.path.join(T, "armor"))
    n += copy_tree(os.path.join(HD, "dragonminez", "textures", "armor"), os.path.join(T, "armor", "hd"))
    n += copy_tree(os.path.join(DMZP, "textures", "models", "armor"), os.path.join(T, "armor"))
    print(f"armor textures: {n}")
    n = copy_tree(os.path.join(DMZ, "textures", "gui"), os.path.join(T, "gui"))
    n += copy_tree(os.path.join(HD, "dragonminez", "textures", "gui"), os.path.join(T, "gui", "hd"))
    n += copy_tree(os.path.join(HD, "minecraft", "textures", "gui"), os.path.join(T, "gui"), rename=lambda r: r.replace("container/", ""))
    n += copy_tree(os.path.join(DMZ_MC, "textures", "gui"), os.path.join(T, "gui", "mc"))
    n += copy_tree(os.path.join(DMZP, "textures", "gui"), os.path.join(T, "gui", "dmzplus"))
    n += copy_tree(os.path.join(DMZ, "textures", "mob_effect"), os.path.join(T, "gui", "effects"))
    n += copy_tree(os.path.join(HD, "dragonminez", "textures", "mob_effect"), os.path.join(T, "gui", "effects", "hd"))
    n += copy_tree(os.path.join(DMZ, "textures", "attribute_icon"), os.path.join(T, "gui", "attributes"))
    print(f"gui textures: {n}")
    n = copy_tree(os.path.join(DMZ, "textures", "particle"), os.path.join(T, "particles"))
    n += copy_tree(os.path.join(HD, "dragonminez", "textures", "particle"), os.path.join(T, "particles", "hd"))
    n += copy_tree(os.path.join(AAA, "effeks"), os.path.join(T, "particles", "aaa"), rename=lambda r: r.replace("/Texture/", "/").replace("/Resources/", "/"))
    n += copy_tree(os.path.join(FUSED_TP, "particle"), os.path.join(T, "particles", "fused"))
    print(f"particle textures: {n}")
    n = copy_tree(os.path.join(DMZP, "textures", "environment"), os.path.join(T, "environment"))
    n += copy_tree(os.path.join(FUSED_TP, "environment"), os.path.join(T, "environment"))
    n += copy_tree(os.path.join(FUSED_TP, "colormap"), os.path.join(T, "misc", "colormap"))
    n += copy_tree(os.path.join(DMZ, "textures", "block", "custom"), os.path.join(T, "misc", "dball_blocks"))
    for f in ["dball1", "dball2", "dball3", "dball4", "dball5", "dball6", "dball7", "dball1_namek"]:
        p = DB(f + ".png")
        if os.path.exists(p): shutil.copy2(p, out(os.path.join(T, "misc", "dball", f + ".png"))); n += 1
    print(f"environment/misc textures: {n}")
    # crack overlays + crosshair
    for i in range(4):
        im = Image.new("RGBA", (16, 16), (0, 0, 0, 0)); d = ImageDraw.Draw(im); r = np.random.default_rng(300 + i)
        for _ in range(4 + i * 5):
            x, y = int(r.integers(0, 16)), int(r.integers(0, 16))
            for _ in range(int(r.integers(2, 6))):
                nx, ny = min(15, max(0, x + int(r.integers(-1, 2)))), min(15, max(0, y + int(r.integers(-1, 2))))
                d.line((x, y, nx, ny), fill=(20, 20, 20, 170 + i * 20)); x, y = nx, ny
        save(im, os.path.join(T, "misc", f"crack_{i}.png"))
    # copy the DMZ logo/icon for menus
    for f in ["dmz_logo.png", "dmz_icon.png"]:
        p = os.path.join(SRC, "dmz", f)
        if os.path.exists(p): shutil.copy2(p, out(os.path.join(T, "misc", f)))

def build_models_and_anims():
    n = copy_tree(os.path.join(DMZ, "geo"), os.path.join(A, "models"), exts=(".json",))
    n += copy_tree(os.path.join(DMZP, "geo"), os.path.join(A, "models", "dmzplus"), exts=(".json",))
    n += copy_tree(os.path.join(HD, "dragonminez", "geo"), os.path.join(A, "models", "hd"), exts=(".json",))
    print(f"models: {n}")
    n = copy_tree(os.path.join(DMZ, "animations"), os.path.join(A, "animations"), exts=(".json",))
    n += copy_tree(os.path.join(DMZP, "animations"), os.path.join(A, "animations", "dmzplus"), exts=(".json",))
    n += copy_tree(os.path.join(HD, "dragonminez", "animations"), os.path.join(A, "animations", "hd"), exts=(".json",))
    print(f"animations: {n}")

def build_audio():
    sfx = os.path.join(A, "audio", "sfx"); bgm = os.path.join(A, "audio", "bgm"); ensure(sfx); ensure(bgm)
    n = 0
    src = os.path.join(DMZ, "sounds")
    for f in sorted(os.listdir(src)):
        if not f.endswith(".ogg"): continue
        if f.startswith("menu_music-") or f in ("call_for_a_miracle.ogg", "gokus_father-son_victory.ogg", "vegetas_sacrifice.ogg"):
            shutil.copy2(os.path.join(src, f), os.path.join(bgm, f))
        else:
            shutil.copy2(os.path.join(src, f), os.path.join(sfx, f))
        n += 1
    aaa_s = os.path.join(AAA, "sounds", "loot_beam")
    if os.path.isdir(aaa_s):
        for f in sorted(os.listdir(aaa_s)):
            shutil.copy2(os.path.join(aaa_s, f), os.path.join(sfx, "loot_" + f)); n += 1
    print(f"audio files: {n}")

def write_credits_data():
    """List of imported third-party asset groups for CREDITS.md."""
    data = {
        "fused_vanilla": "Fused Vanilla Texture Pack / Models Pack v1.0-1.1 by Fused Bolt (user-supplied Bedrock packs)",
        "dmz_hd": "DMZ HD Texturepack 2.1 by ZoneMC (user-supplied)",
        "dragonminez": "DragonMineZ 2.1.3 by the DragonMineZ team, GPL-3.0-or-later (models, animations, sounds, gui, textures, quest data)",
        "dmzplus": "DMZ Plus 1.1.6 by Kiziro Akami, GPL-3.0-or-later (planets, sky textures; Milky Way panorama by ESO/S. Brunier CC BY 4.0)",
        "aaa_particles_world": "AAA Particles: World 2.0.0 by ChloePrime, MIT (particle sprites, loot sounds)",
        "monocraft": "Monocraft font by Idrees Hassan, SIL OFL 1.1",
    }
    json.dump(data, open(os.path.join(A, "SOURCES.json"), "w"), indent=1)

if __name__ == "__main__":
    if args.clean:
        for d in ["textures", "models", "animations", "audio"]:
            p = os.path.join(A, d)
            if os.path.isdir(p): shutil.rmtree(p)
    build_blocks()
    build_items()
    build_entities_and_gui()
    build_models_and_anims()
    build_audio()
    write_credits_data()
    write_imports()
    if stats["missing"]:
        print("MISSING (%d):" % len(stats["missing"]))
        for mm in stats["missing"]: print("  ", mm)
    print("done")
