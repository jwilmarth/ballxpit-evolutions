# Ball x Pit Evolutions

A static GitHub Pages site for **BALL x PIT** with two views:

- **Run planner** (`#run`): 4 ball slots and 4 passive slots (you can change the count). Fill them in as you play and it lists:
  - **Ready to evolve**: every part is in your slots. Hit **Evolve** to swap the parts for the result.
  - **One away**: click the dimmed part to add it to a free slot.
  - **Further away**: evolutions that need two or more parts you don't have yet.
  - **Fuse** (⧉ on a ball slot) merges two balls into one slot, using the game's rules: you can't fuse the same ball twice, a ball can only be fused once, and you can't fuse two balls that already form an evolution. Fused balls are left out of evolutions unless you turn on "Fused balls can evolve".
- **Legend** (`#legend`): every ball and passive evolution, grouped by tier, by ingredient, or A–Z. You can search, filter by ingredient, and hide the Naturalist DLC. Click any icon for its description, what it's made from and what it's used in.

The run is saved in your browser's localStorage.

## Updating after a game patch

All data comes straight from the game files, so you don't need to edit anything by hand:

```powershell
pip install -r tools/requirements.txt
python tools/extract.py "D:/SteamLibrary/steamapps/common/BALLxPIT"
```

This rewrites `data/data.json`, `data/data.js` and `icons/*.png`. Commit and push them, and Pages redeploys.

How it works: the game uses Unity IL2CPP. Balls are `HeroInfo` objects and passives are `PassiveInfo` objects. The extractor rebuilds their typetrees from `GameAssembly.dll` + `global-metadata.dat` (TypeTreeGeneratorAPI) and reads the Odin-serialized `MergeComponents` field. The outer array of that field lists alternative recipes, and each inner array lists the parts one recipe needs. Tiers follow the community chart: T1 is made only from base items, T2 mixes base and evolved items, and T3 uses only evolved items.

## Deploy to GitHub Pages

1. Push this folder to a GitHub repo.
2. Go to Settings → Pages → Deploy from a branch → `main` / root.

No build step. `index.html` also works when opened straight from disk.

## Preview locally

```powershell
python -m http.server 8765
```

Fan-made and not affiliated with the developers. BALL x PIT © Kenny Sun / Devolver Digital. The icons are game assets.
