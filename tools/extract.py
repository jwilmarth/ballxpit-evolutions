"""
Extract ball / passive evolution data and icons from a local BALL x PIT install.

Usage:
    pip install -r tools/requirements.txt
    python tools/extract.py "D:/SteamLibrary/steamapps/common/BALLxPIT"

Writes:
    data/data.json      - balls, passives, recipes, game version
    icons/<slug>.png    - icon for every ball and passive

How it works: the game is Unity IL2CPP. Ball definitions are `HeroInfo`
MonoBehaviours and passives are `PassiveInfo`, both referenced from the
`InfoDB` object. Their typetrees are rebuilt from GameAssembly.dll +
global-metadata.dat with TypeTreeGeneratorAPI. Recipes live in the
Odin-serialized `MergeComponents` field (UpgradeInfo[][]): the outer array is
a list of alternative recipes, each inner array is the set of required parts.
"""
import json
import os
import struct
import sys

import UnityPy
from UnityPy.helpers.TypeTreeGenerator import TypeTreeGenerator
from UnityPy.helpers.TypeTreeNode import TypeTreeNode

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def find_data_dir(game_dir):
    for f in os.listdir(game_dir):
        if f.endswith("_Data"):
            return os.path.join(game_dir, f)
    raise SystemExit("No *_Data folder found in " + game_dir)


def unity_version(data_dir):
    env = UnityPy.load(os.path.join(data_dir, "globalgamemanagers"))
    for f in env.files.values():
        v = getattr(f, "unity_version", None)
        if v:
            return v
    raise SystemExit("Could not determine Unity version")


def game_version(data_dir):
    env = UnityPy.load(os.path.join(data_dir, "globalgamemanagers"))
    for o in env.objects:
        if o.type.name == "PlayerSettings":
            return o.read_typetree(check_read=False).get("bundleVersion")
    return None


class Nodes:
    def __init__(self, game_dir, data_dir):
        self.gen = TypeTreeGenerator(unity_version(data_dir))
        with open(os.path.join(game_dir, "GameAssembly.dll"), "rb") as f:
            ga = f.read()
        with open(os.path.join(data_dir, "il2cpp_data", "Metadata", "global-metadata.dat"), "rb") as f:
            md = f.read()
        self.gen.load_il2cpp(ga, md)
        self.cache = {}

    def get(self, cls):
        if cls not in self.cache:
            base = self.gen.get_nodes("Assembly-CSharp", cls)
            self.cache[cls] = TypeTreeNode.from_list(
                [TypeTreeNode(b.m_Level, b.m_Type, b.m_Name, 0, 0, m_MetaFlag=b.m_MetaFlag) for b in base]
            )
        return self.cache[cls]


def parse_merge_components(b):
    """Minimal Odin binary reader for the leading `MergeComponents` UpgradeInfo[][] field.
    Returns list of recipes, each a list of external-reference indices."""
    if not b:
        return []
    p = 0

    def rd_i32():
        nonlocal p
        v = struct.unpack_from("<i", b, p)[0]
        p += 4
        return v

    def rd_str():
        nonlocal p
        wide = b[p]
        p += 1
        n = rd_i32()
        if wide == 1:
            s = b[p:p + 2 * n].decode("utf-16le")
            p += 2 * n
        else:
            s = b[p:p + n].decode("latin1")
            p += n
        return s

    def rd_type():
        nonlocal p
        t = b[p]
        p += 1
        if t == 0x2F:  # TypeName: id + name
            rd_i32()
            return rd_str()
        if t == 0x30:  # TypeID
            rd_i32()
            return None
        if t == 0x2E:  # UnnamedNull / no type
            return None
        raise ValueError("unexpected type entry 0x%02x" % t)

    t = b[p]; p += 1
    if t != 0x01:
        return []
    if rd_str() != "MergeComponents":
        return []
    rd_type(); rd_i32()  # type + node id
    t = b[p]; p += 1
    if t != 0x06:  # StartOfArray
        return []
    n = struct.unpack_from("<q", b, p)[0]; p += 8
    out = []
    for _ in range(n):
        t = b[p]; p += 1
        if t == 0x2E:
            continue
        if t != 0x02:
            raise ValueError("expected reference node, got 0x%02x" % t)
        rd_type(); rd_i32()
        t = b[p]; p += 1
        if t != 0x06:
            raise ValueError("expected inner array")
        m = struct.unpack_from("<q", b, p)[0]; p += 8
        grp = []
        for _ in range(m):
            t = b[p]; p += 1
            if t == 0x0C:  # UnnamedExternalReferenceByIndex
                grp.append(rd_i32())
            elif t == 0x2E:
                grp.append(None)
            else:
                raise ValueError("unexpected inner entry 0x%02x" % t)
        p += 2  # EndOfArray, EndOfNode
        out.append(grp)
    return out


def color_hex(c):
    return "#%02x%02x%02x" % tuple(max(0, min(255, round(c[k] * 255))) for k in "rgb")


def main():
    game_dir = sys.argv[1] if len(sys.argv) > 1 else "D:/SteamLibrary/steamapps/common/BALLxPIT"
    data_dir = find_data_dir(game_dir)
    print("Loading typetrees from IL2CPP metadata...")
    nodes = Nodes(game_dir, data_dir)
    print("Loading assets...")
    env = UnityPy.load(data_dir)

    want = {"HeroInfo", "PassiveInfo", "InfoDB"}
    found = {k: {} for k in want}
    readers = {}
    for obj in env.objects:
        if obj.type.name != "MonoBehaviour":
            continue
        try:
            mb = obj.read(check_read=False)
            cls = mb.m_Script.read().m_ClassName
        except Exception:
            continue
        if cls not in want:
            continue
        tt = obj.read_typetree(nodes.get(cls), check_read=False)
        key = (obj.assets_file.name, obj.path_id)
        found[cls][key] = tt
        readers[key] = obj

    if not found["InfoDB"]:
        raise SystemExit("InfoDB not found")
    db_key, db = next(iter(found["InfoDB"].items()))

    def resolve(owner_key, ptr):
        """Resolve a PPtr relative to the file containing owner_key."""
        if ptr["m_PathID"] == 0:
            return None
        owner_file = owner_key[0]
        if ptr["m_FileID"] == 0:
            return (owner_file, ptr["m_PathID"])
        af = readers[owner_key].assets_file
        ext = af.externals[ptr["m_FileID"] - 1]
        return (os.path.basename(ext.path), ptr["m_PathID"])

    items = {}  # key -> record
    os.makedirs(os.path.join(ROOT, "icons"), exist_ok=True)

    def add(kind, key, tt, order):
        slug = tt["Slug"]
        rec = {
            "id": slug,
            "kind": kind,
            "name": tt["Name"],
            "desc": tt["Desc"],
            "dlc": tt.get("DLCVersion", 0),  # 1 = Risen Ballbylon (paid DLC; icons named *pdlc1*)
            "order": order,
            "inGame": bool(tt["IsInGame"]),
            "color": color_hex(tt["BallColor"]) if "BallColor" in tt else (color_hex(tt["MainColor"]) if "MainColor" in tt else None),
            "_tt": tt,
            "_key": key,
        }
        icon_key = resolve(key, tt["Icon"])
        if icon_key:
            try:
                sprite = readers[key].assets_file.objects[icon_key[1]].read() if icon_key[0] == key[0] else None
                if sprite is not None:
                    sprite.image.save(os.path.join(ROOT, "icons", slug + ".png"))
                    rec["icon"] = "icons/%s.png" % slug
            except Exception as e:
                print("  icon failed for", slug, e)
        items[key] = rec

    for kind, cls, order_field in (("ball", "HeroInfo", "HeroOrder"), ("passive", "PassiveInfo", "PassiveOrder")):
        order_keys = [resolve(db_key, p) for p in db[order_field]]
        all_keys = [resolve(db_key, p) for p in db[kind == "ball" and "Heroes" or "Passives"]]
        seen = set()
        n = 0
        for k in order_keys + all_keys + list(found[cls].keys()):
            if k in seen or k not in found[cls]:
                continue
            seen.add(k)
            add(kind, k, found[cls][k], n)
            n += 1

    # recipes
    for key, rec in items.items():
        sd = rec["_tt"]["serializationData"]
        refs = sd["ReferencedUnityObjects"]
        recipes = []
        for grp in parse_merge_components(bytes(sd["SerializedBytes"])):
            parts = []
            for i in grp:
                if i is None:
                    continue
                k = resolve(key, refs[i])
                if k in items:
                    parts.append(items[k]["id"])
            if parts:
                recipes.append(parts)
        rec["recipes"] = recipes

    out_items = [r for r in items.values() if r["inGame"]]
    ids = {r["id"] for r in out_items}
    for r in out_items:
        r["recipes"] = [p for p in r["recipes"] if all(x in ids for x in p)]

    # tier (same convention as the community chart):
    #   0 = base, 1 = made only from base items, 2 = mix of base + evolved, 3 = only evolved parts
    by_id = {r["id"]: r for r in out_items}

    def get_tier(i):
        r = by_id[i]
        if not r["recipes"]:
            return 0
        best = 9
        for parts in r["recipes"]:
            evolved = sum(1 for x in parts if by_id[x]["recipes"])
            t = 1 if evolved == 0 else (3 if evolved == len(parts) else 2)
            best = min(best, t)
        return best

    result = []
    for r in sorted(out_items, key=lambda r: (r["kind"] != "ball", r["order"])):
        result.append({
            "id": r["id"],
            "kind": r["kind"],
            "name": r["name"],
            "desc": r["desc"],
            "dlc": r["dlc"],
            "tier": get_tier(r["id"]),
            "color": r["color"],
            "icon": r.get("icon"),
            "recipes": r["recipes"],
        })

    # UI sprites used by the site
    ui_wanted = {"icon_fusion": "fusion"}
    ui = {}
    for obj in env.objects:
        if obj.type.name != "Sprite" or len(ui) == len(ui_wanted):
            continue
        try:
            name = obj.peek_name()
        except Exception:
            continue
        if name in ui_wanted and ui_wanted[name] not in ui:
            path = "icons/ui_%s.png" % ui_wanted[name]
            obj.read().image.save(os.path.join(ROOT, path))
            ui[ui_wanted[name]] = path

    data = {
        "gameVersion": game_version(data_dir),
        "ui": ui,
        "items": result,
    }
    os.makedirs(os.path.join(ROOT, "data"), exist_ok=True)
    with open(os.path.join(ROOT, "data", "data.json"), "w", encoding="utf-8") as f:
        json.dump(data, f, indent=1, ensure_ascii=False)
    # data.js lets index.html work straight from disk (file://) as well as on GitHub Pages
    with open(os.path.join(ROOT, "data", "data.js"), "w", encoding="utf-8") as f:
        f.write("window.BXP_DATA = ")
        json.dump(data, f, ensure_ascii=False)
        f.write(";\n")
    nb = sum(1 for r in result if r["kind"] == "ball")
    ne = sum(1 for r in result if r["recipes"])
    print("Game version %s: %d balls, %d passives, %d evolutions, %d icons" % (
        data["gameVersion"], nb, len(result) - nb, ne, sum(1 for r in result if r["icon"])))


if __name__ == "__main__":
    main()
