#!/usr/bin/env python3
"""Generate Workspace/Map.model.json: the conveyor and the eight player bases.

GameplayManager finds everything by name, so the layout can also be edited in
Studio afterwards. Run from the StealABrainrot folder:

    python3 tools/generate_map.py
"""

import json
from pathlib import Path

OUTPUT = Path(__file__).resolve().parent.parent / "Workspace" / "Map.model.json"

IDENTITY = [[1, 0, 0], [0, 1, 0], [0, 0, 1]]
# 180 degrees around Y: the base's entrance (local -Z) faces +Z in the world.
TURNED = [[-1, 0, 0], [0, 1, 0], [0, 0, -1]]

PLOT_X = [-105, -35, 35, 105]
PLOT_Z = 50
PLOT_WIDTH = 56
PLOT_DEPTH = 60
WALL_HEIGHT = 12
DOOR_WIDTH = 16
CONVEYOR_LENGTH = 300
CONVEYOR_WIDTH = 12

PLOT_COLORS = [
    (0.55, 0.78, 0.98),
    (0.98, 0.72, 0.55),
    (0.70, 0.92, 0.62),
    (0.93, 0.66, 0.90),
    (0.99, 0.88, 0.50),
    (0.60, 0.90, 0.88),
    (0.85, 0.75, 0.99),
    (0.98, 0.62, 0.66),
]
WALL_COLOR = (0.92, 0.92, 0.95)
PEDESTAL_COLOR = (0.97, 0.97, 0.97)
LASER_COLOR = (1.0, 0.1, 0.1)


def rotate(matrix, vector):
    return [sum(matrix[row][col] * vector[col] for col in range(3)) for row in range(3)]


def part(name, size, position, rotation, color=None, material="SmoothPlastic", **extra):
    properties = {
        "Anchored": True,
        "Size": list(size),
        "CFrame": {"CFrame": {"position": list(position), "orientation": rotation}},
        "Material": material,
        "TopSurface": "Smooth",
        "BottomSurface": "Smooth",
    }
    if color is not None:
        properties["Color"] = list(color)
    properties.update(extra)
    return {"Name": name, "ClassName": "Part", "Properties": properties}


def hidden(name, size, position, rotation):
    return part(
        name,
        size,
        position,
        rotation,
        Transparency=1,
        CanCollide=False,
        CanQuery=False,
        CanTouch=False,
    )


def folder(name, children):
    return {"Name": name, "ClassName": "Folder", "Children": children}


def build_plot(index, origin, rotation):
    def place(local):
        offset = rotate(rotation, local)
        return [origin[0] + offset[0], origin[1] + offset[1], origin[2] + offset[2]]

    half_width = PLOT_WIDTH / 2
    half_depth = PLOT_DEPTH / 2
    wall_y = 1 + WALL_HEIGHT / 2
    front_piece = (PLOT_WIDTH - DOOR_WIDTH) / 2 - 1
    front_x = DOOR_WIDTH / 2 + front_piece / 2

    children = [
        part("Floor", (PLOT_WIDTH, 1, PLOT_DEPTH), place([0, 0.5, 0]), rotation, PLOT_COLORS[index - 1]),
        part("WallBack", (PLOT_WIDTH, WALL_HEIGHT, 2), place([0, wall_y, half_depth - 1]), rotation, WALL_COLOR),
        part("WallLeft", (2, WALL_HEIGHT, PLOT_DEPTH), place([-half_width + 1, wall_y, 0]), rotation, WALL_COLOR),
        part("WallRight", (2, WALL_HEIGHT, PLOT_DEPTH), place([half_width - 1, wall_y, 0]), rotation, WALL_COLOR),
        part("WallFrontLeft", (front_piece, WALL_HEIGHT, 2), place([-front_x, wall_y, -half_depth + 1]), rotation, WALL_COLOR),
        part("WallFrontRight", (front_piece, WALL_HEIGHT, 2), place([front_x, wall_y, -half_depth + 1]), rotation, WALL_COLOR),
        part("Sign", (18, 4, 1), place([0, WALL_HEIGHT + 3, -half_depth + 1]), rotation, (0.15, 0.15, 0.2)),
        part(
            "LockButton",
            (5, 0.3, 5),
            place([18, 1.15, -half_depth + 10]),
            rotation,
            (1.0, 0.25, 0.25),
            "Neon",
            CanCollide=False,
        ),
        part(
            "SpawnPoint",
            (5, 0.2, 5),
            place([-18, 1.1, -half_depth + 10]),
            rotation,
            (0.3, 0.85, 0.4),
            CanCollide=False,
            CanTouch=False,
        ),
        hidden("Interior", (PLOT_WIDTH - 4, 14, PLOT_DEPTH - 6), place([0, 8, 1]), rotation),
        hidden("LaserZone", (DOOR_WIDTH, WALL_HEIGHT, 6), place([0, wall_y, -half_depth + 1]), rotation),
    ]

    lasers = []
    for number, height in enumerate([2.5, 4.5, 6.5, 8.5, 10.5], start=1):
        lasers.append(
            part(
                f"Laser{number}",
                (DOOR_WIDTH, 0.3, 0.3),
                place([0, height, -half_depth + 1]),
                rotation,
                LASER_COLOR,
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
            slots.append(part(f"Slot{number}", (7, 1, 7), place([x, 1.5, z]), rotation, PEDESTAL_COLOR))
            number += 1
    children.append(folder("Slots", slots))

    return {"Name": f"Plot{index}", "ClassName": "Model", "Children": children}


def build_conveyor():
    half_length = CONVEYOR_LENGTH / 2
    rail_z = CONVEYOR_WIDTH / 2 + 0.5
    return folder(
        "Conveyor",
        [
            part("Belt", (CONVEYOR_LENGTH, 1, CONVEYOR_WIDTH), (0, 0.5, 0), IDENTITY, (0.75, 0.1, 0.12), "Fabric"),
            part("RailLeft", (CONVEYOR_LENGTH, 2, 1), (0, 1, -rail_z), IDENTITY, (1.0, 0.8, 0.15)),
            part("RailRight", (CONVEYOR_LENGTH, 2, 1), (0, 1, rail_z), IDENTITY, (1.0, 0.8, 0.15)),
            hidden("ConveyorStart", (1, 1, 1), (-half_length + 2, 1, 0), IDENTITY),
            hidden("ConveyorEnd", (1, 1, 1), (half_length - 2, 1, 0), IDENTITY),
        ],
    )


def build_map():
    plots = []
    index = 1
    for z, rotation in [(PLOT_Z, IDENTITY), (-PLOT_Z, TURNED)]:
        for x in PLOT_X:
            plots.append(build_plot(index, (x, 0, z), rotation))
            index += 1
    return {"ClassName": "Model", "Children": [build_conveyor(), folder("Plots", plots)]}


def main():
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(build_map(), indent=2) + "\n")
    print(f"Wrote {OUTPUT}")


if __name__ == "__main__":
    main()
