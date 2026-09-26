#!/usr/bin/env python3
"""Generate Workspace/Map.model.json in the style of the original Steal a Brainrot.

Studded plastic everywhere, a red carpet conveyor between two tunnels, eight
grey garage-style bases with wooden signs and green collect pads, long carpets
from the conveyor to each base, the Robux Shop and Gear Shop stalls, global
leaderboards and a dirt-and-grass border. The scripts find parts by name, so
the layout can also be edited in Studio afterwards. Run from the StealABrainrot folder:

    python3 tools/generate_map.py
"""

import json
import math
from pathlib import Path

OUTPUT = Path(__file__).resolve().parent.parent / "Workspace" / "Map.model.json"


def yaw(degrees):
    """Rotation about Y as the three rows of a rotation matrix.

    A part's front (-Z) faces (-sin, 0, -cos) of the angle: 0 faces -Z,
    180 faces +Z, -90 faces +X and 90 faces -X.
    """
    r = math.radians(degrees)
    c, s = round(math.cos(r), 6), round(math.sin(r), 6)
    return [[c, 0, s], [0, 1, 0], [-s, 0, c]]


IDENTITY = yaw(0)

PLOT_X = [-150, -50, 50, 150]
PLOT_Z = 80
PLOT_WIDTH = 56
PLOT_DEPTH = 60
FLOORS = 4
FLOOR_HEIGHT = 14
WALL_HEIGHT = FLOORS * FLOOR_HEIGHT
DOOR_WIDTH = 16
DOOR_HEIGHT = 14
# Stairs run along the inside of the front wall, left and right of the door,
# alternating sides floor by floor.
STAIR_STEPS = 14
STAIR_LANE = 4.5
CONVEYOR_LENGTH = 460
CONVEYOR_WIDTH = 14
# From the conveyor's edge to a base's door.
CARPET_LENGTH = PLOT_Z - PLOT_DEPTH / 2 - CONVEYOR_WIDTH / 2
BORDER_X = 290
BORDER_Z = 165

GRASS = (0.29, 0.75, 0.25)
DIRT = (0.56, 0.36, 0.2)
CARPET = (0.85, 0.16, 0.16)
FLOOR = (0.72, 0.73, 0.76)
WALL = (0.36, 0.38, 0.44)
DARK = (0.12, 0.13, 0.17)
WOOD = (0.55, 0.36, 0.21)
WHITE = (0.96, 0.96, 0.96)
LASER = (1.0, 0.1, 0.1)
PAD = (0.2, 0.85, 0.3)
ACCENTS = [
    (0.2, 0.8, 1.0),
    (1.0, 0.5, 0.15),
    (0.35, 1.0, 0.35),
    (1.0, 0.3, 0.85),
    (1.0, 0.85, 0.15),
    (0.3, 1.0, 0.85),
    (0.65, 0.4, 1.0),
    (1.0, 0.35, 0.4),
]

STUDS = {"TopSurface": "Studs", "BottomSurface": "Inlet"}
ALL_STUDS = {
    "TopSurface": "Studs",
    "BottomSurface": "Inlet",
    "FrontSurface": "Studs",
    "BackSurface": "Studs",
    "LeftSurface": "Studs",
    "RightSurface": "Studs",
}
SMOOTH = {"TopSurface": "Smooth", "BottomSurface": "Smooth"}


def rotate(matrix, vector):
    return [sum(matrix[row][col] * vector[col] for col in range(3)) for row in range(3)]


def multiply(a, b):
    return [[sum(a[i][k] * b[k][j] for k in range(3)) for j in range(3)] for i in range(3)]


def part(name, size, position, rotation, color, material="Plastic", surfaces=None, children=None, **extra):
    properties = {
        "Anchored": True,
        "Size": list(size),
        "CFrame": {"CFrame": {"position": [round(v, 4) for v in position], "orientation": rotation}},
        "Material": material,
        "Color": list(color),
    }
    properties.update(surfaces if surfaces is not None else SMOOTH)
    properties.update(extra)
    node = {"Name": name, "ClassName": "Part", "Properties": properties}
    if children:
        node["Children"] = children
    return node


def hidden(name, size, position, rotation):
    return part(name, size, position, rotation, WHITE, Transparency=1, CanCollide=False, CanQuery=False, CanTouch=False)


def folder(name, children):
    return {"Name": name, "ClassName": "Folder", "Children": children}


def model(name, children):
    return {"Name": name, "ClassName": "Model", "Children": children}


def point_light(brightness, range_, color=(1, 1, 1), always_on=False):
    """A light; street lamps only shine at night, `always_on` ones (inside the
    bases and on the Fuse Machine) always do (see WorldManager)."""
    node = {
        "Name": "Light",
        "ClassName": "PointLight",
        "Properties": {"Brightness": brightness, "Range": range_, "Color": list(color), "Shadows": False},
    }
    if always_on:
        node["attributes"] = {"AlwaysOn": True}
    return node


class Frame:
    """Places parts relative to an origin and a rotation."""

    def __init__(self, origin, rotation):
        self.origin = origin
        self.rotation = rotation

    def at(self, local):
        offset = rotate(self.rotation, local)
        return [self.origin[i] + offset[i] for i in range(3)]

    def turned(self, local_rotation):
        return multiply(self.rotation, local_rotation)


def floor_top(floor):
    """Height of the top of a floor (1 = ground floor)."""
    return 1 + (floor - 1) * FLOOR_HEIGHT


def stair_side(floor):
    """-1 = the stairs from this floor go up on the left, 1 = on the right."""
    return -1 if floor % 2 == 1 else 1


def build_stairs(f, r, floor, accent):
    """Solid steps from `floor` up to the next one, plus markers for the
    walking path (bottom and top step)."""
    half_width = PLOT_WIDTH / 2
    half_depth = PLOT_DEPTH / 2
    side = stair_side(floor)
    start_x = DOOR_WIDTH / 2 + 0.5
    run = (half_width - 2 - start_x) / STAIR_STEPS
    lane_z = -half_depth + 2 + STAIR_LANE / 2
    base = floor_top(floor)
    steps = []
    for i in range(1, STAIR_STEPS + 1):
        x = side * (start_x + run * (i - 0.5))
        colour = accent if i % 2 == 0 else (0.62, 0.64, 0.68)
        steps.append(part(f"Step{floor}_{i}", (run, i, STAIR_LANE), f.at([x, base + i / 2, lane_z]), r, colour, surfaces=STUDS))
    bottom_x = side * (start_x + run * 0.5)
    top_x = side * (start_x + run * (STAIR_STEPS - 0.5))
    steps.append(hidden(f"StairBottom{floor}", (1, 1, 1), f.at([bottom_x, base + 1.5, lane_z]), r))
    steps.append(hidden(f"StairTop{floor}", (1, 1, 1), f.at([top_x, base + STAIR_STEPS + 0.5, lane_z]), r))
    return steps


def build_slab(f, r, floor):
    """The floor above the ground floor, with a hole over the stairs below."""
    half_width = PLOT_WIDTH / 2
    half_depth = PLOT_DEPTH / 2
    inner_width = PLOT_WIDTH - 4
    top = floor_top(floor)
    lane_front = -half_depth + 2
    lane_back = lane_front + STAIR_LANE
    main_depth = (half_depth - 2) - lane_back
    parts = [
        part(
            f"Slab{floor}",
            (inner_width, 1, main_depth),
            f.at([0, top - 0.5, lane_back + main_depth / 2]),
            r,
            (0.66, 0.68, 0.72),
            surfaces=STUDS,
        )
    ]
    # The strip along the front wall, open above the last steps below.
    below_side = stair_side(floor - 1)
    hole = 10
    strip = inner_width - hole
    strip_x = -below_side * (half_width - 2 - strip / 2)
    parts.append(
        part(
            f"SlabFront{floor}",
            (strip, 1, STAIR_LANE),
            f.at([strip_x, top - 0.5, lane_front + STAIR_LANE / 2]),
            r,
            (0.66, 0.68, 0.72),
            surfaces=STUDS,
        )
    )
    # Rails around the hole so nobody walks off by accident.
    rail_x = below_side * (half_width - 2 - hole)
    parts.append(part(f"Rail{floor}", (0.4, 2.5, STAIR_LANE), f.at([rail_x, top + 1.25, lane_front + STAIR_LANE / 2]), r, WHITE))
    return parts


WINDOW_BOTTOM = 3.5  # above each floor
WINDOW_TOP = 10.5
GLASS = (0.72, 0.88, 1.0)


def build_wall(f, r, name, along, fixed, lo, hi, windows, floors, outward):
    """A wall with real see-through windows: solid bands between the window
    rows, pillars between the windows and a glass pane with a sill in each.
    `along` is "x" (front and back walls, at z = fixed) or "z" (side walls,
    at x = fixed); `windows` are (centre, width) along the wall, on each of
    `floors`; `outward` (+1/-1) is the outside direction."""
    base, top = 1, 1 + WALL_HEIGHT

    def box(part_name, a0, a1, y0, y1, colour=WALL, material="SmoothPlastic", thickness=2, offset=0, **extra):
        length, height, middle, y = a1 - a0, y1 - y0, (a0 + a1) / 2, (y0 + y1) / 2
        across = fixed + offset * outward
        if along == "x":
            return part(part_name, (length, height, thickness), f.at([middle, y, across]), r, colour, material, **extra)
        return part(part_name, (thickness, height, length), f.at([across, y, middle]), r, colour, material, **extra)

    rows = [(floor_top(k) + WINDOW_BOTTOM, floor_top(k) + WINDOW_TOP) for k in floors]
    pieces = []
    y = base
    for number, (row_bottom, row_top) in enumerate(rows, start=1):
        pieces.append(box(f"{name}Band{number}", lo, hi, y, row_bottom, surfaces=ALL_STUDS))
        edge = lo
        for window, (centre, width) in enumerate(windows, start=1):
            left, right = centre - width / 2, centre + width / 2
            if left > edge:
                pieces.append(box(f"{name}Pillar{number}_{window}", edge, left, row_bottom, row_top, surfaces=ALL_STUDS))
            pieces.append(
                box(f"{name}Glass{number}_{window}", left, right, row_bottom, row_top, GLASS, "Glass", thickness=0.4, Transparency=0.55, Reflectance=0.25)
            )
            pieces.append(box(f"{name}Sill{number}_{window}", left - 0.5, right + 0.5, row_bottom - 0.4, row_bottom, WHITE, thickness=0.8, offset=1.3))
            edge = right
        if hi > edge:
            pieces.append(box(f"{name}Pillar{number}_end", edge, hi, row_bottom, row_top, surfaces=ALL_STUDS))
        y = row_top
    pieces.append(box(f"{name}Top", lo, hi, y, top, surfaces=ALL_STUDS))
    return pieces


def build_plot(index, origin, rotation):
    f = Frame(origin, rotation)
    r = rotation
    half_width = PLOT_WIDTH / 2
    half_depth = PLOT_DEPTH / 2
    wall_y = 1 + WALL_HEIGHT / 2
    roof_y = 1 + WALL_HEIGHT + 0.5
    front_piece = (PLOT_WIDTH - DOOR_WIDTH) / 2 - 1
    front_x = DOOR_WIDTH / 2 + front_piece / 2
    lintel_height = WALL_HEIGHT - DOOR_HEIGHT
    accent = ACCENTS[index - 1]

    children = [
        part("Floor", (PLOT_WIDTH, 1, PLOT_DEPTH), f.at([0, 0.5, 0]), r, FLOOR, surfaces=STUDS),
        part(
            "WallAboveDoor",
            (DOOR_WIDTH + 2, lintel_height, 2),
            f.at([0, 1 + DOOR_HEIGHT + lintel_height / 2, -half_depth + 1]),
            r,
            WALL,
            surfaces=ALL_STUDS,
        ),
        part("Roof", (PLOT_WIDTH + 2, 1, PLOT_DEPTH + 2), f.at([0, roof_y, 0]), r, WALL, surfaces=ALL_STUDS),
        # Wooden sign above the door; GameplayManager writes the owner's name on it.
        part("Sign", (30, 6, 1), f.at([0, 1 + DOOR_HEIGHT + 4, -half_depth - 0.5]), r, WOOD, "WoodPlanks"),
        part("SignBorder", (31, 7, 0.8), f.at([0, 1 + DOOR_HEIGHT + 4, -half_depth - 0.1]), r, (0.4, 0.25, 0.13), "WoodPlanks"),
        part(
            "Carpet",
            (DOOR_WIDTH, 0.2, CARPET_LENGTH),
            f.at([0, 0.1, -half_depth - CARPET_LENGTH / 2]),
            r,
            CARPET,
            surfaces=STUDS,
        ),
        part(
            "LockButton",
            (5, 0.3, 5),
            f.at([18, 1.15, -half_depth + 10]),
            r,
            (1.0, 0.25, 0.25),
            "Neon",
            CanCollide=False,
        ),
        part(
            "SpawnPoint",
            (5, 0.2, 5),
            f.at([-18, 1.1, -half_depth + 10]),
            r,
            (0.3, 0.85, 0.4),
            "Neon",
            CanCollide=False,
            CanTouch=False,
        ),
        hidden("Interior", (PLOT_WIDTH - 4, WALL_HEIGHT, PLOT_DEPTH - 6), f.at([0, 1 + WALL_HEIGHT / 2, 1]), r),
        hidden("LaserZone", (DOOR_WIDTH, DOOR_HEIGHT, 6), f.at([0, 1 + DOOR_HEIGHT / 2, -half_depth + 1]), r),
    ]

    # Walls with glass windows on every floor (the front only above the door).
    all_floors = list(range(1, FLOORS + 1))
    walls = []
    walls += build_wall(f, r, "WallBack", "x", half_depth - 1, -half_width, half_width, [(-18, 8), (-6, 8), (6, 8), (18, 8)], all_floors, 1)
    for side, name in ((-1, "WallLeft"), (1, "WallRight")):
        walls += build_wall(f, r, name, "z", side * (half_width - 1), -half_depth, half_depth, [(-14, 8), (-2, 8), (10, 8), (22, 8)], all_floors, side)
    upper = all_floors[1:]
    walls += build_wall(f, r, "WallFrontLeft", "x", -half_depth + 1, -front_x - front_piece / 2, -front_x + front_piece / 2, [(-21, 6)], upper, -1)
    walls += build_wall(f, r, "WallFrontRight", "x", -half_depth + 1, front_x - front_piece / 2, front_x + front_piece / 2, [(21, 6)], upper, -1)
    children.append(folder("Walls", walls))

    # Floors 2 and up, the stairs between them, and a sign on each upper floor
    # that says how to unlock it.
    floors = []
    for floor in range(1, FLOORS + 1):
        if floor > 1:
            floors.extend(build_slab(f, r, floor))
            floors.append(hidden(f"FloorSign{floor}", (1, 1, 1), f.at([0, floor_top(floor) + 7, 12]), r))
        if floor < FLOORS:
            floors.extend(build_stairs(f, r, floor, accent))
    children.append(folder("Floors", floors))

    # Outside: a glowing band where each floor starts, neon trim around the
    # roof and a flag on top.
    outside = []
    for floor in range(1, FLOORS + 1):
        if floor > 1:
            band_y = floor_top(floor) - 0.5
            outside.append(part(f"BandFront{floor}", (PLOT_WIDTH + 0.6, 0.6, 0.6), f.at([0, band_y, -half_depth - 0.3]), r, accent, "Neon", CanCollide=False))
            outside.append(part(f"BandBack{floor}", (PLOT_WIDTH + 0.6, 0.6, 0.6), f.at([0, band_y, half_depth + 0.3]), r, accent, "Neon", CanCollide=False))
            for side, name in ((-1, "Left"), (1, "Right")):
                outside.append(
                    part(f"Band{name}{floor}", (0.6, 0.6, PLOT_DEPTH + 0.6), f.at([side * (half_width + 0.3), band_y, 0]), r, accent, "Neon", CanCollide=False)
                )
    for name, size, local in [
        ("TrimFront", (PLOT_WIDTH + 2.4, 0.5, 0.5), [0, roof_y, -half_depth - 1.2]),
        ("TrimBack", (PLOT_WIDTH + 2.4, 0.5, 0.5), [0, roof_y, half_depth + 1.2]),
        ("TrimLeft", (0.5, 0.5, PLOT_DEPTH + 2.4), [-half_width - 1.2, roof_y, 0]),
        ("TrimRight", (0.5, 0.5, PLOT_DEPTH + 2.4), [half_width + 1.2, roof_y, 0]),
    ]:
        outside.append(part(name, size, f.at(local), r, accent, "Neon", CanCollide=False))
    # Corner pillars and a glowing door frame in the base's colour.
    for cx in (-1, 1):
        for cz in (-1, 1):
            outside.append(
                part(
                    "Pillar",
                    (3, WALL_HEIGHT + 1, 3),
                    f.at([cx * (half_width + 0.3), wall_y + 0.5, cz * (half_depth + 0.3)]),
                    r,
                    accent,
                    surfaces=ALL_STUDS,
                )
            )
    for side in (-1, 1):
        outside.append(
            part("DoorFrame", (0.8, DOOR_HEIGHT, 0.8), f.at([side * (DOOR_WIDTH / 2 + 0.4), 1 + DOOR_HEIGHT / 2, -half_depth - 0.4]), r, accent, "Neon", CanCollide=False)
        )
    outside.append(
        part("DoorFrameTop", (DOOR_WIDTH + 1.6, 0.8, 0.8), f.at([0, 1 + DOOR_HEIGHT + 0.4, -half_depth - 0.4]), r, accent, "Neon", CanCollide=False)
    )
    outside.append(part("FlagPole", (0.6, 12, 0.6), f.at([-22, roof_y + 6.5, 24]), r, WHITE, "Metal"))
    outside.append(part("Flag", (6, 3.5, 0.2), f.at([-18.7, roof_y + 10.5, 24]), r, accent, "Fabric"))
    outside.append(part("RoofBlock", (10, 3, 8), f.at([14, roof_y + 2, 18]), r, WALL, surfaces=ALL_STUDS))
    outside.append(part("RoofVent", (4, 1, 4), f.at([14, roof_y + 4, 18]), r, DARK, "Metal"))
    children.append(folder("Trim", outside))

    # Lights inside, always on: three ceiling panels over the pedestals on
    # every floor, and glowing strips in the base's colour along the walls.
    lamps = []
    number = 1
    for floor in range(1, FLOORS + 1):
        ceiling = floor_top(floor) + FLOOR_HEIGHT - 1.2
        for x in (-12, 0, 12):
            lamps.append(
                part(
                    f"Lamp{number}",
                    (5, 0.4, 3),
                    f.at([x, ceiling, 12]),
                    r,
                    WHITE,
                    "Neon",
                    CanCollide=False,
                    CanQuery=False,
                    children=[point_light(1.4, 22, (1, 0.96, 0.88), always_on=True)],
                )
            )
            number += 1
        for side, name in ((-1, "Left"), (1, "Right")):
            lamps.append(
                part(
                    f"Strip{name}{floor}",
                    (0.3, 0.3, PLOT_DEPTH - 8),
                    f.at([side * (half_width - 2.2), ceiling - 0.2, 2]),
                    r,
                    accent,
                    "Neon",
                    CanCollide=False,
                    CanQuery=False,
                )
            )
        lamps.append(part(f"StripBack{floor}", (PLOT_WIDTH - 5, 0.3, 0.3), f.at([0, ceiling - 0.2, half_depth - 2.2]), r, accent, "Neon", CanCollide=False, CanQuery=False))
    children.append(folder("Lamps", lamps))

    lasers = []
    for number, height in enumerate([2.5, 4.5, 6.5, 8.5, 10.5, 12.5], start=1):
        lasers.append(
            part(
                f"Laser{number}",
                (DOOR_WIDTH, 0.3, 0.3),
                f.at([0, height, -half_depth + 1]),
                r,
                LASER,
                "Neon",
                Transparency=1,
                CanCollide=False,
                CanQuery=False,
                CanTouch=False,
            )
        )
    children.append(folder("Lasers", lasers))

    # A pedestal for each brainrot, with its green collect pad in front:
    # 8 per floor, numbered floor by floor.
    slots = []
    pads = []
    number = 1
    for floor in range(1, FLOORS + 1):
        top = floor_top(floor)
        for z in [6, 18]:
            for x in [-18, -6, 6, 18]:
                slots.append(part(f"Slot{number}", (7, 1, 7), f.at([x, top + 0.5, z]), r, (0.62, 0.64, 0.68), surfaces=STUDS))
                pads.append(
                    part(
                        f"Pad{number}",
                        (6, 0.2, 3),
                        f.at([x, top + 0.1, z - 5.5]),
                        r,
                        PAD,
                        "SmoothPlastic",
                        CanCollide=False,
                        CanQuery=False,
                        CanTouch=False,
                    )
                )
                number += 1
    children.append(folder("Slots", slots))
    children.append(folder("Pads", pads))

    return model(f"Plot{index}", children)


def build_tunnel(name, x, facing, with_sign):
    f = Frame([x, 0, 0], yaw(facing))
    r = f.rotation
    half = CONVEYOR_WIDTH / 2 + 2
    children = [
        part("PillarLeft", (4, 16, 4), f.at([-half, 8, 0]), r, WALL, surfaces=ALL_STUDS),
        part("PillarRight", (4, 16, 4), f.at([half, 8, 0]), r, WALL, surfaces=ALL_STUDS),
        part("Top", (2 * half + 4, 4, 5), f.at([0, 18, 0]), r, WALL, surfaces=ALL_STUDS),
        part("Hole", (2 * half - 4, 16, 1), f.at([0, 8, 3]), r, DARK),
    ]
    if with_sign:
        children.append(part("SpawnSign", (20, 5, 1), f.at([0, 23, -0.5]), r, DARK))
    return model(name, children)


def build_conveyor():
    half_length = CONVEYOR_LENGTH / 2
    return folder(
        "Conveyor",
        [
            part("Belt", (CONVEYOR_LENGTH, 1, CONVEYOR_WIDTH), (0, 0.5, 0), IDENTITY, CARPET, surfaces=STUDS),
            hidden("ConveyorStart", (1, 1, 1), (-half_length + 2, 1, 0), IDENTITY),
            hidden("ConveyorEnd", (1, 1, 1), (half_length - 2, 1, 0), IDENTITY),
            # Sign faces +X, down the conveyor.
            build_tunnel("StartTunnel", -half_length - 2, -90, True),
            build_tunnel("EndTunnel", half_length + 2, 90, False),
        ],
    )


SELLER_SCALE = 1.6


def figure_part(f, name, size, local, colour, material="SmoothPlastic", **extra):
    """A part of a shopkeeper, sized and placed in shopkeeper units."""
    k = SELLER_SCALE
    return part(
        name,
        [v * k for v in size],
        f.at([v * k for v in local]),
        f.rotation,
        colour,
        material,
        CanCollide=False,
        **extra,
    )


def noob(f, shirt):
    """A classic block noob shopkeeper. Parts are named Head*, LeftArm*,
    RightArm* and so on, so the client can animate them in groups."""
    yellow, green = (0.96, 0.8, 0.26), (0.3, 0.6, 0.2)
    face = {
        "Name": "face",
        "ClassName": "Decal",
        "Properties": {"Texture": "rbxasset://textures/face.png", "Face": "Front"},
    }
    return model(
        "Shopkeeper",
        [
            figure_part(f, "LeftLeg", (1, 2, 1), (-0.5, 1, 0), green),
            figure_part(f, "RightLeg", (1, 2, 1), (0.5, 1, 0), green),
            figure_part(f, "Torso", (2, 2, 1), (0, 3, 0), shirt),
            figure_part(f, "LeftArm", (1, 2, 1), (-1.5, 3, 0), yellow),
            figure_part(f, "RightArm", (1, 2, 1), (1.5, 3, 0), yellow),
            figure_part(f, "Head", (1.2, 1.2, 1.2), (0, 4.6, 0), yellow, children=[face]),
        ],
    )


def rat_seller(f):
    """The Robux seller: a rat in a black suit with sunglasses and a fez,
    holding a purple galaxy slap glove on a stick."""
    grey, pink, black = (0.62, 0.62, 0.66), (1.0, 0.72, 0.74), (0.08, 0.08, 0.1)
    white, blue, red, purple = WHITE, (0.1, 0.45, 0.95), (0.9, 0.12, 0.15), (0.62, 0.2, 0.95)
    parts = [
        figure_part(f, "LeftLeg", (1, 2, 1), (-0.5, 1, 0), black),
        figure_part(f, "RightLeg", (1, 2, 1), (0.5, 1, 0), black),
        figure_part(f, "Torso", (2, 2, 1), (0, 3, 0), black),
        figure_part(f, "TorsoShirt", (0.7, 1.9, 0.1), (0, 3.05, -0.52), white),
        figure_part(f, "TorsoTie", (0.22, 1.4, 0.12), (0, 3.1, -0.58), blue),
        figure_part(f, "LeftArm", (1, 2, 1), (-1.5, 3, 0), black),
        figure_part(f, "LeftArmHand", (0.9, 0.4, 0.9), (-1.5, 1.85, 0), grey),
        figure_part(f, "RightArm", (1, 2, 1), (1.5, 3, 0), black),
        figure_part(f, "RightArmHand", (0.9, 0.4, 0.9), (1.5, 1.85, 0), grey),
        figure_part(f, "RightArmStick", (0.22, 2.4, 0.22), (1.5, 2.9, -0.7), black),
        figure_part(f, "RightArmGlovePalm", (1.2, 1.2, 0.3), (1.5, 4.6, -0.7), purple, "Neon"),
        figure_part(f, "RightArmGloveThumb", (0.55, 0.25, 0.25), (0.8, 4.5, -0.7), purple, "Neon"),
        figure_part(f, "Head", (1.8, 1.5, 1.5), (0, 4.75, 0), grey),
        figure_part(f, "HeadEarLeft", (0.9, 0.9, 0.15), (-1.1, 5.6, 0.2), pink),
        figure_part(f, "HeadEarRight", (0.9, 0.9, 0.15), (1.1, 5.6, 0.2), pink),
        figure_part(f, "HeadFez", (0.7, 0.5, 0.7), (0, 5.75, 0), red),
        figure_part(f, "HeadGlasses", (1.7, 0.45, 0.1), (0, 4.95, -0.78), white),
        figure_part(f, "HeadLensLeft", (0.6, 0.32, 0.1), (-0.42, 4.95, -0.84), black, "Glass"),
        figure_part(f, "HeadLensRight", (0.6, 0.32, 0.1), (0.42, 4.95, -0.84), black, "Glass"),
        figure_part(f, "HeadNose", (0.3, 0.2, 0.2), (0, 4.45, -0.84), pink),
    ]
    for i, x in enumerate((1.05, 1.3, 1.55, 1.8), start=1):
        parts.append(figure_part(f, f"RightArmGloveFinger{i}", (0.22, 0.75, 0.22), (x, 5.55, -0.7), purple, "Neon"))
    for side in (-1, 1):
        for y in (4.45, 4.28):
            parts.append(figure_part(f, "HeadWhisker", (1.1, 0.05, 0.05), (side * 0.95, y, -0.8), white))
    return model("Shopkeeper", parts)


def build_stall(name, title, title_colour, title_stroke, awning, seller, prompt_name, object_text, origin, facing):
    """A market stall with a striped awning, a counter to open its menu and a shopkeeper
    (`seller` builds it from a Frame)."""
    f = Frame(origin, yaw(facing))
    r = f.rotation
    prompt = {
        "Name": prompt_name,
        "ClassName": "ProximityPrompt",
        "Properties": {
            "ActionText": "Open",
            "ObjectText": object_text,
            "HoldDuration": 0,
            "MaxActivationDistance": 12,
            "RequiresLineOfSight": False,
        },
    }
    title_gui = {
        "Name": "Title",
        "ClassName": "BillboardGui",
        "Properties": {
            "Size": {"UDim2": [[0, 320], [0, 80]]},
            "StudsOffset": [0, 4, 0],
            "LightInfluence": 0,
            "MaxDistance": 180,
        },
        "Children": [
            {
                "Name": "Text",
                "ClassName": "TextLabel",
                "Properties": {
                    "Size": {"UDim2": [[1, 0], [1, 0]]},
                    "BackgroundTransparency": 1,
                    "Font": "FredokaOne",
                    "Text": title,
                    "TextColor3": list(title_colour),
                    "TextScaled": True,
                },
                "Children": [
                    {"Name": "Outline", "ClassName": "UIStroke", "Properties": {"Thickness": 3, "Color": list(title_stroke)}}
                ],
            }
        ],
    }
    children = [
        part("Platform", (12, 0.6, 10), f.at([0, 0.3, 0]), r, FLOOR, surfaces=STUDS),
        part("Counter", (10, 3, 1.6), f.at([0, 2.1, -3]), r, WHITE, surfaces=ALL_STUDS, children=[prompt]),
        part("CounterTop", (10.6, 0.4, 2.2), f.at([0, 3.8, -3]), r, WOOD, "WoodPlanks"),
    ]
    for side in (-1, 1):
        for depth in (-1, 1):
            children.append(part("Post", (0.8, 8.6, 0.8), f.at([5.2 * side, 4.9, 4.2 * depth]), r, WOOD, "WoodPlanks"))
    stripes = []
    for i in range(9):
        colour = awning[i % 2]
        x = -5.6 + i * 1.4
        stripes.append(part(f"Stripe{i + 1}", (1.4, 0.4, 10), f.at([x, 9.4, 0]), r, colour))
        stripes.append(part(f"Flap{i + 1}", (1.4, 1, 0.4), f.at([x, 8.9, -5.1]), r, colour))
    children.append(folder("Awning", stripes))
    children.append(hidden("TitleAnchor", (1, 1, 1), f.at([0, 10.5, 0]), r))
    children[-1]["Children"] = [title_gui]
    children.append(seller(Frame(f.at([0, 0.6, 1.2]), f.turned(yaw(0)))))
    return model(name, children)


def build_shop_stalls():
    # In the gaps between the middle bases, facing the conveyor.
    return [
        build_stall(
            "ShopStall",
            "Robux Shop",
            (1, 0.45, 0.85),
            (0.3, 0.02, 0.2),
            ((0.9, 0.12, 0.15), WHITE),
            rat_seller,
            "ShopPrompt",
            "Robux Shop",
            [0, 0, 45],
            0,
        ),
        build_stall(
            "GearShop",
            "Gear Shop",
            (0.35, 0.85, 1),
            (0.02, 0.15, 0.3),
            ((0.15, 0.45, 0.95), WHITE),
            lambda frame: noob(frame, (0.85, 0.35, 0.1)),
            "GearPrompt",
            "Gear Shop",
            [0, 0, -45],
            180,
        ),
    ]


def build_fuse_machine(origin, facing):
    """A glowing glass capsule on a metal base: bring three brainrots of one
    rarity and it fuses them into a rarer one. The counter opens its menu."""
    f = Frame(origin, yaw(facing))
    r = f.rotation
    purple = (0.62, 0.25, 1.0)
    glass = (0.78, 0.6, 1.0)
    upright = multiply(r, [[0, -1, 0], [1, 0, 0], [0, 0, 1]])  # a cylinder's axis pointing up
    prompt = {
        "Name": "FusePrompt",
        "ClassName": "ProximityPrompt",
        "Properties": {
            "ActionText": "Fuse",
            "ObjectText": "Fuse Machine",
            "HoldDuration": 0,
            "MaxActivationDistance": 12,
            "RequiresLineOfSight": False,
        },
    }
    title = {
        "Name": "Title",
        "ClassName": "BillboardGui",
        "Properties": {
            "Size": {"UDim2": [[0, 340], [0, 110]]},
            "StudsOffset": [0, 3, 0],
            "LightInfluence": 0,
            "MaxDistance": 180,
        },
        "Children": [
            {
                "Name": "Text",
                "ClassName": "TextLabel",
                "Properties": {
                    "Size": {"UDim2": [[1, 0], [0.65, 0]]},
                    "BackgroundTransparency": 1,
                    "Font": "FredokaOne",
                    "Text": "Fuse Machine",
                    "TextColor3": [0.85, 0.6, 1],
                    "TextScaled": True,
                },
                "Children": [{"Name": "Outline", "ClassName": "UIStroke", "Properties": {"Thickness": 3, "Color": [0.2, 0.02, 0.35]}}],
            },
            {
                "Name": "Hint",
                "ClassName": "TextLabel",
                "Properties": {
                    "Position": {"UDim2": [[0, 0], [0.65, 0]]},
                    "Size": {"UDim2": [[1, 0], [0.35, 0]]},
                    "BackgroundTransparency": 1,
                    "Font": "FredokaOne",
                    "Text": "3 brainrots = 1 rarer one!",
                    "TextColor3": [1, 1, 1],
                    "TextScaled": True,
                },
                "Children": [{"Name": "Outline", "ClassName": "UIStroke", "Properties": {"Thickness": 2, "Color": [0.2, 0.02, 0.35]}}],
            },
        ],
    }
    children = [
        part("Platform", (16, 0.6, 14), f.at([0, 0.3, 0]), r, FLOOR, surfaces=STUDS),
        part("Base", (9, 2, 9), f.at([0, 1.6, 1]), r, DARK, "DiamondPlate"),
        part("BaseTrim", (9.4, 0.4, 9.4), f.at([0, 2.7, 1]), r, purple, "Neon", CanCollide=False),
        part("Capsule", (7, 6.6, 6.6), f.at([0, 6.4, 1]), upright, glass, "Glass", Transparency=0.45, Reflectance=0.2, Shape="Cylinder"),
        part(
            "Core",
            (2.6, 2.6, 2.6),
            f.at([0, 6.4, 1]),
            r,
            purple,
            "Neon",
            CanCollide=False,
            Shape="Ball",
            children=[point_light(3, 22, (0.75, 0.45, 1), always_on=True)],
        ),
        part("RingLow", (0.5, 7.4, 7.4), f.at([0, 4.2, 1]), upright, purple, "Neon", CanCollide=False, Shape="Cylinder"),
        part("RingHigh", (0.5, 7.4, 7.4), f.at([0, 8.6, 1]), upright, purple, "Neon", CanCollide=False, Shape="Cylinder"),
        part("Cap", (7.6, 1.2, 7.6), f.at([0, 10.3, 1]), r, DARK, "Metal"),
        part("CapLight", (2, 0.8, 2), f.at([0, 11.3, 1]), r, (1, 0.85, 0.2), "Neon", CanCollide=False),
        part("Counter", (9, 3, 1.6), f.at([0, 2.1, -5.4]), r, WHITE, surfaces=ALL_STUDS, children=[prompt]),
        part("CounterTop", (9.6, 0.4, 2.2), f.at([0, 3.8, -5.4]), r, purple, "Neon", CanCollide=False),
    ]
    # Pipes up the sides and a lightning bolt on the front of the cap.
    for side in (-1, 1):
        children.append(part("Pipe", (1, 8.6, 1), f.at([side * 4.6, 5.6, 1]), r, (0.55, 0.57, 0.62), "Metal"))
        children.append(part("PipeGlow", (1.1, 0.5, 1.1), f.at([side * 4.6, 7, 1]), r, purple, "Neon", CanCollide=False))
    children.append(part("Bolt1", (0.5, 2, 0.3), f.at([0.35, 11.6, -2.9]), multiply(r, yaw(0)), (1, 0.85, 0.2), "Neon", CanCollide=False))
    children.append(part("Bolt2", (1.4, 0.4, 0.3), f.at([0, 10.6, -2.9]), r, (1, 0.85, 0.2), "Neon", CanCollide=False))
    children.append(part("Bolt3", (0.5, 2, 0.3), f.at([-0.35, 9.6, -2.9]), r, (1, 0.85, 0.2), "Neon", CanCollide=False))
    children.append(hidden("TitleAnchor", (1, 1, 1), f.at([0, 13, 1]), r))
    children[-1]["Children"] = [title]
    return model("FuseMachine", children)


def build_board(name, origin, facing, accent):
    """A big board on two posts; scripts draw on the Screen's front face."""
    f = Frame(origin, yaw(facing))
    r = f.rotation
    children = [
        part("PostLeft", (1.6, 30, 1.6), f.at([-11, 15, 1]), r, WOOD, "WoodPlanks"),
        part("PostRight", (1.6, 30, 1.6), f.at([11, 15, 1]), r, WOOD, "WoodPlanks"),
        part("Frame", (22, 26, 1), f.at([0, 17, 0.4]), r, accent, "SmoothPlastic"),
        part("Screen", (20.6, 24.6, 0.4), f.at([0, 17, -0.3]), r, DARK, "SmoothPlastic"),
        part("Base", (26, 1, 6), f.at([0, 0.5, 1]), r, WALL, surfaces=ALL_STUDS),
    ]
    return model(name, children)


def build_leaderboards():
    # In the gaps between the outer bases, facing the conveyor.
    return folder(
        "Leaderboards",
        [
            build_board("TopCash", [-100, 0, 62], 0, (0.3, 1, 0.45)),
            build_board("TopSteals", [100, 0, 62], 0, (1, 0.35, 0.35)),
            build_board("TopRebirths", [-100, 0, -62], 180, (0.3, 0.75, 1)),
            build_board("LogoBoard", [100, 0, -62], 180, (1, 0.8, 0.2)),
        ],
    )


LEAF_GREENS = [(0.3, 0.72, 0.25), (0.22, 0.62, 0.2), (0.36, 0.8, 0.3), (0.45, 0.78, 0.22)]
TRUNK = (0.45, 0.3, 0.17)


def tree(name, x, z, size, kind, colour):
    """A blocky tree: a round one (stacked leaf cubes) or a pine (stepped layers)."""
    trunk_h = 6 * size
    children = [part("Trunk", (1.6 * size, trunk_h, 1.6 * size), (x, trunk_h / 2, z), IDENTITY, TRUNK, "WoodPlanks")]
    if kind == "pine":
        y = trunk_h * 0.6
        for i, width in enumerate((9, 7, 5, 3)):
            children.append(part(f"Leaves{i + 1}", (width * size, 2.6 * size, width * size), (x, y + 1.3 * size, z), IDENTITY, colour, surfaces=STUDS))
            y += 2.4 * size
    else:
        children.append(part("Leaves1", (8 * size, 5 * size, 8 * size), (x, trunk_h + 2 * size, z), IDENTITY, colour, surfaces=STUDS))
        children.append(part("Leaves2", (5.5 * size, 3 * size, 5.5 * size), (x, trunk_h + 5.8 * size, z), IDENTITY, colour, surfaces=STUDS))
        children.append(part("Leaves3", (10 * size, 2.5 * size, 5 * size), (x, trunk_h + 1.2 * size, z), IDENTITY, colour, surfaces=STUDS))
    return model(name, children)


def lamp_post(name, x, z, facing):
    f = Frame([x, 0, z], yaw(facing))
    r = f.rotation
    return model(
        name,
        [
            part("Base", (2, 1, 2), f.at([0, 0.5, 0]), r, DARK, "Metal"),
            part("Pole", (0.6, 12, 0.6), f.at([0, 6.5, 0]), r, DARK, "Metal"),
            part("Arm", (0.4, 0.4, 3), f.at([0, 12.3, -1.3]), r, DARK, "Metal"),
            part(
                "Light",
                (1.4, 0.8, 1.4),
                f.at([0, 11.9, -2.6]),
                r,
                (1, 0.9, 0.6),
                "Neon",
                CanCollide=False,
                children=[point_light(1.4, 28, (1, 0.85, 0.6))],
            ),
        ],
    )


def build_scenery():
    """Trees behind the bases and at the ends, bushes, rocks and lamp posts
    along the walkway. Positions are random but the same on every run."""
    import random

    rng = random.Random(7)
    trees = []
    number = 1

    def add_tree(x, z, big=1.0):
        nonlocal number
        kind = "pine" if rng.random() < 0.35 else "round"
        size = rng.uniform(0.8, 1.25) * big
        trees.append(tree(f"Tree{number}", round(x, 1), round(z, 1), size, kind, rng.choice(LEAF_GREENS)))
        number += 1

    for side in (-1, 1):
        # Two loose rows behind the bases.
        for row_z in (128, 150):
            x = -275.0
            while x < 275:
                add_tree(x + rng.uniform(-5, 5), side * (row_z + rng.uniform(-4, 4)))
                x += rng.uniform(20, 30)
        # The far ends of the map, beside the tunnels.
        for end_x in (255, 278):
            z = -150.0
            while z < 150:
                if abs(z) > 22:
                    add_tree(side * (end_x + rng.uniform(-4, 4)), z + rng.uniform(-4, 4))
                z += rng.uniform(22, 32)
        # Between the outer bases, behind the leaderboards.
        for gap_x in (-100, 100):
            add_tree(gap_x + rng.uniform(-6, 6), side * rng.uniform(88, 104), 1.1)

    bushes = []
    for i in range(36):
        while True:
            x, z = rng.uniform(-280, 280), rng.uniform(-158, 158)
            near_base = any(abs(x - px) < 36 and 40 < abs(z) < 118 for px in PLOT_X)
            if abs(z) > 118 or abs(x) > 238 or (abs(z) > 20 and not near_base and abs(x) > 26 and abs(abs(x) - 100) > 16):
                break
        w = rng.uniform(2.5, 4.5)
        bushes.append(part(f"Bush{i + 1}", (w, w * 0.7, w), (round(x, 1), w * 0.35, round(z, 1)), IDENTITY, rng.choice(LEAF_GREENS), surfaces=STUDS))
    rocks = []
    for i in range(14):
        x, z = rng.uniform(-280, 280), rng.choice([-1, 1]) * rng.uniform(120, 158)
        w = rng.uniform(2, 5)
        rocks.append(part(f"Rock{i + 1}", (w, w * 0.6, w * 0.8), (round(x, 1), w * 0.3, round(z, 1)), IDENTITY, (0.55, 0.56, 0.6), "Slate"))

    lamps = []
    number = 1
    for side in (-1, 1):
        for x in (-225, -200, -100, 0, 100, 200, 225):
            lamps.append(lamp_post(f"LampPost{number}", x, side * 17, 0 if side > 0 else 180))
            number += 1

    return folder(
        "Scenery",
        [folder("Trees", trees), folder("Bushes", bushes), folder("Rocks", rocks), folder("LampPosts", lamps)],
    )


def build_border():
    walls = []
    height = 36
    thickness = 10
    length_x = 2 * BORDER_X + 2 * thickness
    length_z = 2 * BORDER_Z
    for name, size, position in [
        ("North", (length_x, height, thickness), (0, height / 2, BORDER_Z + thickness / 2)),
        ("South", (length_x, height, thickness), (0, height / 2, -BORDER_Z - thickness / 2)),
        ("East", (thickness, height, length_z), (BORDER_X + thickness / 2, height / 2, 0)),
        ("West", (thickness, height, length_z), (-BORDER_X - thickness / 2, height / 2, 0)),
    ]:
        walls.append(part(name, size, position, IDENTITY, DIRT, surfaces=ALL_STUDS))
        cap_size = (size[0], 2, size[2])
        walls.append(part(name + "Grass", cap_size, (position[0], height + 1, position[2]), IDENTITY, GRASS, surfaces=STUDS))
    return folder("Border", walls)


def build_map():
    plots = []
    index = 1
    for z, facing in [(PLOT_Z, 0), (-PLOT_Z, 180)]:
        for x in PLOT_X:
            plots.append(build_plot(index, (x, 0, z), yaw(facing)))
            index += 1
    return {
        "ClassName": "Model",
        "Children": [
            build_conveyor(),
            folder("Plots", plots),
            *build_shop_stalls(),
            build_fuse_machine([0, 0, 80], 0),
            build_leaderboards(),
            build_scenery(),
            build_border(),
        ],
    }


def main():
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(build_map(), indent=2) + "\n")
    print(f"Wrote {OUTPUT}")


if __name__ == "__main__":
    main()
