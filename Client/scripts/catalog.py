"""Generate a full official version catalog with actual loader compatibility."""
import json
import sys
from pathlib import Path
import requests
import minecraft_launcher_lib

def catalog():
    response = requests.get("https://piston-meta.mojang.com/mc/game/version_manifest_v2.json", timeout=60)
    response.raise_for_status()
    data = response.json()
    support = {}
    for loader in minecraft_launcher_lib.mod_loader.list_mod_loader():
        support[loader] = set(minecraft_launcher_lib.mod_loader.get_mod_loader(loader).get_minecraft_versions(False))
    return {"latest": data["latest"], "versions": [{"id": v["id"], "type": v["type"], "url": v["url"], "loaders": ["vanilla"] + [name for name, versions in support.items() if v["id"] in versions]} for v in data["versions"]]}

if __name__ == "__main__":
    target = Path(sys.argv[1] if len(sys.argv) > 1 else "Web/public/versions.json")
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(catalog(), separators=(",", ":")))
