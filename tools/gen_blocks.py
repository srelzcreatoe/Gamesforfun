#!/usr/bin/env python3
"""Generates game/data/blocks.json (the block registry).

The order of blocks is the numeric id order: APPEND ONLY once saves exist.
Texture keys refer to game/assets/textures/blocks/<key>.png produced by build_assets.py.
"""
import json, os, sys

OUT = os.path.join(os.path.dirname(__file__), "..", "game", "data", "blocks.json")
blocks = []

def B(id, name=None, shape="cube", tex=None, **kw):
    b = {"id": id, "name": name or id.replace("_", " ").title(), "shape": shape}
    if tex is not None:
        if isinstance(tex, str):
            b["textures"] = {"all": tex}
        else:
            b["textures"] = tex
    b.update(kw)
    blocks.append(b)
    return b

def cube(id, name=None, tex=None, material="stone", hardness=1.5, tool="pickaxe", min_tier=0, **kw):
    return B(id, name, "cube", tex, material=material, hardness=hardness, tool=tool, min_tier=min_tier, **kw)

def plant(id, name=None, tex=None, **kw):
    kw.setdefault("material", "plant"); kw.setdefault("hardness", 0.0); kw.setdefault("tool", "none")
    kw.setdefault("plant", {"needs": ["grass_block", "dirt", "podzol", "coarse_dirt", "namek_grass_block", "namek_sacred_grass_block", "sacred_planet_grass_block", "heaven_grass_block", "yardrat_grass_block", "farmland"]})
    return B(id, name, "cross", tex, **kw)

def leaves(id, name, tex, tint="foliage", sapling=None):
    drops = [{"item": sapling, "count": 1, "chance": 0.05}] if sapling else []
    return B(id, name, "cutout_cube", tex, material="leaves", hardness=0.2, tool="none", tint=tint, drops=drops, flammable=True)

def log(id, name, side, top, planks):
    return cube(id, name, {"side": side, "top": top, "bottom": top}, material="wood", hardness=2.0, tool="axe", flammable=True, rotatable=True)

def ore(id, name, tex, drop, min_tier=1, hardness=3.0, xp=1):
    return cube(id, name, tex, hardness=hardness, min_tier=min_tier, drops=[{"item": drop, "count": 1}])

# ---------------------------------------------------------------- Earth
B("air", "Air", "none")
cube("stone", "Stone", "stone0", variants=[f"stone{i}" for i in range(5)], drops=[{"item": "cobblestone", "count": 1}])
cube("cobblestone", "Cobblestone", "cobblestone0", variants=[f"cobblestone{i}" for i in range(3)], hardness=2.0)
cube("mossy_cobblestone", "Mossy Cobblestone", "mossy_cobblestone", hardness=2.0)
cube("stone_bricks", "Stone Bricks", "stone_bricks", hardness=1.5)
cube("bricks", "Bricks", "bricks", hardness=2.0)
cube("dirt", "Dirt", "dirt0", variants=[f"dirt{i}" for i in range(7)], material="earth", hardness=0.5, tool="shovel")
cube("coarse_dirt", "Coarse Dirt", "coarse_dirt", material="earth", hardness=0.5, tool="shovel")
cube("grass_block", "Grass Block", {"top": "grass_top0", "side": "grass_side", "bottom": "dirt0"}, variants=[f"grass_top{i}" for i in range(9)], material="earth", hardness=0.6, tool="shovel", tint="mask", drops=[{"item": "dirt", "count": 1}])
cube("snowy_grass_block", "Snowy Grass Block", {"top": "snow", "side": "grass_side_snowed", "bottom": "dirt0"}, material="snow", hardness=0.6, tool="shovel", drops=[{"item": "dirt", "count": 1}])
cube("podzol", "Podzol", {"top": "podzol_top", "side": "podzol_side", "bottom": "dirt0"}, material="earth", hardness=0.5, tool="shovel", drops=[{"item": "dirt", "count": 1}])
cube("mycelium", "Mycelium", {"top": "mycelium_top", "side": "mycelium_side", "bottom": "dirt0"}, material="earth", hardness=0.6, tool="shovel", drops=[{"item": "dirt", "count": 1}])
cube("grass_path", "Dirt Path", {"top": "grass_path_top0", "side": "grass_path_side", "bottom": "dirt0"}, variants=[f"grass_path_top{i}" for i in range(8)], material="earth", hardness=0.6, tool="shovel", drops=[{"item": "dirt", "count": 1}], height=0.9375)
cube("farmland", "Farmland", {"top": "farmland_dry", "side": "farmland_side_dry", "bottom": "dirt0"}, material="earth", hardness=0.6, tool="shovel", drops=[{"item": "dirt", "count": 1}], height=0.9375)
cube("farmland_wet", "Wet Farmland", {"top": "farmland_wet0", "side": "farmland_side_wet", "bottom": "dirt0"}, variants=["farmland_wet0", "farmland_wet1", "farmland_wet2"], material="earth", hardness=0.6, tool="shovel", drops=[{"item": "dirt", "count": 1}], height=0.9375)
cube("sand", "Sand", "sand", material="sand", hardness=0.5, tool="shovel", gravity=True)
cube("red_sand", "Red Sand", "red_sand", material="sand", hardness=0.5, tool="shovel", gravity=True)
cube("gravel", "Gravel", "gravel", material="sand", hardness=0.6, tool="shovel", gravity=True, drops=[{"item": "gravel", "count": 1}])
cube("clay", "Clay", "clay", material="earth", hardness=0.6, tool="shovel", drops=[{"item": "clay_ball", "count": 4}])
cube("sandstone", "Sandstone", {"top": "sandstone_top", "side": "sandstone_side", "bottom": "sandstone_bottom"}, hardness=0.8)
cube("bedrock", "Bedrock", "bedrock", hardness=-1, drops=[])
cube("obsidian", "Obsidian", "obsidian", hardness=50.0, min_tier=4)
cube("snow_block", "Snow Block", "snow", material="snow", hardness=0.2, tool="shovel", drops=[{"item": "snowball", "count": 4}])
B("snow_layer", "Snow", "snow_layer", "snow", material="snow", hardness=0.1, tool="shovel", drops=[{"item": "snowball", "count": 1}], height=0.125)
cube("ice", "Ice", "ice", material="ice", hardness=0.5, drops=[], slippery=True)
B("water", "Water", "liquid", "water_still", material="liquid", hardness=-1, drops=[], animated={"frames": 32, "fps": 10}, flow={"spread": 7, "tick": 5, "lava": False}, flow_texture="water_flow", tint="water", light_attenuation=2)
B("lava", "Lava", "liquid", "lava_still", material="liquid", hardness=-1, drops=[], animated={"frames": 20, "fps": 4}, flow={"spread": 3, "tick": 30, "lava": True}, flow_texture="lava_flow", light=15, damage=4)
# ores
ore("coal_ore", "Coal Ore", "coal_ore", "coal", min_tier=1)
ore("iron_ore", "Iron Ore", "iron_ore", "raw_iron", min_tier=2)
ore("copper_ore", "Copper Ore", "copper_ore", "raw_copper", min_tier=2)
ore("gold_ore", "Gold Ore", "gold_ore", "raw_gold", min_tier=3)
ore("redstone_ore", "Redstone Ore", "redstone_ore", "redstone", min_tier=3)
ore("lapis_ore", "Lapis Lazuli Ore", "lapis_ore", "lapis_lazuli", min_tier=2)
ore("diamond_ore", "Diamond Ore", "diamond_ore", "diamond", min_tier=3)
ore("emerald_ore", "Emerald Ore", "emerald_ore", "emerald", min_tier=3)
cube("iron_block", "Block of Iron", "iron_block", material="metal", hardness=5.0, min_tier=2)
cube("gold_block", "Block of Gold", "gold_block", material="metal", hardness=3.0, min_tier=3)
cube("diamond_block", "Block of Diamond", "diamond_block", material="metal", hardness=5.0, min_tier=3)
# wood families
WOODS = [("oak", "Oak", "log_oak", "log_oak_top"), ("spruce", "Spruce", "log_spruce", "log_spruce_top"),
         ("birch", "Birch", "log_birch", "log_birch_top"), ("jungle", "Jungle", "log_jungle", "log_jungle_top"),
         ("acacia", "Acacia", "log_acacia", "log_acacia_top"), ("dark_oak", "Dark Oak", "log_big_oak", "log_big_oak_top"),
         ("cherry", "Cherry", "cherry_log_side", "cherry_log_top")]
for wid, wname, side, top in WOODS:
    log(f"{wid}_log", f"{wname} Log", side, top, f"{wid}_planks")
    if wid == "oak":
        log(f"stripped_{wid}_log", f"Stripped {wname} Log", f"stripped_{wid}_log", f"stripped_{wid}_log_top", f"{wid}_planks")
    cube(f"{wid}_planks", f"{wname} Planks", f"{wid}_planks", material="wood", hardness=2.0, tool="axe", flammable=True)
    leaves(f"{wid}_leaves", f"{wname} Leaves", f"{wid}_leaves", tint="none" if wid == "cherry" else "foliage", sapling=f"{wid}_sapling")
    plant(f"{wid}_sapling", f"{wname} Sapling", f"{wid}_sapling", sapling=wid)
    if wid in ("oak", "spruce", "birch", "dark_oak"):
        B(f"{wid}_fence", f"{wname} Fence", "fence", f"{wid}_planks", material="wood", hardness=2.0, tool="axe", flammable=True)
        B(f"{wid}_door", f"{wname} Door", "door", {"top": f"{wid}_door_upper", "bottom": f"{wid}_door_lower"}, material="wood", hardness=3.0, tool="axe")
B("oak_trapdoor", "Oak Trapdoor", "trapdoor", "trapdoor", material="wood", hardness=3.0, tool="axe")
cube("bookshelf", "Bookshelf", {"side": "bookshelf0", "top": "oak_planks", "bottom": "oak_planks"}, variants=["bookshelf0", "bookshelf1", "bookshelf2", "bookshelf3", "bookshelf4"], material="wood", hardness=1.5, tool="axe", flammable=True, drops=[{"item": "book", "count": 3}])
cube("crafting_table", "Crafting Table", {"top": "crafting_table_top", "side": "crafting_table_side", "north": "crafting_table_front", "bottom": "oak_planks"}, material="wood", hardness=2.5, tool="axe", station="crafting_table", interactive=True)
cube("furnace", "Furnace", {"top": "furnace_top", "side": "furnace_side", "north": "furnace_front", "bottom": "furnace_top"}, hardness=3.5, station="furnace", interactive=True, rotatable=True)
cube("furnace_lit", "Lit Furnace", {"top": "furnace_top", "side": "furnace_side", "north": "furnace_front_on", "bottom": "furnace_top"}, hardness=3.5, station="furnace", interactive=True, light=13, rotatable=True, drops=[{"item": "furnace", "count": 1}])
cube("chest", "Chest", {"top": "chest_top", "side": "chest_side", "north": "chest_front", "bottom": "chest_top"}, material="wood", hardness=2.5, tool="axe", container=27, interactive=True, rotatable=True)
cube("hay_block", "Hay Bale", {"top": "hay_block_top", "side": "hay_block_side", "bottom": "hay_block_top"}, material="cloth", hardness=0.5, tool="hoe", flammable=True)
cube("melon", "Melon", {"top": "melon_top0", "side": "melon_side", "bottom": "melon_top0"}, material="plant", hardness=1.0, tool="axe", drops=[{"item": "melon_slice", "count": 5}])
cube("pumpkin", "Pumpkin", {"top": "pumpkin_top0", "side": "pumpkin_side", "north": "pumpkin_face", "bottom": "pumpkin_top0"}, material="plant", hardness=1.0, tool="axe", rotatable=True)
B("cactus", "Cactus", "cactus", {"side": "cactus_side", "top": "cactus_top", "bottom": "cactus_top"}, material="plant", hardness=0.4, tool="none", damage=1, plant={"needs": ["sand", "red_sand", "vampa_sand", "cereal_sand"]})
B("sugar_cane", "Sugar Cane", "cross", "reeds", material="plant", hardness=0.0, tool="none", plant={"needs": ["grass_block", "dirt", "sand", "sugar_cane", "namek_grass_block"]})
B("glass", "Glass", "cutout_cube", "glass", material="glass", hardness=0.3, drops=[])
for col, cname in [("white", "White"), ("blue", "Blue"), ("light_blue", "Light Blue"), ("yellow", "Yellow"), ("red", "Red")]:
    B(f"{col}_stained_glass", f"{cname} Stained Glass", "translucent_cube", f"glass_{col}", material="glass", hardness=0.3, drops=[])
B("torch", "Torch", "torch", "torch_on", material="wood", hardness=0.0, tool="none", light=14)
B("lantern", "Lantern", "torch", "lantern", material="metal", hardness=3.5, light=15, animated={"frames": 3, "fps": 6})
B("ladder", "Ladder", "ladder", "ladder", material="wood", hardness=0.4, tool="axe")
B("iron_bars", "Iron Bars", "fence", "iron_bars", material="metal", hardness=5.0, min_tier=2)
# plants
B("short_grass", "Grass", "cross", "tallgrass0", variants=[f"tallgrass{i}" for i in range(7)], material="plant", hardness=0.0, tool="none", tint="grass", drops=[{"item": "wheat_seeds", "count": 1, "chance": 0.125}], replaceable=True)
B("fern", "Fern", "cross", "fern0", variants=[f"fern{i}" for i in range(4)], material="plant", hardness=0.0, tool="none", tint="grass", replaceable=True)
B("dead_bush", "Dead Bush", "cross", "deadbush0", variants=[f"deadbush{i}" for i in range(5)], material="plant", hardness=0.0, tool="none", drops=[{"item": "stick", "count": 1, "chance": 0.5}], replaceable=True)
FLOWERS = [("dandelion", "Dandelion", "flower_dandelion"), ("poppy", "Poppy", "flower_rose"), ("blue_orchid", "Blue Orchid", "flower_blue_orchid"),
           ("allium", "Allium", "flower_allium"), ("azure_bluet", "Azure Bluet", "flower_houstonia"), ("red_tulip", "Red Tulip", "flower_tulip_red"),
           ("orange_tulip", "Orange Tulip", "flower_tulip_orange"),
           ("oxeye_daisy", "Oxeye Daisy", "flower_oxeye_daisy"), ("cornflower", "Cornflower", "flower_cornflower")]
for fid, fname, ftex in FLOWERS:
    plant(fid, fname, f"{ftex}0", variants=[f"{ftex}{i}" for i in range(4)])
for did, dname, dtex in [("sunflower", "Sunflower", "sunflower"), ("lilac", "Lilac", "lilac"), ("rose_bush", "Rose Bush", "rose"), ("tall_grass", "Tall Grass", "large_grass"), ("large_fern", "Large Fern", "large_fern")]:
    tint = "grass" if did in ("tall_grass", "large_fern") else "none"
    B(did, dname, "cross", {"all": f"{dtex}_bottom0", "top": f"{dtex}_top0"}, material="plant", hardness=0.0, tool="none", tint=tint, double=True, plant={"needs": ["grass_block", "dirt", "podzol"]})
plant("brown_mushroom", "Brown Mushroom", "mushroom_brown0", variants=[f"mushroom_brown{i}" for i in range(4)], light=1)
plant("red_mushroom", "Red Mushroom", "mushroom_red0", variants=[f"mushroom_red{i}" for i in range(4)])
for cid, cname, ctex, stages, seed_item, produce in [("wheat", "Wheat", "wheat", 4, "wheat_seeds", "wheat"), ("carrots", "Carrots", "carrots", 3, "carrot", "carrot"),
                                                     ("potatoes", "Potatoes", "potatoes", 3, "potato", "potato"), ("beetroots", "Beetroots", "beetroots", 3, "beetroot_seeds", "beetroot")]:
    B(cid, cname, "crop", f"{ctex}0", material="plant", hardness=0.0, tool="none", plant={"needs": ["farmland", "farmland_wet"], "growth_stages": stages, "stage_textures": [f"{ctex}{i}" for i in range(stages)], "seed": seed_item, "produce": produce}, drops=[{"item": seed_item, "count": 1}])
B("vine", "Vines", "ladder", "vine0", variants=[f"vine{i}" for i in range(7)], material="plant", hardness=0.2, tool="none", tint="foliage", drops=[], climbable=True)
B("lily_pad", "Lily Pad", "waterlily", "waterlily0", variants=[f"waterlily{i}" for i in range(8)], material="plant", hardness=0.0, tool="none", tint="foliage", plant={"needs": ["water"]})
for col, cname in [("white", "White"), ("red", "Red"), ("orange", "Orange"), ("yellow", "Yellow"), ("blue", "Blue"), ("black", "Black")]:
    cube(f"{col}_wool", f"{cname} Wool", f"wool_{col}", material="cloth", hardness=0.8, tool="none", flammable=True)
for col, cname in [("white", "White"), ("yellow", "Yellow"), ("light_blue", "Light Blue"), ("orange", "Orange"), ("red", "Red"), ("black", "Black")]:
    cube(f"{col}_concrete", f"{cname} Concrete", f"concrete_{col}", hardness=1.8)
for col, cname in [("orange", "Orange"), ("brown", "Brown"), ("white", "White"), ("red", "Red"), ("yellow", "Yellow")]:
    cube(f"{col}_terracotta", f"{cname} Terracotta", f"terracotta_{col}", hardness=1.25)
cube("terracotta", "Terracotta", "terracotta", hardness=1.25)
cube("quartz_block", "Block of Quartz", {"side": "quartz_side", "top": "quartz_top", "bottom": "quartz_top"}, hardness=0.8)
cube("smooth_stone", "Smooth Stone", "smooth_stone", hardness=2.0)
B("stone_slab", "Stone Slab", "slab_bottom", "smooth_stone", material="stone", hardness=2.0, tool="pickaxe")
B("oak_slab", "Oak Slab", "slab_bottom", "oak_planks", material="wood", hardness=2.0, tool="axe")
cube("bone_block", "Bone Block", {"side": "bone_block_side", "top": "bone_block_top", "bottom": "bone_block_top"}, hardness=2.0)
cube("glowstone", "Glowstone", "glowstone", material="glass", hardness=0.3, light=15, drops=[{"item": "glowstone_dust", "count": 3}])
# ---------------------------------------------------------------- DragonMineZ / Namek
cube("namek_grass_block", "Namek Grass Block", {"top": "namek_grass_block_top", "side": "namek_grass_block_side", "bottom": "namek_grass_block_down"}, material="earth", hardness=0.6, tool="shovel", drops=[{"item": "namek_dirt", "count": 1}])
cube("namek_dirt", "Namek Dirt", "namek_dirt", material="earth", hardness=0.5, tool="shovel")
cube("namek_stone", "Namek Stone", "namek_stone", hardness=1.5, drops=[{"item": "namek_cobblestone", "count": 1}])
cube("namek_cobblestone", "Namek Cobblestone", "namek_cobblestone", hardness=2.0)
cube("namek_deepslate", "Namek Deepslate", {"side": "namek_deepslate", "top": "namek_deepslate_top", "bottom": "namek_deepslate_top"}, hardness=3.0)
cube("namek_block", "Planet Namek Block", "namek_block", hardness=2.0)
ore("namek_coal_ore", "Namek Coal Ore", "namek_coal_ore", "coal", min_tier=1)
ore("namek_iron_ore", "Namek Iron Ore", "namek_iron_ore", "raw_iron", min_tier=2)
ore("namek_gold_ore", "Namek Gold Ore", "namek_gold_ore", "raw_gold", min_tier=3)
ore("namek_diamond_ore", "Namek Diamond Ore", "namek_diamond_ore", "diamond", min_tier=3)
ore("namek_kikono_ore", "Namek Kikono Ore", "namek_kikono_ore", "kikono_shard", min_tier=3, hardness=4.0)
cube("kikono_block", "Kikono Block", "kikono_block", material="metal", hardness=5.0, min_tier=3)
log("ajissa_log", "Ajissa Log", "namek_ajissa_log", "namek_ajissa_log_top", "ajissa_planks")
cube("ajissa_planks", "Ajissa Planks", "namek_ajissa_planks", material="wood", hardness=2.0, tool="axe", flammable=True)
leaves("ajissa_leaves", "Ajissa Leaves", "namek_ajissa_leaves", tint="none", sapling="ajissa_sapling")
plant("ajissa_sapling", "Ajissa Sapling", "namek_ajissa_sapling", sapling="ajissa")
B("ajissa_fence", "Ajissa Fence", "fence", "namek_ajissa_planks", material="wood", hardness=2.0, tool="axe")
B("ajissa_door", "Ajissa Door", "door", {"top": "namek_ajissa_door_top", "bottom": "namek_ajissa_door_bottom"}, material="wood", hardness=3.0, tool="axe")
cube("namek_sacred_grass_block", "Namek Sacred Grass Block", {"top": "namek_sacred_grass_block_top", "side": "namek_sacred_grass_block_side", "bottom": "namek_sacred_grass_block_down"}, material="earth", hardness=0.6, tool="shovel", drops=[{"item": "namek_dirt", "count": 1}])
log("sacred_log", "Sacred Log", "namek_sacred_log", "namek_sacred_log_top", "sacred_planks")
cube("sacred_planks", "Sacred Planks", "namek_sacred_planks", material="wood", hardness=2.0, tool="axe", flammable=True)
leaves("sacred_leaves", "Sacred Leaves", "namek_sacred_leaves", tint="none", sapling="sacred_sapling")
plant("sacred_sapling", "Sacred Sapling", "namek_sacred_sapling", sapling="sacred")
B("sacred_fence", "Sacred Fence", "fence", "namek_sacred_planks", material="wood", hardness=2.0, tool="axe")
cube("sacred_planet_grass_block", "Sacred Planet Grass Block", {"top": "sacred_planet_grass_block_top", "side": "sacred_planet_grass_block_side", "bottom": "sacred_planet_grass_block_down"}, material="earth", hardness=0.6, tool="shovel", drops=[{"item": "dirt", "count": 1}])
cube("rocky_stone", "Rocky Stone", "rocky_stone", hardness=1.5, drops=[{"item": "rocky_cobblestone", "count": 1}])
cube("rocky_cobblestone", "Rocky Cobblestone", "rocky_cobblestone", hardness=2.0)
cube("rocky_dirt", "Rocky Dirt", "rocky_dirt", material="earth", hardness=0.5, tool="shovel")
B("namek_grass", "Namek Grass", "cross", "namek_grass", material="plant", hardness=0.0, tool="none", replaceable=True)
B("namek_fern", "Namek Fern", "cross", "namek_fern", material="plant", hardness=0.0, tool="none", replaceable=True)
B("namek_sacred_grass", "Namek Sacred Grass", "cross", "namek_sacred_grass", material="plant", hardness=0.0, tool="none", replaceable=True)
B("sacred_fern", "Sacred Fern", "cross", "sacred_fern", material="plant", hardness=0.0, tool="none", replaceable=True)
for fid, fname in [("chrysanthemum", "Chrysanthemum"), ("amaryllis", "Amaryllis"), ("marigold", "Marigold"), ("catharanthus_roseus", "Catharanthus Roseus"), ("trillium", "Trillium")]:
    plant(f"{fid}_flower", fname, f"{fid}_flower")
    if fid in ("chrysanthemum", "trillium"):
        plant(f"sacred_{fid}_flower", f"Sacred {fname}", f"sacred_{fid}_flower")
B("lotus_flower", "Lotus", "waterlily", "lotus_flower0", variants=[f"lotus_flower{i}" for i in range(5)], material="plant", hardness=0.0, tool="none", plant={"needs": ["water"]})
cube("otherworld_cloud", "Otherworld Cloud", "otherworld_cloud", material="cloud", hardness=0.3, tool="none")
cube("time_chamber_block", "Hyperbolic Time Chamber Block", "time_chamber_block", hardness=-1, drops=[])
B("time_chamber_portal", "Time Chamber Portal", "cube", "time_chamber_portal", material="special", hardness=-1, drops=[], light=10, portal="time_chamber", solid=False)
cube("gete_block", "Gete Block", "gete_block", material="metal", hardness=6.0, min_tier=3)
cube("gete_debris_ore", "Gete Debris", {"side": "gete_debris_side", "top": "gete_debris_top", "bottom": "gete_debris_top"}, hardness=4.0, min_tier=3, drops=[{"item": "gete_scrap", "count": 2}])
cube("snake_way", "Snake Way Stone", "snake_way", hardness=-1, drops=[])
cube("snake_way_edge", "Snake Way Edge", "snake_way_edge", hardness=-1, drops=[])
cube("lookout_tile", "Lookout Tile", "lookout_tile", hardness=3.0)
cube("check_in_wood", "Check-In Station Wood", "check_in_wood", material="wood", hardness=2.0, tool="axe")
# ---------------------------------------------------------------- DMZ+ planets
cube("vampa_sand", "Vampa Sand", "vampa_sand", material="sand", hardness=0.5, tool="shovel", gravity=True)
cube("vampa_rock", "Vampa Rock", "vampa_rock", hardness=1.5)
cube("cereal_sand", "Cereal Sand", "cereal_sand", material="sand", hardness=0.5, tool="shovel", gravity=True)
cube("cereal_rock", "Cereal Rock", "cereal_rock", hardness=1.5)
cube("hell_rock", "Hell Rock", "hell_rock", hardness=2.0)
cube("hell_rock_molten", "Molten Hell Rock", "hell_rock_molten", hardness=2.0, light=8, damage=1)
cube("heaven_grass_block", "Heaven Grass Block", {"top": "heaven_grass_top", "side": "heaven_grass_side", "bottom": "heaven_dirt"}, material="earth", hardness=0.6, tool="shovel", drops=[{"item": "heaven_dirt", "count": 1}])
cube("heaven_dirt", "Heaven Dirt", "heaven_dirt", material="earth", hardness=0.5, tool="shovel")
cube("heaven_cloud", "Heaven Cloud", "heaven_cloud", material="cloud", hardness=0.3, tool="none")
cube("yardrat_grass_block", "Yardrat Grass Block", {"top": "yardrat_grass_top", "side": "yardrat_grass_side", "bottom": "yardrat_dirt"}, material="earth", hardness=0.6, tool="shovel", drops=[{"item": "yardrat_dirt", "count": 1}])
cube("yardrat_dirt", "Yardrat Dirt", "yardrat_dirt", material="earth", hardness=0.5, tool="shovel")
cube("yardrat_stone", "Yardrat Stone", "yardrat_stone", hardness=1.5)
B("yardrat_grass", "Yardrat Grass", "cross", "yardrat_grass", material="plant", hardness=0.0, tool="none", replaceable=True)
cube("vegeta_red_sand", "Vegeta Red Sand", "vegeta_red_sand", material="sand", hardness=0.5, tool="shovel", gravity=True)
cube("asteroid_rock", "Asteroid Rock", "asteroid_rock", hardness=2.5)
cube("space_metal", "Space Metal Plating", "space_metal", material="metal", hardness=5.0, min_tier=2)
cube("kai_grass_block", "Kai Grass Block", {"top": "kai_grass_top", "side": "kai_grass_side", "bottom": "dirt0"}, material="earth", hardness=0.6, tool="shovel", drops=[{"item": "dirt", "count": 1}])
cube("training_post", "Training Post", "training_post", material="wood", hardness=2.0, tool="axe", interactive=True, station="training")
cube("gravity_device", "Gravity Device", {"side": "gravity_device_side", "top": "gravity_device_top", "bottom": "space_metal"}, material="metal", hardness=5.0, min_tier=2, interactive=True, station="gravity")
cube("kikono_station", "Dr. Kikono's Station", {"side": "kikono_station_side", "top": "kikono_station_top", "bottom": "space_metal"}, material="metal", hardness=5.0, min_tier=2, interactive=True, station="kikono_station")
cube("gete_forge", "Gete Forge", {"side": "gete_forge_side", "top": "gete_forge_top", "bottom": "space_metal"}, material="metal", hardness=5.0, min_tier=3, interactive=True, station="gete_forge", light=6)
cube("capsule_corp_wall", "Capsule Corp Wall", "capsule_corp_wall", hardness=2.0)
cube("capsule_corp_logo", "Capsule Corp Logo", {"side": "capsule_corp_wall", "north": "capsule_corp_logo", "top": "capsule_corp_wall", "bottom": "capsule_corp_wall"}, hardness=2.0, rotatable=True)
cube("kame_house_wall", "Kame House Wall", "kame_house_wall", material="wood", hardness=2.0, tool="axe")
cube("kame_house_roof", "Kame House Roof", "kame_house_roof", material="wood", hardness=2.0, tool="axe")
cube("frieza_ship_hull", "Frieza Ship Hull", "frieza_ship_hull", material="metal", hardness=8.0, min_tier=3)
cube("frieza_ship_light", "Frieza Ship Light", "frieza_ship_light", material="metal", hardness=8.0, min_tier=3, light=13)
cube("cell_arena_tile", "Cell Games Tile", "cell_arena_tile", hardness=3.0)
cube("cell_arena_pillar", "Cell Games Pillar", "cell_arena_pillar", hardness=3.0)
cube("korin_tower_block", "Korin Tower Block", "korin_tower_block", hardness=-1, drops=[])
cube("rr_metal", "Red Ribbon Metal", "rr_metal", material="metal", hardness=5.0, min_tier=2)
cube("lab_tile", "Lab Tile", "lab_tile", hardness=3.0)
cube("babidi_stone", "Babidi Ship Stone", "babidi_stone", hardness=3.0)
cube("babidi_stone_glyph", "Babidi Glyph Stone", "babidi_stone_glyph", hardness=3.0, light=4)
cube("king_kai_house_wall", "King Kai House Wall", "king_kai_house_wall", hardness=2.0)
B("halo_light", "Halo Light", "cube", "halo_light", material="glass", hardness=0.5, tool="none", light=15)
B("ki_barrier", "Ki Barrier", "translucent_cube", "ki_barrier", material="special", hardness=-1, drops=[], light=6)
B("dragon_ball_altar", "Dragon Ball Altar", "cube", {"side": "dragon_ball_altar_side", "top": "dragon_ball_altar_top", "bottom": "smooth_stone"}, material="stone", hardness=4.0, tool="pickaxe", interactive=True, station="altar")

n = len(blocks)
assert blocks[0]["id"] == "air"
ids = [b["id"] for b in blocks]
assert len(ids) == len(set(ids)), "duplicate ids"
if n > 256:
    print("TOO MANY BLOCKS:", n); sys.exit(1)
with open(OUT, "w") as f:
    json.dump({"blocks": blocks}, f, indent=1)
keys = set()
for b in blocks:
    keys.update(b.get("textures", {}).values()); keys.update(b.get("variants", []))
    keys.update(b.get("plant", {}).get("stage_textures", []))
    if b.get("flow_texture"): keys.add(b["flow_texture"])
print(f"wrote {n} blocks, {len(keys)} texture keys -> {os.path.relpath(OUT)}")
with open(os.path.join(os.path.dirname(__file__), "..", "game", "data", "block_texture_keys.txt"), "w") as f:
    f.write("\n".join(sorted(keys)) + "\n")
