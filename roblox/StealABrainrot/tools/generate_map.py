#!/usr/bin/env python3
"""Generate Workspace/Map.model.json in the style of the original Steal a Brainrot.

Studded plastic everywhere, a red carpet conveyor between two tunnels, eight
grey garage-style bases with wooden signs, a dirt-and-grass border and a Robux
Shop stall. GameplayManager and GameClient find parts by name, so the layout
can also be edited in Studio afterwards. Run from the StealABrainrot folder:

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

PLOT_X = [-105, -35, 35, 105]
PLOT_Z = 50
PLOT_WIDTH = 56
PLOT_DEPTH = 60
WALL_HEIGHT = 14
DOOR_WIDTH = 16
CONVEYOR_LENGTH = 320
CONVEYOR_WIDTH = 14
BORDER_X = 215
BORDER_Z = 125

GRASS = (0.29, 0.75, 0.25)
DIRT = (0.56, 0.36, 0.2)
CARPET = (0.85, 0.16, 0.16)
FLOOR = (0.72, 0.73, 0.76)
WALL = (0.36, 0.38, 0.44)
DARK = (0.12, 0.13, 0.17)
WOOD = (0.55, 0.36, 0.21)
WHITE = (0.96, 0.96, 0.96)
LASER = (1.0, 0.1, 0.1)
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


def point_light(brightness, range_, color=(1, 1, 1)):
    return {
        "Name": "Light",
        "ClassName": "PointLight",
        "Properties": {"Brightness": brightness, "Range": range_, "Color": list(color), "Shadows": False},
    }


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


def build_plot(index, origin, rotation):
    f = Frame(origin, rotation)
    r = rotation
    half_width = PLOT_WIDTH / 2
    half_depth = PLOT_DEPTH / 2
    wall_y = 1 + WALL_HEIGHT / 2
    roof_y = 1 + WALL_HEIGHT + 0.5
    front_piece = (PLOT_WIDTH - DOOR_WIDTH) / 2 - 1
    front_x = DOOR_WIDTH / 2 + front_piece / 2
    accent = ACCENTS[index - 1]

    children = [
        part("Floor", (PLOT_WIDTH, 1, PLOT_DEPTH), f.at([0, 0.5, 0]), r, FLOOR, surfaces=STUDS),
        part("WallBack", (PLOT_WIDTH, WALL_HEIGHT, 2), f.at([0, wall_y, half_depth - 1]), r, WALL, surfaces=ALL_STUDS),
        part("WallLeft", (2, WALL_HEIGHT, PLOT_DEPTH), f.at([-half_width + 1, wall_y, 0]), r, WALL, surfaces=ALL_STUDS),
        part("WallRight", (2, WALL_HEIGHT, PLOT_DEPTH), f.at([half_width - 1, wall_y, 0]), r, WALL, surfaces=ALL_STUDS),
        part("WallFrontLeft", (front_piece, WALL_HEIGHT, 2), f.at([-front_x, wall_y, -half_depth + 1]), r, WALL, surfaces=ALL_STUDS),
        part("WallFrontRight", (front_piece, WALL_HEIGHT, 2), f.at([front_x, wall_y, -half_depth + 1]), r, WALL, surfaces=ALL_STUDS),
        part("Roof", (PLOT_WIDTH + 2, 1, PLOT_DEPTH + 2), f.at([0, roof_y, 0]), r, WALL, surfaces=ALL_STUDS),
        # Big picture window on the inside of the back wall.
        part("WindowFrame", (40, 8, 0.4), f.at([0, 8, half_depth - 2.2]), r, WHITE),
        part("WindowGlass", (37, 6, 0.4), f.at([0, 8, half_depth - 2.4]), r, DARK, "Glass", Reflectance=0.3),
        # Wooden sign above the door; GameplayManager writes the owner's name on it.
        part("Sign", (30, 6, 1), f.at([0, roof_y + 3.5, -half_depth + 0.5]), r, WOOD, "WoodPlanks"),
        part("SignBorder", (31, 7, 0.8), f.at([0, roof_y + 3.5, -half_depth + 0.9]), r, (0.4, 0.25, 0.13), "WoodPlanks"),
        part("Carpet", (DOOR_WIDTH, 0.2, 14), f.at([0, 0.1, -half_depth - 7]), r, CARPET, surfaces=STUDS),
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
        hidden("Interior", (PLOT_WIDTH - 4, 14, PLOT_DEPTH - 6), f.at([0, 8, 1]), r),
        hidden("LaserZone", (DOOR_WIDTH, WALL_HEIGHT, 6), f.at([0, wall_y, -half_depth + 1]), r),
    ]

    # Neon trim in the base's colour around the roof edge.
    trim = []
    for name, size, local in [
        ("TrimFront", (PLOT_WIDTH + 2.4, 0.5, 0.5), [0, roof_y, -half_depth - 1.2]),
        ("TrimBack", (PLOT_WIDTH + 2.4, 0.5, 0.5), [0, roof_y, half_depth + 1.2]),
        ("TrimLeft", (0.5, 0.5, PLOT_DEPTH + 2.4), [-half_width - 1.2, roof_y, 0]),
        ("TrimRight", (0.5, 0.5, PLOT_DEPTH + 2.4), [half_width + 1.2, roof_y, 0]),
    ]:
        trim.append(part(name, size, f.at(local), r, accent, "Neon", CanCollide=False))
    children.append(folder("Trim", trim))

    lamps = []
    for number, (x, z) in enumerate([(-14, -8), (14, -8), (-14, 14), (14, 14)], start=1):
        lamps.append(
            part(
                f"Lamp{number}",
                (4, 0.4, 2),
                f.at([x, roof_y - 0.7, z]),
                r,
                WHITE,
                "Neon",
                CanCollide=False,
                children=[point_light(1.2, 22, (1, 0.97, 0.9))],
            )
        )
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

    slots = []
    number = 1
    for z in [6, 18]:
        for x in [-18, -6, 6, 18]:
            slots.append(part(f"Slot{number}", (7, 1, 7), f.at([x, 1.5, z]), r, (0.62, 0.64, 0.68), surfaces=STUDS))
            number += 1
    children.append(folder("Slots", slots))

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


def noob(f):
    """A classic block noob shopkeeper."""
    r = f.rotation
    yellow, blue, green = (0.96, 0.8, 0.26), (0.05, 0.41, 0.67), (0.3, 0.6, 0.2)
    face = {
        "Name": "face",
        "ClassName": "Decal",
        "Properties": {"Texture": "rbxasset://textures/face.png", "Face": "Front"},
    }
    return model(
        "Shopkeeper",
        [
            part("LeftLeg", (1, 2, 1), f.at([-0.5, 1.6, 0]), r, green),
            part("RightLeg", (1, 2, 1), f.at([0.5, 1.6, 0]), r, green),
            part("Torso", (2, 2, 1), f.at([0, 3.6, 0]), r, blue),
            part("LeftArm", (1, 2, 1), f.at([-1.5, 3.6, 0]), r, yellow),
            part("RightArm", (1, 2, 1), f.at([1.5, 3.6, 0]), r, yellow),
            part("Head", (1.2, 1.2, 1.2), f.at([0, 5.2, 0]), r, yellow, children=[face]),
        ],
    )


def build_shop_stall():
    # Between plots 2 and 3, facing the conveyor (-Z).
    f = Frame([0, 0, 28], yaw(0))
    r = f.rotation
    red, white = (0.9, 0.12, 0.15), WHITE
    prompt = {
        "Name": "ShopPrompt",
        "ClassName": "ProximityPrompt",
        "Properties": {
            "ActionText": "Open",
            "ObjectText": "Robux Shop",
            "HoldDuration": 0,
            "MaxActivationDistance": 12,
            "RequiresLineOfSight": False,
        },
    }
    title = {
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
                    "Text": "Robux Shop",
                    "TextColor3": [1, 0.45, 0.85],
                    "TextScaled": True,
                },
                "Children": [
                    {"Name": "Outline", "ClassName": "UIStroke", "Properties": {"Thickness": 3, "Color": [0.3, 0.02, 0.2]}}
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
        colour = red if i % 2 == 0 else white
        x = -5.6 + i * 1.4
        stripes.append(part(f"Stripe{i + 1}", (1.4, 0.4, 10), f.at([x, 9.4, 0]), r, colour))
        stripes.append(part(f"Flap{i + 1}", (1.4, 1, 0.4), f.at([x, 8.9, -5.1]), r, colour))
    children.append(folder("Awning", stripes))
    children.append(hidden("TitleAnchor", (1, 1, 1), f.at([0, 10.5, 0]), r))
    children[-1]["Children"] = [title]
    children.append(noob(Frame(f.at([0, 0.6, 0.5]), f.turned(yaw(0)))))
    return model("ShopStall", children)


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
        "Children": [build_conveyor(), folder("Plots", plots), build_shop_stall(), build_border()],
    }


def main():
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(build_map(), indent=2) + "\n")
    print(f"Wrote {OUTPUT}")


if __name__ == "__main__":
    main()
