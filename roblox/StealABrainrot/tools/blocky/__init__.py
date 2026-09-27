"""A small voxel kit for building brainrots out of blocks.

Each design is a function that fills a Model with boxes, spheres, cylinders
and pixel art, and marks the pieces that move (legs, arms, wings, a tail, the
head, a propeller). tools/build_blocky.py turns every design into the same
blocky model data the game uses for the Higgsfield models, so block-built
brainrots load, walk and take mutations exactly like the others.

Coordinates are voxel units. Looking at the model's face:
  x grows to the right, y grows up, z grows backwards (z = 0 is the front).
Voxel (i, j, k) fills the unit cube [i, i + 1] x [j, j + 1] x [k, k + 1], so a
sphere centred on x = 10 in a model 20 wide sits right in the middle.

    from blocky import design

    @design("CubettoRosso", width=16, height=24, depth=12)
    def cubetto_rosso(m):
        red, black, white = "#e53935", "#1b1b1b", "#ffffff"
        m.box(3, 8, 2, 12, 20, 9, red)                      # body (inclusive bounds)
        left = m.limb("Leg", pivot=(5.5, 8, 5.5), phase=0)  # legs swing about the hip
        right = m.limb("Leg", pivot=(10.5, 8, 5.5), phase=1)
        m.box(4, 0, 4, 6, 7, 7, black, part=left)
        m.box(9, 0, 4, 11, 7, 7, black, part=right)
        m.pixels(5, 17, ["w.w", "b.b"], {"w": white, "b": black})  # eyes on the front

Moving pieces (Model.limb):
  Leg   swings forwards and back about its hip while walking; phase 0 and 1
        step in turn. Two legs make the model walk instead of waddle.
  Arm   swings opposite to the leg with the same phase; waves a little idle.
  Wing  flaps about the body's forward axis; phase 0 = left wing, 1 = right.
  Tail  wags side to side about its pivot.
  Head  nods while walking and looks around while idle.
  Prop  spins about its pivot: axis "Y" (a halo, rings) or "Z" (a propeller
        facing forwards) or "X" (wheels).
Each voxel belongs to one piece: the last shape drawn with `part=` wins.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Callable, Iterable

import numpy as np

KINDS = ("Leg", "Arm", "Wing", "Tail", "Head", "Prop")

REGISTRY: dict[str, "Design"] = {}


@dataclass
class Limb:
    kind: str
    pivot: tuple[float, float, float]
    phase: int = 0
    axis: str | None = None


@dataclass
class Design:
    id: str
    width: int
    height: int
    depth: int
    build: Callable[["Model"], None]
    module: str = ""


def design(brainrot_id: str, width: int, height: int, depth: int):
    """Registers a block-built brainrot. The grid is width x height x depth voxels."""

    def register(function: Callable[["Model"], None]):
        if brainrot_id in REGISTRY:
            raise ValueError(f"{brainrot_id} is designed twice")
        REGISTRY[brainrot_id] = Design(brainrot_id, width, height, depth, function, function.__module__)
        return function

    return register


def parse_colour(colour) -> tuple[int, int, int]:
    if isinstance(colour, str):
        text = colour.lstrip("#")
        if len(text) != 6:
            raise ValueError(f"bad colour {colour!r}")
        return int(text[0:2], 16), int(text[2:4], 16), int(text[4:6], 16)
    r, g, b = colour
    return int(r), int(g), int(b)


def shade(colour, amount: float) -> str:
    """A lighter (amount > 0) or darker (amount < 0) version of a colour, -1..1."""
    r, g, b = parse_colour(colour)
    if amount >= 0:
        r, g, b = (c + (255 - c) * amount for c in (r, g, b))
    else:
        r, g, b = (c * (1 + amount) for c in (r, g, b))
    return "#%02x%02x%02x" % tuple(int(round(max(0, min(255, c)))) for c in (r, g, b))


class Model:
    def __init__(self, width: int, height: int, depth: int):
        if max(width, height, depth) > 250:
            raise ValueError("models can be at most 250 voxels in any direction")
        self.width, self.height, self.depth = width, height, depth
        # 0 = empty, n > 0 = palette colour n - 1.
        self.grid = np.zeros((width, height, depth), dtype=np.int16)
        self.part = np.zeros((width, height, depth), dtype=np.int16)
        self.palette: list[tuple[int, int, int]] = []
        self.limbs: list[Limb] = []
        xs, ys, zs = np.meshgrid(
            np.arange(width) + 0.5, np.arange(height) + 0.5, np.arange(depth) + 0.5, indexing="ij"
        )
        self._centres = (xs, ys, zs)

    # -- colours and pieces --------------------------------------------------

    def colour(self, colour) -> int:
        """Palette index + 1 for a colour ("#rrggbb" or (r, g, b))."""
        rgb = parse_colour(colour)
        if rgb not in self.palette:
            if len(self.palette) >= 250:
                raise ValueError("too many colours")
            self.palette.append(rgb)
        return self.palette.index(rgb) + 1

    def limb(self, kind: str, pivot: tuple[float, float, float], phase: int = 0, axis: str | None = None) -> int:
        """Adds a moving piece and returns its part number for `part=`."""
        if kind not in KINDS:
            raise ValueError(f"unknown limb kind {kind!r}; use one of {KINDS}")
        if kind == "Prop" and axis not in ("X", "Y", "Z"):
            raise ValueError('a Prop needs axis="X", "Y" or "Z"')
        self.limbs.append(Limb(kind, tuple(float(v) for v in pivot), int(phase), axis))
        return len(self.limbs)

    # -- masks ---------------------------------------------------------------

    def _mirror_x(self, mask: np.ndarray) -> np.ndarray:
        return mask[::-1, :, :]

    def _apply(self, mask: np.ndarray, colour, part: int, mirror: bool, mode: str):
        if mirror:
            mask = mask | self._mirror_x(mask)
        if mode == "fill":
            self.grid[mask] = self.colour(colour)
            self.part[mask] = part
        elif mode == "paint":
            mask = mask & (self.grid > 0)
            self.grid[mask] = self.colour(colour)
        elif mode == "clear":
            self.grid[mask] = 0
            self.part[mask] = 0
        elif mode == "assign":
            mask = mask & (self.grid > 0)
            self.part[mask] = part
        else:
            raise ValueError(mode)
        return mask

    def box_mask(self, x0, y0, z0, x1, y1, z1) -> np.ndarray:
        x0, x1 = sorted((x0, x1))
        y0, y1 = sorted((y0, y1))
        z0, z1 = sorted((z0, z1))
        mask = np.zeros(self.grid.shape, dtype=bool)
        xa, xb = max(0, int(math.floor(x0))), min(self.width, int(math.floor(x1)) + 1)
        ya, yb = max(0, int(math.floor(y0))), min(self.height, int(math.floor(y1)) + 1)
        za, zb = max(0, int(math.floor(z0))), min(self.depth, int(math.floor(z1)) + 1)
        if xa < xb and ya < yb and za < zb:
            mask[xa:xb, ya:yb, za:zb] = True
        return mask

    def ellipsoid_mask(self, cx, cy, cz, rx, ry=None, rz=None) -> np.ndarray:
        ry = rx if ry is None else ry
        rz = rx if rz is None else rz
        xs, ys, zs = self._centres
        return ((xs - cx) / rx) ** 2 + ((ys - cy) / ry) ** 2 + ((zs - cz) / rz) ** 2 <= 1.0

    def cylinder_mask(self, cx, cy, cz, radius, length, axis="Y", radius2=None) -> np.ndarray:
        """A cylinder (a cone or frustum with radius2) starting at (cx, cy, cz)
        and running `length` voxels along +axis. radius2 is the far end's radius."""
        xs, ys, zs = self._centres
        radius2 = radius if radius2 is None else radius2
        axis = axis.upper()
        if axis == "Y":
            along, a, b, ca, cb, start = ys, xs, zs, cx, cz, cy
        elif axis == "X":
            along, a, b, ca, cb, start = xs, ys, zs, cy, cz, cx
        elif axis == "Z":
            along, a, b, ca, cb, start = zs, xs, ys, cx, cy, cz
        else:
            raise ValueError(axis)
        lo, hi = sorted((start, start + length))
        t = np.clip((along - start) / length, 0, 1) if length != 0 else 0
        r = radius + (radius2 - radius) * t
        return (along >= lo) & (along <= hi) & ((a - ca) ** 2 + (b - cb) ** 2 <= r**2)

    # -- shapes (fill) -------------------------------------------------------

    def box(self, x0, y0, z0, x1, y1, z1, colour, part: int = 0, mirror: bool = False):
        """Fills every voxel from (x0, y0, z0) to (x1, y1, z1), bounds included."""
        return self._apply(self.box_mask(x0, y0, z0, x1, y1, z1), colour, part, mirror, "fill")

    def ellipsoid(self, cx, cy, cz, rx, ry=None, rz=None, colour="#ffffff", part: int = 0, mirror: bool = False):
        return self._apply(self.ellipsoid_mask(cx, cy, cz, rx, ry, rz), colour, part, mirror, "fill")

    def sphere(self, cx, cy, cz, r, colour, part: int = 0, mirror: bool = False):
        return self.ellipsoid(cx, cy, cz, r, r, r, colour, part, mirror)

    def cylinder(self, cx, cy, cz, radius, length, colour, axis="Y", radius2=None, part: int = 0, mirror: bool = False):
        return self._apply(self.cylinder_mask(cx, cy, cz, radius, length, axis, radius2), colour, part, mirror, "fill")

    def voxel(self, x, y, z, colour, part: int = 0, mirror: bool = False):
        return self.box(x, y, z, x, y, z, colour, part, mirror)

    def line(self, start, end, radius, colour, part: int = 0, mirror: bool = False):
        """A thick straight line (a capsule) between two points."""
        xs, ys, zs = self._centres
        p = np.stack([xs, ys, zs], axis=-1)
        a, b = np.array(start, dtype=float), np.array(end, dtype=float)
        ab = b - a
        t = np.clip(((p - a) @ ab) / max(1e-9, ab @ ab), 0, 1)
        closest = a + t[..., None] * ab
        mask = np.linalg.norm(p - closest, axis=-1) <= radius
        return self._apply(mask, colour, part, mirror, "fill")

    def mask(self, mask: np.ndarray, colour, part: int = 0, mirror: bool = False):
        """Fills any boolean mask the size of the grid."""
        return self._apply(mask, colour, part, mirror, "fill")

    # -- editing -------------------------------------------------------------

    def clear(self, mask: np.ndarray, mirror: bool = False):
        """Empties the voxels in a mask (use box_mask, ellipsoid_mask, ...)."""
        return self._apply(mask, None, 0, mirror, "clear")

    def paint(self, mask: np.ndarray, colour, mirror: bool = False):
        """Recolours filled voxels inside a mask; empty ones stay empty."""
        return self._apply(mask, colour, 0, mirror, "paint")

    def assign(self, mask: np.ndarray, part: int, mirror: bool = False):
        """Moves filled voxels inside a mask to another piece."""
        return self._apply(mask, None, part, mirror, "assign")

    def surface(self, face: str = "front", depth: int = 1) -> np.ndarray:
        """Mask of the outermost `depth` filled voxels seen from one side:
        front, back, left, right, top or bottom."""
        filled = self.grid > 0
        axis, reverse = {
            "front": (2, False),
            "back": (2, True),
            "left": (0, False),
            "right": (0, True),
            "bottom": (1, False),
            "top": (1, True),
        }[face]
        data = np.flip(filled, axis=axis) if reverse else filled
        seen = np.cumsum(data, axis=axis)
        result = data & (seen >= 1) & (seen <= depth)
        return np.flip(result, axis=axis) if reverse else result

    def paint_face(self, mask: np.ndarray, colour, face: str = "front", depth: int = 1, mirror: bool = False):
        """Recolours only the outer surface of a region, as seen from `face`."""
        return self.paint(mask & self.surface(face, depth), colour, mirror)

    def pixels(self, x0: int, y0: int, rows: list[str], colours: dict, face: str = "front",
               depth: int = 1, z: int | None = None, part: int = 0, mirror: bool = False):
        """Pixel art on a surface. rows[0] is the top row, drawn at y0 +
        len(rows) - 1, down to y0; each character is looked up in `colours`
        ("." and " " are skipped). On the front and back it paints the
        outermost voxel of each column (so it follows curved faces); pass `z`
        to place solid voxels on that exact layer instead (for things that
        stick out, like a nose). For left/right faces, x0 is the z position."""
        height = len(rows)
        for r, row in enumerate(rows):
            y = y0 + height - 1 - r
            for c, char in enumerate(row):
                if char in ". " or char not in colours:
                    continue
                if face in ("front", "back"):
                    x = x0 + c
                    if z is not None:
                        self.box(x, y, z, x, y, z, colours[char], part, mirror)
                        continue
                    mask = self.box_mask(x, y, 0, x, y, self.depth - 1)
                else:
                    zc = x0 + c
                    mask = self.box_mask(0, y, zc, self.width - 1, y, zc)
                self.paint(mask & self.surface(face, depth), colours[char], mirror)

    # -- output --------------------------------------------------------------

    def pieces(self):
        """(kind, grid, limb) for the body and every limb that has voxels."""
        body = np.where(self.part == 0, self.grid, 0)
        result = [("Body", body, None)]
        for index, limb in enumerate(self.limbs, start=1):
            grid = np.where(self.part == index, self.grid, 0)
            if (grid > 0).any():
                result.append((limb.kind, grid, limb))
        return result

    def flipped(self):
        """The grid in the game's layout: the model faces -Z with x mirrored
        so that "right" in a design is on the right when you face it."""
        return self.grid[::-1, :, :], self.part[::-1, :, :]


def load_designs() -> dict[str, Design]:
    import importlib
    import pkgutil
    from pathlib import Path

    here = Path(__file__).resolve().parent
    for info in sorted(pkgutil.iter_modules([str(here)]), key=lambda i: i.name):
        if info.name.startswith("designs") and f"blocky.{info.name}" not in _LOADED:
            _LOADED.add(f"blocky.{info.name}")
            try:
                importlib.import_module(f"blocky.{info.name}")
            except Exception as error:  # a design file being edited shouldn't stop the others
                import sys

                print(f"warning: skipped {info.name}.py ({type(error).__name__}: {error})", file=sys.stderr)
    return REGISTRY


_LOADED: set[str] = set()


def build_model(entry: Design) -> Model:
    model = Model(entry.width, entry.height, entry.depth)
    entry.build(model)
    if not (model.grid > 0).any():
        raise ValueError(f"{entry.id} is empty")
    body = (model.grid > 0) & (model.part == 0)
    if not body.any():
        raise ValueError(f"{entry.id} has no body voxels")
    return model


def iter_ids(ids: Iterable[str] | None = None) -> list[str]:
    designs = load_designs()
    if not ids:
        return sorted(designs)
    missing = [i for i in ids if i not in designs]
    if missing:
        raise SystemExit(f"no design for: {', '.join(missing)}")
    return list(ids)
