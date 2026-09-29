"""Checks the chapter grids in Chapters.luau.

For each chapter it checks the grid's shape and characters, that doorways are
at least 2 tiles wide, that every closet can be entered, and that the chapter
can be escaped for EVERY combination of random item spots and code notes. It
also checks that items behind locked doors can't be grabbed through a wall.

Run it after editing a grid:   python3 tools/check_maps.py
"""
import itertools
import math

TILE = 4
PROMPT_REACH = 7.0  # item ProximityPrompt MaxActivationDistance
FURNITURE = set("tdbokscvu")
MARKERS_WALKABLE = set(".:PMwnEu")


def check(name, rows, items, locks):
    errors = []
    h, w = len(rows), len(rows[0])
    for i, r in enumerate(rows):
        if len(r) != w:
            errors.append(f"row {i} has width {len(r)}, expected {w}")
    if errors:
        return errors
    at = lambda x, y: rows[y][x] if 0 <= x < w and 0 <= y < h else " "
    tiles = [(x, y) for y in range(h) for x in range(w)]
    known = set("#= .:PMwnhEGtdboksvcu") | set(items) | set(locks)
    for x, y in tiles:
        if at(x, y) not in known:
            errors.append(f"unknown char {at(x, y)!r} at {x},{y}")
    count = lambda ch: sum(1 for t in tiles if at(*t) == ch)
    if count("M") != 1:
        errors.append("need exactly one M")
    if count("P") < 4:
        errors.append("need at least 4 player spawns")
    if count("E") < 1 or count("G") < 1:
        errors.append("need E and G")

    post = {k for k, v in locks.items() if v.get("post")}
    door = {k for k, v in locks.items() if not v.get("post")}

    def walkable(x, y, opened=frozenset(), gate_open=False):
        c = at(x, y)
        if c in MARKERS_WALKABLE or c in items:
            return True
        if c in door and c in opened:
            return True
        if c == "G" and gate_open:
            return True
        return False

    def flood(starts, opened=frozenset(), gate_open=False):
        seen, stack = set(), [s for s in starts if walkable(*s, opened, gate_open)]
        while stack:
            x, y = stack.pop()
            if (x, y) in seen:
                continue
            seen.add((x, y))
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                n = (x + dx, y + dy)
                if n not in seen and walkable(*n, opened, gate_open):
                    stack.append(n)
        return seen

    starts = [t for t in tiles if at(*t) == "P"]
    start_zone = flood(starts)
    m = [t for t in tiles if at(*t) == "M"]
    if m and m[0] not in start_zone:
        errors.append("monster spawn is not in the start zone")

    # doorways are at least 2 tiles wide; closets can be entered
    for x, y in tiles:
        c = at(x, y)
        if c == ":" or c in door or c == "G":
            if not any(at(x + dx, y + dy) == c for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))):
                errors.append(f"{c!r} at {x},{y} is only 1 tile wide")
        if c == "h" and not any(walkable(x + dx, y + dy) for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))):
            errors.append(f"closet at {x},{y} has no open side")

    # every combination of item spots and code note must be escapable
    spots = {i: [t for t in tiles if at(*t) == i] for i in items}
    notes = [t for t in tiles if at(*t) == "n"]
    for i, s in spots.items():
        if not s:
            errors.append(f"item {i} ({items[i]}) has no spawn spots")
    uses_code = any(v.get("code") for v in locks.values())
    if uses_code and not notes:
        errors.append("code lock but no code notes")
    exits = [k for k, v in locks.items() if v.get("exit")]
    e_tiles = [t for t in tiles if at(*t) == "E"]
    combos = 0
    for choice in itertools.product(*[spots[i] for i in items], notes if uses_code else [None]):
        combos += 1
        chosen = dict(zip(items, choice[: len(items)]))
        note = choice[-1]
        opened = set()
        while True:
            zone = flood(starts, frozenset(opened))
            have = {items[i] for i, t in chosen.items() if t in zone}
            code_known = note is None or note in zone
            new = set()
            for k, v in locks.items():
                if k in opened:
                    continue
                lock_tiles = [t for t in tiles if at(*t) == k]
                reach = any((x + dx, y + dy) in zone for x, y in lock_tiles
                            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)))
                ok = (v.get("code") and code_known) or (v.get("item") in have)
                if reach and ok:
                    new.add(k)
            if not new:
                break
            opened |= new
        gate_open = all(k in opened for k in exits)
        zone = flood(starts, frozenset(opened), gate_open)
        if not (gate_open and any(t in zone for t in e_tiles)):
            errors.append(f"not escapable with {chosen} note={note} (opened {sorted(opened)})")
            break

    # items behind locks must be out of reach from other rooms
    for i, s in spots.items():
        for sx, sy in s:
            comp = flood([(sx, sy)])
            if any(t in comp for t in starts):
                continue
            cx, cy = (sx + 0.5) * TILE, (sy + 0.5) * TILE
            worst = math.inf
            for t in tiles:
                if t in comp or not walkable(*t):  # locked doors are closed
                    continue
                # nearest point of that tile's square to the item
                nx = min(max(cx, t[0] * TILE), (t[0] + 1) * TILE)
                ny = min(max(cy, t[1] * TILE), (t[1] + 1) * TILE)
                worst = min(worst, math.hypot(nx - cx, ny - cy))
            if worst < PROMPT_REACH + 1:
                errors.append(f"item {items[i]} at {sx},{sy} is {worst:.1f} studs from another room")
    return errors, combos


def main():
    import os
    import re
    import sys
    here = os.path.dirname(os.path.abspath(__file__))
    path = os.path.join(here, "..", "src", "ServerScriptService", "GameServer", "Chapters.luau")
    src = open(path).read()
    list_src = src[src.index("Chapters.List = {"):src.index("local FURNITURE")]
    blocks = re.split(r"\n\t\{\n\t\tId = ", list_src)[1:]
    ok = True
    for block in blocks:
        chapter = re.match(r'"(\w+)"', block).group(1)
        items = dict(re.findall(r'\["(\d)"\] = "(\w+)"', block))
        locks = {}
        for char, body in re.findall(r"\n\t\t\t([A-Z]) = \{([^}]*)\}", block):
            lock = {}
            item = re.search(r'Item = "(\w+)"', body)
            if item:
                lock["item"] = item.group(1)
            for key in ("Code", "Exit", "Post"):
                if key + " = true" in body:
                    lock[key.lower()] = True
            locks[char] = lock
        grid = re.search(r"Grid = \{\n(.*?)\n\t\t\},", block, re.S).group(1)
        rows = re.findall(r'^\t\t\t"([^"]*)",$', grid, re.M)
        errors, combos = check(chapter, rows, items, locks)
        status = "OK" if not errors else f"{len(errors)} problem(s)"
        print(f"{chapter}: {len(rows[0])}x{len(rows)} tiles, {combos} item/note combinations tried - {status}")
        for error in errors[:20]:
            print("   -", error)
        ok = ok and not errors
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
