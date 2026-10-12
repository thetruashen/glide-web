"""Prepare the exact loader declared by a modpack without invalidating latest caches."""
import hashlib
import json
import os
from pathlib import Path
import minecraft_launcher_lib

version = os.environ['GLIDE_MINECRAFT_VERSION']
loader = os.environ['GLIDE_MINECRAFT_LOADER']
loader_version = os.environ['GLIDE_LOADER_VERSION']
directory = os.environ.get('GLIDE_MINECRAFT_DIR', '/home/runner/glide-minecraft')
mod_loader = minecraft_launcher_lib.mod_loader.get_mod_loader(loader)
marker = Path(directory) / '.glide-install' / f'{version}-{loader}.json'
launcher = Path(__file__).with_name('glide_launch.py')
fingerprint = hashlib.sha256(launcher.read_bytes()).hexdigest()
try:
    existing = json.loads(marker.read_text())
except (OSError, ValueError):
    existing = {}
target = mod_loader.get_installed_version(version, loader_version)
if existing.get('fingerprint') in {fingerprint,'b9541a81088651a5d44ebeac071560a54cf1c9c6ce48c85f14f62e46aa6a73d5','287193cbd187727cee643e8a6f9012e0b0622e44f04540e915c4852956b9bc16'} and existing.get('launch_version') == target and (Path(directory) / 'versions' / target / f'{target}.json').is_file():
    print('GLIDE_PINNED_LOADER_CACHE=hit')
    raise SystemExit(0)
if loader_version not in mod_loader.get_loader_versions(version, False):
    raise ValueError(f'{loader} {loader_version} is not available for Minecraft {version}')
installed = mod_loader.install(version, directory, loader_version=loader_version)
marker.parent.mkdir(parents=True, exist_ok=True)
marker.write_text(json.dumps({'fingerprint': fingerprint, 'launch_version': installed}))
print(f'GLIDE_PINNED_LOADER={loader}-{loader_version}')
