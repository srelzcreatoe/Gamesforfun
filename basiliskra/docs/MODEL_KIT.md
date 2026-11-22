# Basiliskra model kit — designer contract

Each form is ONE Python design file in `tools/kit/forms/`. `build()` returns a `kit.Model`. From it the kit
writes the Bedrock geometry, the colour / glow / PBR textures, the rig table and an editable `.bbmodel`.
Nothing is hand-edited afterwards: the design file is the source.

## Commands (run from `basiliskra/tools/kit` and `basiliskra/tools/preview`)

    cd basiliskra/tools/kit     && python3 build_models.py i          # or ii / iii  (10-40 s)
    cd basiliskra/tools/preview && node render.cjs sheet i --out /path/sheet.png            # 6 views + 2-block player
    node render.cjs sheet i --zoom eye_l --out /path/zoom.png                               # 4 close views of a bone/locator
    node render.cjs sheet i --glow 1 --night --out /path/glow.png                           # emissive layer fully lit, at night
    node render.cjs view i --yaw 20 --pitch 6 --fov 30 --dist 40 --target 0,2,6 --size 1500x560 --out /path/v.png
    python3 ../kit/compare.py REF.png X0,Y0,X1,Y1 /path/v.png /path/cmp.png                 # reference crop beside render

`view`: `--yaw 0` looks at the animal's LEFT side, 90 from the front, 180 right side, 270 from behind;
`--target` is in blocks (x, y, z; the animal's front is -z), `--at <bone|locator>` aims at a part instead;
`--pose pose.json` applies `{ "bone": {"rot":[x,y,z], "pos":[x,y,z]} }` (Bedrock animation convention) to preview a pose.
Always LOOK at the PNG (Read tool) after a change. Judge faces from close-ups, never from a full-body shot.

## Space

Bedrock file space. Units = 1/16 block. +Y up. **-Z is the FRONT of the animal. +X is the animal's LEFT.**
y = 0 is where the entity stands (ground / belly bottom). Rotations are Bedrock degrees `(rx, ry, rz)`:
rx < 0 tips the front (-Z side) UP, rx > 0 tips it down; ry > 0 turns the front towards the animal's RIGHT (-X);
rz > 0 leans the top towards +X (the animal's left). A bone's rest rotation is about its pivot; ALL pivots and cubes
are written in the un-rotated layout (as in a .geo.json), children inherit.

## API (see `kit.py`, `parts.py`, and the finished example `forms/form3.py`)

    m = Model("basiliskra_i", "geometry.basiliskra.i", seed=101)
    m.meta.update(glow_y0=<low y>, glow_y1=<spine y>, wetness=0..1, bounds_margin=6.0, form=1)
    b = m.bone(name, parent, pivot=(x,y,z), rot=(rx,ry,rz), zone=<0..8 or None>)     # zone inherits from the parent
    b.cube((x0,y0,z0), (w,h,d), "material", rot=(..), pivot=(..), **painter_params)   # origin = min corner
    b.box(cx,cy,cz, w,h,d, "material", ...)                                           # by centre
    b.locator("name", (x,y,z))
    kit.barrel(b, z0, z1, cy, half_w, half_h, **params)     # rounded body slice (3 boxes), runs along Z
    kit.column(b, x, z, y0, y1, half_x, half_z, **params)   # rounded vertical limb slice
    parts.eye(m, parent, "eye_l", +1, x, y, z, size=4, depth=2)      # tiny pale eye in its own bone (+ locator)
    parts.gill_set(m, parent, side, x_surface, y0, z0, n=3, height, pitch, lean, closed=False, zone=7)  # slits + flap bones gill_l1..3 / gill_r1..3
    parts.tooth_row(...), parts.claws(...), parts.spike(...), parts.blunt_plate(...), parts.plate(...)

Materials (painters in `paint.py`): `skin` (charcoal scale hide; params `scale=(a,b)` cell size in texels,
`belly_y=<local y below which the lighter belly plates are painted>`, `back_y=(y0,y1)` darkens towards the spine,
`bias=±` lighter/darker, `veins=0..1` glow strength), `belly`, `plate` / `spike` (crimson, param `g=(root, tip)` along
`axis`), `horn`, `fin` (crimson membrane: `axis` = direction root→free edge (0=x,1=y,2=z), `g=(root, edge)`,
`ray_axis`, `ray_w`, `ragged=0..1` cuts a torn alpha edge), `web`, `gill`, `gillscar`, `mouth`, `tongue`, `ivory`
(teeth/claws; `g`, `axis`), `eye`, `rock`, `scar` (the pale notch), `pit` (nostrils).
You may add form-specific painters INSIDE YOUR OWN design file: `import paint; paint.MATERIALS["my_mat"] = fn`
(copy the signature of an existing painter: returns `(rgb, alpha, glow_rgba, (metal, rough, subsurface))`).

Rules that keep the pack clean:
* No zero-thickness boxes (membranes are 1-2 units thick). Avoid coplanar overlapping faces: offset by >= 0.5.
* Overlap neighbouring body segments by ~8 units so bending never opens a gap.
* Texel density is fixed at 1 texel per unit (16 px per block); only eyes use `tex_scale=2` (parts.eye does it).
* Budget: <= 1500 cubes, atlas must pack within 2048x1024 (the build prints both).
* Keep every bone and locator name in your contract EXACTLY: animation and server code are written against them.
* Every glow zone must contain lit bones (the build writes `tools/kit/out/rig_<form>.json` with `glow_zones`).

**Drawn size.** The models (and the `.bbmodel` files) are at their modelled size. In game, forms II and III are
drawn larger than that: `DRAW_SCALE` in `tools/kit/kit.py` (II 1.25, III 1.7) becomes the client entity's Molang
`scale`, multiplies the geometry's visible bounds, and is written to `src/generated/rig.ts` (`SCALE`) so the server
multiplies every model-space point by it too (mouth, feet, club, hit volumes). The walk is solved in model units
(`STRIDE_III_MODEL`) and driven by world distance (`STRIDE_III` = model stride x scale). Change the number in one
place and rebuild with `python3 tools/build.py --assets`; then check the window pose (`WINDOW_CROUCH` in
`gen_client.py`, `WINDOW_STANDOFF` in `src/forms/three.ts`) and the scenario suite's window check.
