#!/usr/bin/env python3
"""Validate pack JSON against Mojang's official JSON schemas.

The schemas in tools/ref/json_schemas are verbatim copies of
Mojang/bedrock-samples v1.26.50.4 metadata/json_schemas (see tools/ref/SOURCE.md).
Requires: pip install jsonschema (>= 4.18, uses the `referencing` package).

Checked documents:
  * BP + RP manifest.json (format_version 2) -> structural check mirroring the
    format-2 manifests that bedrock-samples v1.26.50.4 itself ships
    (behavior_pack/manifest.json, resource_pack/manifest.json). The packaging
    schema in json_schemas only covers format_version 3, so it is not used.
  * BP entities/*.json (1.26.50)   -> server/entity/1.26.50/ActorDocument.json
  * BP items/*.json (1.26.30)      -> server/item/1.26.30/ItemDocument.json

Exit code 0 when every document validates, 1 otherwise.
"""
import json
import pathlib
import re
import sys
import urllib.parse

from jsonschema import Draft7Validator
from referencing import Registry, Resource
from referencing.jsonschema import DRAFT7

ROOT = pathlib.Path(__file__).resolve().parent.parent
SCHEMAS = ROOT / "tools" / "ref" / "json_schemas"
BP = ROOT / "packs" / "FredbearBP"
RP = ROOT / "packs" / "FredbearRP"
BASE = "https://schemas.local"


def build_registry():
    resources = []
    for f in SCHEMAS.rglob("*.json"):
        doc = json.loads(f.read_text(encoding="utf-8"))
        rel = "/" + f.relative_to(SCHEMAS).as_posix()
        uri = BASE + urllib.parse.quote(rel)
        doc = dict(doc)
        doc["$id"] = uri
        resources.append((uri, Resource.from_contents(doc, default_specification=DRAFT7)))
    return Registry().with_resources(resources)


def validator(registry, rel):
    uri = BASE + urllib.parse.quote(rel)
    schema = registry.contents(uri)
    return Draft7Validator(schema, registry=registry)


def check(v, path, doc):
    errors = sorted(v.iter_errors(doc), key=lambda e: list(e.absolute_path))
    for e in errors:
        loc = "/".join(str(p) for p in e.absolute_path) or "(root)"
        print(f"  FAIL {path.relative_to(ROOT)} @ {loc}: {e.message[:200]}")
    return len(errors)


UUID = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")


def is_ver(v):
    return isinstance(v, list) and len(v) == 3 and all(isinstance(n, int) and n >= 0 for n in v)


def check_manifest(path, doc, pack_root, seen_uuids):
    errs = []
    if doc.get("format_version") != 2:
        errs.append("format_version must be 2")
    h = doc.get("header", {})
    for k in ("name", "description"):
        if not isinstance(h.get(k), str) or not h.get(k):
            errs.append(f"header.{k} missing")
    if not UUID.match(str(h.get("uuid", ""))):
        errs.append("header.uuid invalid")
    if not is_ver(h.get("version")):
        errs.append("header.version must be [major, minor, patch]")
    if h.get("min_engine_version") != [1, 26, 50]:
        errs.append("header.min_engine_version must be [1, 26, 50]")
    uuids = [h.get("uuid")]
    for i, m in enumerate(doc.get("modules", [])):
        if m.get("type") not in ("data", "resources", "script"):
            errs.append(f"modules[{i}].type invalid")
        if not UUID.match(str(m.get("uuid", ""))):
            errs.append(f"modules[{i}].uuid invalid")
        if not is_ver(m.get("version")):
            errs.append(f"modules[{i}].version invalid")
        uuids.append(m.get("uuid"))
        if m.get("type") == "script":
            if m.get("language") != "javascript":
                errs.append(f"modules[{i}].language must be javascript")
            if not (pack_root / m.get("entry", "")).is_file():
                errs.append(f"modules[{i}].entry {m.get('entry')} does not exist")
    if not doc.get("modules"):
        errs.append("no modules")
    for i, d in enumerate(doc.get("dependencies", [])):
        if "uuid" in d:
            if not UUID.match(str(d["uuid"])) or not is_ver(d.get("version")):
                errs.append(f"dependencies[{i}] invalid pack dependency")
        elif "module_name" in d:
            if not re.match(r"^\d+\.\d+\.\d+$", str(d.get("version", ""))):
                errs.append(f"dependencies[{i}] script module version must be a stable x.y.z string")
        else:
            errs.append(f"dependencies[{i}] has neither uuid nor module_name")
    for u in uuids:
        if u in seen_uuids:
            errs.append(f"uuid {u} reused")
        seen_uuids.add(u)
    for e in errs:
        print(f"  FAIL {path.relative_to(ROOT)}: {e}")
    return len(errs)


def main():
    reg = build_registry()
    actor_v = validator(reg, "/server/entity/1.26.50/ActorDocument.json")
    item_v = validator(reg, "/server/item/1.26.30/ItemDocument.json")
    failures = 0
    checked = 0
    seen = set()
    bp_m = json.loads((BP / "manifest.json").read_text())
    rp_m = json.loads((RP / "manifest.json").read_text())
    failures += check_manifest(BP / "manifest.json", bp_m, BP, seen)
    failures += check_manifest(RP / "manifest.json", rp_m, RP, seen)
    checked += 2
    rp_uuid = rp_m["header"]["uuid"]
    if not any(d.get("uuid") == rp_uuid for d in bp_m.get("dependencies", [])):
        print("  FAIL BP manifest does not depend on the RP header uuid")
        failures += 1
    for f in sorted((BP / "entities").glob("*.json")):
        doc = json.loads(f.read_text())
        if doc.get("format_version") != "1.26.50":
            print(f"  FAIL {f.relative_to(ROOT)}: format_version must be 1.26.50")
            failures += 1
        failures += check(actor_v, f, doc["minecraft:entity"])
        checked += 1
    for f in sorted((BP / "items").glob("*.json")):
        doc = json.loads(f.read_text())
        if doc.get("format_version") != "1.26.30":
            print(f"  FAIL {f.relative_to(ROOT)}: format_version must be 1.26.30")
            failures += 1
        failures += check(item_v, f, doc["minecraft:item"])
        checked += 1
    status = "all valid" if failures == 0 else f"{failures} error(s)"
    print(f"schemas: {checked} documents checked against bedrock-samples v1.26.50.4 json_schemas: {status}")
    return 0 if failures == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
